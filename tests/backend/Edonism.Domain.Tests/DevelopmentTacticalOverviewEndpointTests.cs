using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentTacticalOverviewEndpointTests
{
    private static WebApplicationFactory<Program> Host(string env = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(env));

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
    public async Task AllSeatsSeeCoherentPublicRoutesAndNoSecretsOrMutations(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        using var createdResponse = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = players,
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var id = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(x => x.GetProperty("token").GetString()!).ToArray();
        var url = $"/api/dev/matches/{id}/tactical-overview";

        using (var denied = await creator.GetAsync(url))
        {
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
            Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());
        }
        using (var invalid = Seat(host, new string('F', 64)))
        using (var denied = await invalid.GetAsync(url + "?playerId=" + players[0]))
        {
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
            Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());
        }

        using var owner = Seat(host, tokens[0]);
        using var initial = await owner.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        var publicBefore = await initial.Content.ReadAsStringAsync();
        using var initialAudit = await owner.GetAsync($"/api/dev/matches/{id}/audit");
        var auditBefore = await initialAudit.Content.ReadAsStringAsync();

        for (var index = 0; index < count; index++)
        {
            using var seat = Seat(host, tokens[index]);
            using var response = await seat.GetAsync(url + "?playerId=" + players[(index + 1) % count]);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            using var bundled = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(bundled);
            var root = bundled.RootElement;
            Assert.Equal(players[index], root.GetProperty("playerId").GetString());
            Assert.Equal(0, root.GetProperty("verifiedRevision").GetInt64());
            Assert.Equal(1, root.GetProperty("round").GetInt32());
            foreach (var (field, legacy, array, expected) in new[]
            {
                ("uncontrolled", "uncontrolled-routes", "routes", 30 - count),
                ("otherPlayers", "other-player-routes", "others", count - 1),
                ("opponentControlledLots", "opponent-controlled-routes", "routes", count - 1)
            })
            {
                var projection = root.GetProperty(field);
                Assert.Equal(root.GetProperty("matchId").GetGuid(),
                    projection.GetProperty("matchId").GetGuid());
                Assert.Equal(root.GetProperty("playerId").GetString(),
                    projection.GetProperty("playerId").GetString());
                Assert.Equal(root.GetProperty("verifiedRevision").GetInt64(),
                    projection.GetProperty("verifiedRevision").GetInt64());
                Assert.Equal(root.GetProperty("fromStreetId").GetString(),
                    projection.GetProperty("fromStreetId").GetString());
                Assert.Equal(expected, projection.GetProperty(array).GetArrayLength());
                using var single = await seat.GetFromJsonAsync<JsonDocument>(
                    $"/api/dev/matches/{id}/{legacy}");
                Assert.NotNull(single);
                Assert.Equal(single.RootElement.GetRawText(), projection.GetRawText());
            }
            var raw = await response.Content.ReadAsStringAsync();
            foreach (var token in tokens)
                Assert.DoesNotContain(token, raw);
            foreach (var secret in new[] { "cardIds", "drawPile", "faction", "atoms" })
                Assert.DoesNotContain(secret, raw, StringComparison.OrdinalIgnoreCase);
        }

        using var unchanged = await owner.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(publicBefore, await unchanged.Content.ReadAsStringAsync());
        using var audit = await owner.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(auditBefore, await audit.Content.ReadAsStringAsync());

        using var rotated = await owner.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        using var rotatedJson = await rotated.Content.ReadFromJsonAsync<JsonDocument>();
        using var revoked = await owner.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        Assert.Equal("no-store", revoked.Headers.CacheControl?.ToString());
        using var fresh = Seat(host, rotatedJson!.RootElement.GetProperty("token").GetString()!);
        using var restored = await fresh.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        using var sameState = await fresh.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(publicBefore, await sameState.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ProductionNeverMapsTheTacticalOverview()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/tactical-overview");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
