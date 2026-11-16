using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentPublicTerritoryEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuthenticatedTerritoryIsReadOnlyCanonicalAndRevocable(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        using var created = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(body);
        var matchId = body.RootElement.GetProperty("matchId").GetGuid();
        var tokens = body.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(entry => entry.GetProperty("token").GetString()!).ToArray();
        var state = body.RootElement.GetProperty("state");
        var controls = state.GetProperty("controlledActivities").EnumerateArray().ToArray();
        var board = BoardCatalog.LoadDefault();
        var slotStreets = board.Slots.ToDictionary(slot => slot.Id, slot => slot.StreetId,
            StringComparer.Ordinal);
        var path = $"/api/dev/matches/{matchId}/public-territory";

        using (var denied = await creator.GetAsync(path))
        {
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
            Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());
        }
        using (var forged = Seat(host, new string('F', 64)))
        using (var denied = await forged.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var first = Seat(host, tokens[0]);
        using var before = await first.GetAsync($"/api/dev/matches/{matchId}");
        var publicBefore = await before.Content.ReadAsStringAsync();
        for (var i = 0; i < count; i++)
        {
            using var actor = Seat(host, tokens[i]);
            using var response = await actor.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(json);
            var report = json.RootElement;
            Assert.Equal(matchId, report.GetProperty("matchId").GetGuid());
            Assert.Equal(players[i], report.GetProperty("playerId").GetString());
            Assert.Equal(0, report.GetProperty("verifiedRevision").GetInt64());
            Assert.Equal(30, report.GetProperty("totalSlots").GetInt32());
            Assert.Equal(count, report.GetProperty("controlledLots").GetInt32());
            Assert.Equal(30 - count, report.GetProperty("freeLots").GetInt32());

            var roads = report.GetProperty("streets").EnumerateArray().ToArray();
            Assert.Equal(7, roads.Length);
            Assert.Equal(board.Streets.Select(street => street.Id),
                roads.Select(street => street.GetProperty("streetId").GetString()));
            Assert.Equal(report.GetProperty("sharedStreetCount").GetInt32(),
                roads.Count(road => road.GetProperty("isShared").GetBoolean()));
            foreach (var road in roads)
            {
                var id = road.GetProperty("streetId").GetString()!;
                var ownedLots = controls.Where(control =>
                    slotStreets[control.GetProperty("slotId").GetString()!] == id).ToArray();
                var printedStreet = board.Streets.Single(s => s.Id == id);
                var slotCount = board.Slots.Count(slot => slot.StreetId == id);
                Assert.Equal(printedStreet.Name, road.GetProperty("streetName").GetString());
                Assert.Equal(slotCount, road.GetProperty("totalSlots").GetInt32());
                Assert.Equal(ownedLots.Length, road.GetProperty("controlledLots").GetInt32());
                Assert.Equal(slotCount - ownedLots.Length, road.GetProperty("freeLots").GetInt32());
                Assert.Equal(ownedLots.Count(c => c.GetProperty("posture").GetInt32() == 0),
                    road.GetProperty("standing").GetInt32());
                Assert.Equal(ownedLots.Count(c => c.GetProperty("posture").GetInt32() == 1),
                    road.GetProperty("fallen").GetInt32());

                var owners = road.GetProperty("owners").EnumerateArray().ToArray();
                Assert.Equal(count, owners.Length);
                Assert.Equal(players,
                    owners.Select(owner => owner.GetProperty("playerId").GetString()));
                var distinct = owners.Count(o => o.GetProperty("controlledLots").GetInt32() > 0);
                Assert.Equal(distinct, road.GetProperty("distinctOwnerCount").GetInt32());
                Assert.Equal(distinct >= 2, road.GetProperty("isShared").GetBoolean());
                foreach (var owner in owners)
                {
                    var player = owner.GetProperty("playerId").GetString();
                    var held = ownedLots.Where(c =>
                        c.GetProperty("ownerPlayerId").GetString() == player).ToArray();
                    Assert.Equal(held.Length, owner.GetProperty("controlledLots").GetInt32());
                    Assert.Equal(held.Count(c => c.GetProperty("posture").GetInt32() == 0),
                        owner.GetProperty("standing").GetInt32());
                    Assert.Equal(held.Count(c => c.GetProperty("posture").GetInt32() == 1),
                        owner.GetProperty("fallen").GetInt32());
                }
            }
            var wire = await response.Content.ReadAsStringAsync();
            foreach (var secret in tokens) Assert.DoesNotContain(secret, wire);
            Assert.DoesNotContain("cardId", wire, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("atoms", wire, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("hand", wire, StringComparison.OrdinalIgnoreCase);
        }

        using var unchanged = await first.GetAsync($"/api/dev/matches/{matchId}");
        Assert.Equal(publicBefore, await unchanged.Content.ReadAsStringAsync());
        using var rotate = await first.PostAsync($"/api/dev/matches/{matchId}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var replacement = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(replacement);
        using (var revoked = await first.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var fresh = Seat(host, replacement.RootElement.GetProperty("token").GetString()!);
        using var valid = await fresh.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        using var after = await fresh.GetAsync($"/api/dev/matches/{matchId}");
        Assert.Equal(publicBefore, await after.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AuthenticatedPartialFixtureIsNotAnInventedZeroTerritory()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        using var created = await creator.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var json = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var id = json.RootElement.GetProperty("matchId").GetGuid();
        var token = json.RootElement.GetProperty("credentials")[0]
            .GetProperty("token").GetString()!;
        var path = $"/api/dev/matches/{id}/public-territory";
        using (var unauth = await creator.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, unauth.StatusCode);
        using var actor = Seat(host, token);
        using var response = await actor.GetAsync(path);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var wire = await response.Content.ReadAsStringAsync();
        Assert.Contains("full_board_required", wire);
        Assert.DoesNotContain("streets", wire);
        Assert.DoesNotContain(token, wire);
    }

    [Fact]
    public async Task ProductionNeverExposesTheDevTerritoryRoute()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/public-territory");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
