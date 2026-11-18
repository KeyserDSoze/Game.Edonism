using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #172: real Development bearer-scoped GET /turn-progress must emit
/// precisely the nine .NET MatchFirstRoundTurnProgress JSON properties.
/// The whole projection is optional/read-only; turn commands remain
/// Domain-authoritative regardless of any client-supplied progress fields.
/// </summary>
public sealed class DevelopmentFirstRoundTurnProgressExactWireContractTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static readonly string[] ExactKeys =
    [
        "activePlayerId", "completedPlayerIds", "completedTurns",
        "matchId", "phase", "remainingPlayerIds", "round",
        "totalTurns", "verifiedRevision",
    ];

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static void AssertProgress(
        JsonElement root, Guid matchId, string[] roster, int completed)
    {
        Assert.Equal(ExactKeys, root.EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal));
        Assert.Equal(matchId, root.GetProperty("matchId").GetGuid());
        Assert.Equal(1, root.GetProperty("round").GetInt32());
        Assert.Equal(completed, root.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(roster.Length, root.GetProperty("totalTurns").GetInt32());
        Assert.Equal(completed, root.GetProperty("completedTurns").GetInt32());
        Assert.Equal(completed == roster.Length ? 1 : 0,
            root.GetProperty("phase").GetInt32());
        Assert.Equal(completed == roster.Length ? null : roster[completed],
            root.GetProperty("activePlayerId").GetString());
        Assert.Equal(roster.Take(completed), root.GetProperty("completedPlayerIds")
            .EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(roster.Skip(completed), root.GetProperty("remainingPlayerIds")
            .EnumerateArray().Select(x => x.GetString()));
        var json = root.GetRawText();
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateHand", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("skipTurn", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("futureTurnPermissions", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("disconnectTimeout", json, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task RealAuthenticatedInitialMidAndSettledProgressHasExactPublicWireFields(
        int seats)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, seats).Select(i => $"actor-{i}").ToArray();
        using var create = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck",
            new {
                playerIds = ids,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var created = await create.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var bearerBySeat = created.RootElement.GetProperty("credentials")
            .EnumerateArray()
            .ToDictionary(x => x.GetProperty("playerId").GetString()!,
                x => x.GetProperty("token").GetString()!, StringComparer.Ordinal);
        Assert.Equal(seats, bearerBySeat.Count);
        using var unauthenticated = await creator.GetAsync(
            $"/api/dev/matches/{matchId}/turn-progress");
        Assert.Equal(HttpStatusCode.NotFound, unauthenticated.StatusCode);

        var uri = $"/api/dev/matches/{matchId}/turn-progress";
        // At 0, mid-first-round, and pending-settlement, ALL authenticated
        // seats observe the identical public progress: no private markers.
        for (var completed = 0; completed <= seats; completed++)
        {
            string? previousPayload = null;
            foreach (var id in ids)
            {
                using var client = Seat(host, bearerBySeat[id]);
                using var response = await client.GetAsync(uri);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
                using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
                Assert.NotNull(json);
                AssertProgress(json.RootElement, matchId, ids, completed);
                var wire = json.RootElement.GetRawText();
                if (previousPayload is not null)
                    Assert.Equal(previousPayload, wire);
                previousPayload = wire;
            }

            if (completed == seats) break;
            using var actor = Seat(host, bearerBySeat[ids[completed]]);
            using var end = await actor.PostAsJsonAsync(
                $"/api/dev/matches/{matchId}/end-turn",
                new { expectedRevision = completed });
            Assert.Equal(HttpStatusCode.OK, end.StatusCode);
        }

        using var actor0 = Seat(host, bearerBySeat[ids[0]]);
        using var state = await actor0.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}");
        Assert.NotNull(state);
        Assert.Equal(seats, state.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(1, state.RootElement.GetProperty("phase").GetInt32());
        Assert.Equal(seats + 1, state.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task ProductionDoesNotExposeDevelopmentFirstRoundProgress()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/turn-progress");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
