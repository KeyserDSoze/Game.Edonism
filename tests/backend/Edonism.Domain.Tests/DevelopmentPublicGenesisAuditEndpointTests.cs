using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #161: the actual Development API must certify one complete, public-only
/// first-round snapshot without exposing any secrets or paying gross wages.
/// </summary>
public sealed class DevelopmentPublicGenesisAuditEndpointTests
{
    private static WebApplicationFactory<Program> Host(string env = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment(env));

    private static HttpClient Actor(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuditAndHistoryCertifySameFullPublicGenesisUntilPendingRound(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = ids,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var state = created.RootElement.GetProperty("state");
        var tokens = created.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(c => c.GetProperty("token").GetString()!).ToArray();
        var auditPath = $"/api/dev/matches/{matchId}/audit";
        var historyPath = $"/api/dev/matches/{matchId}/history";

        Assert.Equal(30, state.GetProperty("boardActivities").GetArrayLength());
        Assert.Equal(count, state.GetProperty("controlledActivities").GetArrayLength());
        Assert.All(state.GetProperty("controlledActivities").EnumerateArray(), control =>
            Assert.Equal(0, control.GetProperty("posture").GetInt32()));
        Assert.All(state.GetProperty("players").EnumerateArray(), player =>
        {
            Assert.Equal(4, player.GetProperty("atoms").GetInt32());
            Assert.Equal(2, player.GetProperty("diplomacyTokens").GetInt32());
            Assert.Equal(16, player.GetProperty("henchmenTotal").GetInt32());
            Assert.Equal(15, player.GetProperty("henchmenAvailable").GetInt32());
        });
        Assert.All(state.GetProperty("grossSalaryQuotes").EnumerateArray(), quote =>
        {
            Assert.Equal(2, quote.GetProperty("baseAtoms").GetInt32());
            Assert.Equal(1, quote.GetProperty("standingActivityAtoms").GetInt32());
            Assert.Equal(3, quote.GetProperty("grossAtoms").GetInt32());
        });
        using (var unauth = await creator.GetAsync(auditPath))
        {
            Assert.Equal(HttpStatusCode.NotFound, unauth.StatusCode);
            Assert.Equal("no-store", unauth.Headers.CacheControl?.ToString());
        }
        using (var unauth = await creator.GetAsync(historyPath))
            Assert.Equal(HttpStatusCode.NotFound, unauth.StatusCode);
        using (var forged = Actor(host, new string('F', 64)))
        using (var denied = await forged.GetAsync(auditPath))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var first = Actor(host, tokens[0]);
        async Task VerifyPublic(int revision)
        {
            using var auditResponse = await first.GetAsync(auditPath);
            using var historyResponse = await first.GetAsync(historyPath);
            Assert.Equal(HttpStatusCode.OK, auditResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, historyResponse.StatusCode);
            Assert.Equal("no-store", auditResponse.Headers.CacheControl?.ToString());
            Assert.Equal("no-store", historyResponse.Headers.CacheControl?.ToString());
            using var audit = await auditResponse.Content.ReadFromJsonAsync<JsonDocument>();
            using var history = await historyResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(audit);
            Assert.NotNull(history);
            Assert.True(audit.RootElement.GetProperty("isValid").GetBoolean());
            Assert.Equal("ok", audit.RootElement.GetProperty("code").GetString());
            Assert.Equal(revision, audit.RootElement.GetProperty("verifiedRevision").GetInt64());
            Assert.Equal(revision, history.RootElement.GetProperty("verifiedRevision").GetInt64());
            Assert.Equal(matchId, history.RootElement.GetProperty("matchId").GetGuid());
            Assert.Equal(revision + 1, history.RootElement.GetProperty("frames").GetArrayLength());
            Assert.Equal(revision + 1, audit.RootElement.GetProperty("frames").GetArrayLength());
            var auditFrames = audit.RootElement.GetProperty("frames")
                .EnumerateArray().Select(f => f.GetRawText()).ToArray();
            var historyFrames = history.RootElement.GetProperty("frames")
                .EnumerateArray().Select(f => f.GetRawText()).ToArray();
            Assert.Equal(auditFrames, historyFrames);
            using var snapshotResponse = await first.GetAsync($"/api/dev/matches/{matchId}");
            Assert.Equal(HttpStatusCode.OK, snapshotResponse.StatusCode);
            using var snapshot = await snapshotResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(snapshot);
            Assert.Equal(revision,
                snapshot.RootElement.GetProperty("revision").GetInt64());
            Assert.All(snapshot.RootElement.GetProperty("players").EnumerateArray(), player =>
            {
                Assert.Equal(4, player.GetProperty("atoms").GetInt32());
                Assert.Equal(2, player.GetProperty("diplomacyTokens").GetInt32());
                Assert.Equal(15, player.GetProperty("henchmenAvailable").GetInt32());
            });
            Assert.All(snapshot.RootElement.GetProperty("grossSalaryQuotes").EnumerateArray(),
                quote => Assert.Equal(3, quote.GetProperty("grossAtoms").GetInt32()));
            var wire = await auditResponse.Content.ReadAsStringAsync()
                + await historyResponse.Content.ReadAsStringAsync();
            Assert.DoesNotContain("cardIds", wire, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("drawPile", wire, StringComparison.OrdinalIgnoreCase);
            foreach (var token in tokens)
                Assert.DoesNotContain(token, wire);
        }

        await VerifyPublic(0);
        using var actor = Actor(host, tokens[0]);
        using var options = await actor.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}/turn-options");
        Assert.NotNull(options);
        var nextRoad = options.RootElement.GetProperty("freeMoveStreetIds")[0].GetString()!;
        using var moved = await actor.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/free-move",
            new { expectedRevision = 0, destinationStreetId = nextRoad });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        await VerifyPublic(1);

        for (var i = 0; i < count; i++)
        {
            using var active = Actor(host, tokens[i]);
            using var ended = await active.PostAsJsonAsync(
                $"/api/dev/matches/{matchId}/end-turn",
                new { expectedRevision = i + 1 });
            Assert.Equal(HttpStatusCode.OK, ended.StatusCode);
        }
        await VerifyPublic(count + 1);
        using var finalAudit = await first.GetFromJsonAsync<JsonDocument>(auditPath);
        Assert.NotNull(finalAudit);
        Assert.Equal(1, finalAudit.RootElement.GetProperty("phase").GetInt32());
        Assert.Equal(JsonValueKind.Null,
            finalAudit.RootElement.GetProperty("activePlayerId").ValueKind);

        // Revoking one seat never changes public revision and must deny
        // BOTH audit and history before any private data is retrieved.
        using var rotated = await first.PostAsync(
            $"/api/dev/matches/{matchId}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        using var replaced = await rotated.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(replaced);
        using (var denied = await first.GetAsync(auditPath))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        using (var denied = await first.GetAsync(historyPath))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        using var fresh = Actor(host, replaced.RootElement.GetProperty("token").GetString()!);
        using var allowed = await fresh.GetAsync(auditPath);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task ProductionDoesNotPublishPublicAuditOrHistory()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        var id = Guid.NewGuid();
        using var audit = await client.GetAsync($"/api/dev/matches/{id}/audit");
        using var history = await client.GetAsync($"/api/dev/matches/{id}/history");
        Assert.Equal(HttpStatusCode.NotFound, audit.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, history.StatusCode);
    }
}
