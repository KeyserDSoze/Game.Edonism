using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentSeatBootstrapEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static async Task<(Guid MatchId, string Alice, string Bob)> Create(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var root = document!.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            seats[0].GetProperty("token").GetString()!,
            seats[1].GetProperty("token").GetString()!);
    }

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Fact]
    public async Task BootstrapIsActorScopedAndDoesNotExposeCredentialsOrOtherHands()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        var url = $"/api/dev/matches/{id}/seat";

        using var aliceResponse = await alice.GetAsync(url + "?playerId=bob");
        Assert.Equal(HttpStatusCode.OK, aliceResponse.StatusCode);
        Assert.Equal("no-store", aliceResponse.Headers.CacheControl?.ToString());
        using var aliceJson = await aliceResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(aliceJson);
        var a = aliceJson.RootElement;
        Assert.Equal(id, a.GetProperty("matchId").GetGuid());
        Assert.Equal("alice", a.GetProperty("playerId").GetString());
        Assert.Equal("alice", a.GetProperty("hand").GetProperty("playerId").GetString());
        Assert.Equal("alice", a.GetProperty("turnOptions").GetProperty("playerId").GetString());
        Assert.Equal(a.GetProperty("state").GetProperty("revision").GetInt64(),
            a.GetProperty("turnOptions").GetProperty("revision").GetInt64());
        Assert.True(a.GetProperty("turnOptions").GetProperty("canEndTurn").GetBoolean());
        var aliceCards = a.GetProperty("hand").GetProperty("cardIds")
            .EnumerateArray().Select(c => c.GetString()).ToArray();
        Assert.Equal(4, aliceCards.Length);

        using var bobResponse = await bob.GetAsync(url + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, bobResponse.StatusCode);
        using var bobJson = await bobResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(bobJson);
        var b = bobJson.RootElement;
        Assert.Equal("bob", b.GetProperty("playerId").GetString());
        Assert.Equal("bob", b.GetProperty("hand").GetProperty("playerId").GetString());
        Assert.False(b.GetProperty("turnOptions").GetProperty("canEndTurn").GetBoolean());
        Assert.Empty(b.GetProperty("turnOptions").GetProperty("freeMoveStreetIds").EnumerateArray());
        var bobCards = b.GetProperty("hand").GetProperty("cardIds")
            .EnumerateArray().Select(c => c.GetString()).ToArray();
        Assert.Equal(4, bobCards.Length);
        Assert.Empty(aliceCards.Intersect(bobCards));
        var aliceText = await aliceResponse.Content.ReadAsStringAsync();
        var bobText = await bobResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain(aliceToken, aliceText);
        Assert.DoesNotContain(bobToken, aliceText);
        Assert.DoesNotContain(aliceToken, bobText);
        Assert.DoesNotContain(bobToken, bobText);
        foreach (var card in bobCards) Assert.DoesNotContain(card!, aliceText);
        foreach (var card in aliceCards) Assert.DoesNotContain(card!, bobText);
        Assert.DoesNotContain("tokenDigests", aliceText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", aliceText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("credentials", aliceText, StringComparison.OrdinalIgnoreCase);

        using var audit = await alice.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        Assert.NotNull(audit);
        Assert.Equal(0, audit.RootElement.GetProperty("revision").GetInt64());
        Assert.Single(audit.RootElement.GetProperty("events").EnumerateArray());
    }

    [Fact]
    public async Task BootstrapTracksTurnsAndRejectsRevokedAndProductionTokens()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        var url = $"/api/dev/matches/{id}/seat";
        using var anonymous = await creator.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var fake = Seat(host, new string('0', 64));
        using var wrong = await fake.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var initial = await alice.GetFromJsonAsync<JsonDocument>(url);
        Assert.NotNull(initial);
        Assert.Equal(0, initial.RootElement.GetProperty("state").GetProperty("revision").GetInt64());
        var moveTo = initial.RootElement.GetProperty("turnOptions")
            .GetProperty("freeMoveStreetIds")[0].GetString()!;
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = moveTo, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var afterMove = await alice.GetFromJsonAsync<JsonDocument>(url);
        Assert.NotNull(afterMove);
        Assert.Equal(1, afterMove.RootElement.GetProperty("state").GetProperty("revision").GetInt64());
        Assert.Empty(afterMove.RootElement.GetProperty("turnOptions")
            .GetProperty("freeMoveStreetIds").EnumerateArray());
        using var end = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, end.StatusCode);
        using var bobBefore = await bob.GetFromJsonAsync<JsonDocument>(url);
        Assert.NotNull(bobBefore);
        Assert.True(bobBefore.RootElement.GetProperty("turnOptions").GetProperty("canEndTurn").GetBoolean());
        Assert.Equal(2, bobBefore.RootElement.GetProperty("state").GetProperty("revision").GetInt64());
        Assert.Equal(2, bobBefore.RootElement.GetProperty("turnOptions").GetProperty("revision").GetInt64());

        using var rotate = await bob.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var rotated = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var replacement = rotated!.RootElement.GetProperty("token").GetString()!;
        using var stale = await bob.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, stale.StatusCode);
        using var fresh = Seat(host, replacement);
        using var current = await fresh.GetFromJsonAsync<JsonDocument>(url);
        Assert.NotNull(current);
        Assert.Equal("bob", current.RootElement.GetProperty("playerId").GetString());
        Assert.Equal(2, current.RootElement.GetProperty("state").GetProperty("revision").GetInt64());
        using var last = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 2 });
        Assert.Equal(HttpStatusCode.NotFound, last.StatusCode);
        using var validEnd = await fresh.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 2 });
        Assert.Equal(HttpStatusCode.OK, validEnd.StatusCode);
        using var pending = await fresh.GetFromJsonAsync<JsonDocument>(url);
        Assert.NotNull(pending);
        Assert.Equal(1, pending.RootElement.GetProperty("state").GetProperty("phase").GetInt32());
        Assert.False(pending.RootElement.GetProperty("turnOptions").GetProperty("canEndTurn").GetBoolean());

        using var productionHost = Host("Production");
        using var production = productionHost.CreateClient();
        using var absent = await production.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
    }
}
