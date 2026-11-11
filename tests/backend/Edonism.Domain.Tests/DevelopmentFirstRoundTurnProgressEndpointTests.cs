using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentFirstRoundTurnProgressEndpointTests
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

    [Fact]
    public async Task BearerScopedProgressIsConsistentAcrossActorsAndNeverMutatesMatch()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        var matchId = created!.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = tokens[0].GetProperty("token").GetString()!;
        var bobToken = tokens[1].GetProperty("token").GetString()!;
        var endpoint = $"/api/dev/matches/{matchId}/turn-progress";
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var forged = Seat(host, new string('F', 64));

        using var anonymous = await creator.GetAsync(endpoint);
        using var denied = await forged.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        Assert.Equal("no-store", anonymous.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());

        using var initial = await alice.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        Assert.Equal("no-store", initial.Headers.CacheControl?.ToString());
        using var first = await initial.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(first);
        Assert.Equal(0, first.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(0, first.RootElement.GetProperty("completedTurns").GetInt32());
        Assert.Equal(2, first.RootElement.GetProperty("totalTurns").GetInt32());
        Assert.Equal("alice", first.RootElement.GetProperty("activePlayerId").GetString());
        Assert.Empty(first.RootElement.GetProperty("completedPlayerIds").EnumerateArray());
        Assert.Equal(["alice", "bob"], first.RootElement.GetProperty("remainingPlayerIds")
            .EnumerateArray().Select(e => e.GetString()));

        using var aliceEnd = await alice.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/end-turn", new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, aliceEnd.StatusCode);
        using var inProgress = await bob.GetAsync(endpoint + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, inProgress.StatusCode);
        Assert.Equal("no-store", inProgress.Headers.CacheControl?.ToString());
        using var middle = await inProgress.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(1, middle!.RootElement.GetProperty("completedTurns").GetInt32());
        Assert.Equal(1, middle.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal("bob", middle.RootElement.GetProperty("activePlayerId").GetString());
        Assert.Equal(["alice"], middle.RootElement.GetProperty("completedPlayerIds")
            .EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(["bob"], middle.RootElement.GetProperty("remainingPlayerIds")
            .EnumerateArray().Select(x => x.GetString()));

        using var bobEnd = await bob.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/end-turn", new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, bobEnd.StatusCode);
        using var completeAlice = await alice.GetAsync(endpoint);
        using var completeBob = await bob.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, completeAlice.StatusCode);
        Assert.Equal(HttpStatusCode.OK, completeBob.StatusCode);
        var json = await completeAlice.Content.ReadAsStringAsync();
        Assert.Equal(json, await completeBob.Content.ReadAsStringAsync());
        using var complete = JsonDocument.Parse(json);
        Assert.Equal(1, complete.RootElement.GetProperty("phase").GetInt32());
        Assert.Equal(2, complete.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(2, complete.RootElement.GetProperty("completedTurns").GetInt32());
        Assert.Equal(JsonValueKind.Null, complete.RootElement.GetProperty("activePlayerId").ValueKind);
        Assert.Equal(["alice", "bob"], complete.RootElement.GetProperty("completedPlayerIds")
            .EnumerateArray().Select(x => x.GetString()));
        Assert.Empty(complete.RootElement.GetProperty("remainingPlayerIds").EnumerateArray());
        Assert.DoesNotContain(aliceToken, json);
        Assert.DoesNotContain(bobToken, json);
        Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tokens", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("atoms", json, StringComparison.OrdinalIgnoreCase);

        using var stateBeforeRotation = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}");
        Assert.Equal(2, stateBeforeRotation!.RootElement.GetProperty("revision").GetInt64());
        Assert.All(stateBeforeRotation.RootElement.GetProperty("players").EnumerateArray(),
            p => Assert.Equal(4, p.GetProperty("atoms").GetInt32()));
        Assert.Equal(3, stateBeforeRotation.RootElement.GetProperty("events").GetArrayLength());

        using var rotate = await alice.PostAsync(
            $"/api/dev/matches/{matchId}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var replacement = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        using var renewed = Seat(host, replacement!.RootElement.GetProperty("token").GetString()!);
        using var revoked = await alice.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        Assert.Equal("no-store", revoked.Headers.CacheControl?.ToString());
        using var newRead = await renewed.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, newRead.StatusCode);
        Assert.Equal(json, await newRead.Content.ReadAsStringAsync());

        using var afterRotation = await renewed.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}");
        Assert.Equal(stateBeforeRotation.RootElement.GetProperty("revision").GetInt64(),
            afterRotation!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(stateBeforeRotation.RootElement.GetProperty("events").GetArrayLength(),
            afterRotation.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task ProductionDoesNotExposeTurnProgress()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/turn-progress");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
