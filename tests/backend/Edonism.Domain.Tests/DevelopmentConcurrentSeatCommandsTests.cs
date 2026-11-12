using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #76: competing, authenticated HTTP commands against the real Development
/// endpoint/store lock. This does not establish Production identity (#13).
/// </summary>
public sealed class DevelopmentConcurrentSeatCommandsTests
{
    private sealed record Seat(string PlayerId, string Token);
    private sealed record Attempt(HttpStatusCode Status, string Body, string? CacheControl);

    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static async Task<(Guid MatchId, Seat[] Seats)> Create(
        HttpClient creator, int count)
    {
        var players = BoardCatalog.LoadDefault().Slots.Take(count)
            .Select((slot, index) => new {
                playerId = $"seat-{index}",
                startingSlotId = slot.Id,
            }).ToArray();
        using var response = await creator.PostAsJsonAsync("/api/dev/matches/",
            new { players });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(document);
        var root = document.RootElement;
        var credentials = root.GetProperty("credentials").EnumerateArray()
            .Select(e => new Seat(
                e.GetProperty("playerId").GetString()!,
                e.GetProperty("token").GetString()!))
            .ToArray();
        Assert.Equal(count, credentials.Length);
        Assert.Equal(count, credentials.Select(s => s.Token).Distinct().Count());
        Assert.Equal(players.Select(p => p.playerId),
            credentials.Select(c => c.PlayerId));
        return (root.GetProperty("matchId").GetGuid(), credentials);
    }

    private static async Task<string> ReadSnapshot(HttpClient client, Guid id)
    {
        using var read = await client.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal("no-store", read.Headers.CacheControl?.ToString());
        return await read.Content.ReadAsStringAsync();
    }

    private static async Task<Attempt> PostEndTurn(
        HttpClient client, Guid id, long expectedRevision)
    {
        using var response = await client.PostAsJsonAsync(
            $"/api/dev/matches/{id}/end-turn", new { expectedRevision });
        return new Attempt(response.StatusCode,
            await response.Content.ReadAsStringAsync(),
            response.Headers.CacheControl?.ToString());
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task SameRevisionContentionCommitsExactlyOneTurnPerSeat(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, seats) = await Create(creator, count);
        var clients = seats.Select(seat =>
        {
            var client = host.CreateClient();
            client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", seat.Token);
            return client;
        }).ToArray();
        try
        {
            for (var current = 0; current < count; current++)
            {
                var expectedRevision = (long)current;
                using (var prior = JsonDocument.Parse(
                    await ReadSnapshot(clients[0], id)))
                {
                    Assert.Equal(expectedRevision,
                        prior.RootElement.GetProperty("revision").GetInt64());
                    Assert.Equal(seats[current].PlayerId,
                        prior.RootElement.GetProperty("activePlayerId").GetString());
                }

                // Fire every seat once and the current actor TWICE with the
                // same revision. Exactly one command may commit regardless
                // of scheduling/interleaving, even without idempotency keys.
                var release = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                var requests = Enumerable.Range(0, count).Append(current)
                    .Select(index => Task.Run(async () =>
                    {
                        await release.Task;
                        return await PostEndTurn(clients[index], id, expectedRevision);
                    })).ToArray();
                release.SetResult();
                var outcomes = await Task.WhenAll(requests);
                Assert.Equal(count + 1, outcomes.Length);
                Assert.Single(outcomes, result => result.Status == HttpStatusCode.OK);
                Assert.Equal(count, outcomes.Count(result =>
                    result.Status == HttpStatusCode.Conflict));
                Assert.All(outcomes, result =>
                {
                    Assert.Equal("no-store", result.CacheControl);
                    foreach (var seat in seats)
                        Assert.DoesNotContain(seat.Token, result.Body);
                });
                foreach (var rejection in outcomes.Where(
                    result => result.Status == HttpStatusCode.Conflict))
                {
                    using var error = JsonDocument.Parse(rejection.Body);
                    var code = error.RootElement.GetProperty("code").GetString();
                    Assert.Contains(code, new[] { "not_your_turn", "revision_conflict" });
                    Assert.Single(error.RootElement.EnumerateObject());
                }

                var publicStates = await Task.WhenAll(clients.Select(
                    client => ReadSnapshot(client, id)));
                Assert.All(publicStates, state =>
                    Assert.Equal(publicStates[0], state));
                using var document = JsonDocument.Parse(publicStates[0]);
                var state = document.RootElement;
                Assert.Equal(expectedRevision + 1,
                    state.GetProperty("revision").GetInt64());
                var events = state.GetProperty("events").EnumerateArray().ToArray();
                Assert.Equal(current + 2, events.Length);
                Assert.Equal(seats[current].PlayerId,
                    events[^1].GetProperty("actorId").GetString());
                Assert.Equal(current == count - 1
                    ? "round-settlement-pending" : "turn-ended",
                    events[^1].GetProperty("kind").GetString());
                Assert.Equal(1, state.GetProperty("round").GetInt32());
                Assert.All(state.GetProperty("players").EnumerateArray(), player =>
                {
                    Assert.Equal(4, player.GetProperty("atoms").GetInt32());
                    Assert.Equal(2, player.GetProperty("diplomacyTokens").GetInt32());
                    Assert.Equal(15, player.GetProperty("henchmenAvailable").GetInt32());
                    Assert.False(player.GetProperty("freeMoveUsed").GetBoolean());
                });
                foreach (var seat in seats)
                    Assert.DoesNotContain(seat.Token, publicStates[0]);

                using var auditResponse = await clients[0].GetAsync(
                    $"/api/dev/matches/{id}/audit");
                Assert.Equal(HttpStatusCode.OK, auditResponse.StatusCode);
                using var audit = await auditResponse.Content.ReadFromJsonAsync<JsonDocument>();
                Assert.True(audit!.RootElement.GetProperty("isValid").GetBoolean());
                Assert.Equal(expectedRevision + 1,
                    audit.RootElement.GetProperty("verifiedRevision").GetInt64());
                Assert.Equal(current == count - 1 ? 1 : 0,
                    state.GetProperty("phase").GetInt32());
            }

            var finalState = await ReadSnapshot(clients[0], id);
            using var pending = JsonDocument.Parse(finalState);
            Assert.Equal(JsonValueKind.Null,
                pending.RootElement.GetProperty("activePlayerId").ValueKind);
            foreach (var client in clients)
            {
                var denied = await PostEndTurn(client, id, count);
                Assert.Equal(HttpStatusCode.Conflict, denied.Status);
                using var error = JsonDocument.Parse(denied.Body);
                Assert.Equal("round_settlement_pending",
                    error.RootElement.GetProperty("code").GetString());
                Assert.Equal("no-store", denied.CacheControl);
            }
            Assert.Equal(finalState, await ReadSnapshot(clients[0], id));

            // No seat information is accessible without the issued capability.
            using var anonymous = host.CreateClient();
            using var forbidden = await anonymous.GetAsync(
                $"/api/dev/matches/{id}/audit");
            Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
            Assert.Equal("no-store", forbidden.Headers.CacheControl?.ToString());

            // Rotating a capability revokes the old one without revising the match.
            using var rotated = await clients[0].PostAsync(
                $"/api/dev/matches/{id}/rotate-token", null);
            Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
            using var credentials = await rotated.Content.ReadFromJsonAsync<JsonDocument>();
            var replacement = credentials!.RootElement.GetProperty("token").GetString()!;
            using var revoked = await clients[0].GetAsync(
                $"/api/dev/matches/{id}/audit");
            Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
            using var renewed = host.CreateClient();
            renewed.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", replacement);
            Assert.Equal(finalState, await ReadSnapshot(renewed, id));
        }
        finally
        {
            foreach (var client in clients) client.Dispose();
        }
    }
}
