using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #77: mixed free-move/end-turn contention at the real Development HTTP boundary.
/// The test accepts either scheduler winner while enforcing one authoritative commit.
/// </summary>
public sealed class DevelopmentMixedCommandContentionTests
{
    private sealed record Seat(string PlayerId, string Token);

    private sealed record Attempt(
        string Kind,
        int SeatIndex,
        HttpStatusCode Status,
        string Body,
        string? CacheControl);

    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static async Task<(Guid MatchId, Seat[] Seats)> Create(
        HttpClient creator, int count)
    {
        var players = BoardCatalog.LoadDefault().Slots.Take(count)
            .Select((slot, index) => new
            {
                playerId = $"seat-{index}",
                startingSlotId = slot.Id,
            })
            .ToArray();

        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/", new { players });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(document);
        var root = document.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray()
            .Select(element => new Seat(
                element.GetProperty("playerId").GetString()!,
                element.GetProperty("token").GetString()!))
            .ToArray();

        Assert.Equal(count, seats.Length);
        Assert.Equal(count, seats.Select(seat => seat.Token).Distinct().Count());
        Assert.Equal(players.Select(player => player.playerId),
            seats.Select(seat => seat.PlayerId));
        return (root.GetProperty("matchId").GetGuid(), seats);
    }

    private static async Task<string> ReadSnapshot(HttpClient client, Guid matchId)
    {
        using var response = await client.GetAsync($"/api/dev/matches/{matchId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        return await response.Content.ReadAsStringAsync();
    }

    private static async Task<Attempt> PostEndTurn(
        HttpClient client, Guid matchId, long expectedRevision, int seatIndex)
    {
        using var response = await client.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/end-turn", new { expectedRevision });
        return new Attempt(
            "end-turn",
            seatIndex,
            response.StatusCode,
            await response.Content.ReadAsStringAsync(),
            response.Headers.CacheControl?.ToString());
    }

    private static async Task<Attempt> PostFreeMove(
        HttpClient client,
        Guid matchId,
        string destinationStreetId,
        long expectedRevision,
        int seatIndex)
    {
        using var response = await client.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/free-move",
            new { destinationStreetId, expectedRevision });
        return new Attempt(
            "free-move",
            seatIndex,
            response.StatusCode,
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
    public async Task MixedMoveAndEndTurnRaceCommitsOneAuthoritativeCommand(int count)
    {
        var board = BoardCatalog.LoadDefault();
        using var host = Host();
        using var creator = host.CreateClient();
        var (matchId, seats) = await Create(creator, count);

        var clients = seats.Select(seat =>
        {
            var client = host.CreateClient();
            client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", seat.Token);
            return client;
        }).ToArray();

        try
        {
            long expectedRevision = 0;

            for (var current = 0; current < count; current++)
            {
                var beforeJson = await ReadSnapshot(clients[0], matchId);
                string fromStreet;
                using (var before = JsonDocument.Parse(beforeJson))
                {
                    var state = before.RootElement;
                    Assert.Equal(expectedRevision,
                        state.GetProperty("revision").GetInt64());
                    Assert.Equal(seats[current].PlayerId,
                        state.GetProperty("activePlayerId").GetString());
                    Assert.Equal(0, state.GetProperty("phase").GetInt32());

                    var player = state.GetProperty("players").EnumerateArray()
                        .Single(p => p.GetProperty("playerId").GetString()
                            == seats[current].PlayerId);
                    fromStreet = player.GetProperty("streetId").GetString()!;
                    Assert.False(player.GetProperty("freeMoveUsed").GetBoolean());
                }

                var destination = board.Streets
                    .Single(street => street.Id == fromStreet)
                    .Neighbors[0];

                var release = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously);

                var requests = new List<Task<Attempt>>
                {
                    Task.Run(async () =>
                    {
                        await release.Task;
                        return await PostFreeMove(
                            clients[current], matchId, destination,
                            expectedRevision, current);
                    }),
                    Task.Run(async () =>
                    {
                        await release.Task;
                        return await PostEndTurn(
                            clients[current], matchId, expectedRevision, current);
                    }),
                };

                for (var seatIndex = 0; seatIndex < count; seatIndex++)
                {
                    if (seatIndex == current) continue;
                    var capturedSeat = seatIndex;
                    requests.Add(Task.Run(async () =>
                    {
                        await release.Task;
                        return await PostEndTurn(
                            clients[capturedSeat], matchId,
                            expectedRevision, capturedSeat);
                    }));
                }

                release.SetResult();
                var outcomes = await Task.WhenAll(requests);

                Assert.Equal(count + 1, outcomes.Length);
                var winner = Assert.Single(outcomes,
                    outcome => outcome.Status == HttpStatusCode.OK);
                Assert.Equal(current, winner.SeatIndex);
                Assert.Contains(winner.Kind, new[] { "free-move", "end-turn" });
                Assert.Equal(count, outcomes.Count(
                    outcome => outcome.Status == HttpStatusCode.Conflict));

                Assert.All(outcomes, outcome =>
                {
                    Assert.Equal("no-store", outcome.CacheControl);
                    foreach (var seat in seats)
                        Assert.DoesNotContain(seat.Token, outcome.Body);
                });

                foreach (var rejection in outcomes.Where(
                    outcome => outcome.Status == HttpStatusCode.Conflict))
                {
                    using var error = JsonDocument.Parse(rejection.Body);
                    var code = error.RootElement.GetProperty("code").GetString();
                    Assert.Contains(code,
                        new[] { "not_your_turn", "revision_conflict" });
                    Assert.Single(error.RootElement.EnumerateObject());
                }

                expectedRevision++;
                var afterRaceStates = await Task.WhenAll(clients.Select(
                    client => ReadSnapshot(client, matchId)));
                Assert.All(afterRaceStates,
                    state => Assert.Equal(afterRaceStates[0], state));

                using (var afterRace = JsonDocument.Parse(afterRaceStates[0]))
                {
                    var state = afterRace.RootElement;
                    Assert.Equal(expectedRevision,
                        state.GetProperty("revision").GetInt64());
                    Assert.Equal(expectedRevision + 1,
                        state.GetProperty("events").GetArrayLength());

                    var lastEvent = state.GetProperty("events")[^1];
                    Assert.Equal(seats[current].PlayerId,
                        lastEvent.GetProperty("actorId").GetString());

                    var currentPlayer = state.GetProperty("players")
                        .EnumerateArray()
                        .Single(p => p.GetProperty("playerId").GetString()
                            == seats[current].PlayerId);

                    if (winner.Kind == "free-move")
                    {
                        Assert.Equal("free-move",
                            lastEvent.GetProperty("kind").GetString());
                        Assert.Equal(fromStreet,
                            lastEvent.GetProperty("fromStreetId").GetString());
                        Assert.Equal(destination,
                            lastEvent.GetProperty("toStreetId").GetString());
                        Assert.Equal(seats[current].PlayerId,
                            state.GetProperty("activePlayerId").GetString());
                        Assert.Equal(destination,
                            currentPlayer.GetProperty("streetId").GetString());
                        Assert.True(
                            currentPlayer.GetProperty("freeMoveUsed").GetBoolean());
                    }
                    else
                    {
                        Assert.Equal(current == count - 1
                                ? "round-settlement-pending"
                                : "turn-ended",
                            lastEvent.GetProperty("kind").GetString());
                        Assert.Equal(fromStreet,
                            currentPlayer.GetProperty("streetId").GetString());
                        Assert.False(
                            currentPlayer.GetProperty("freeMoveUsed").GetBoolean());
                    }
                }

                if (winner.Kind == "free-move")
                {
                    var endTurn = await PostEndTurn(
                        clients[current], matchId, expectedRevision, current);
                    Assert.Equal(HttpStatusCode.OK, endTurn.Status);
                    Assert.Equal("no-store", endTurn.CacheControl);
                    foreach (var seat in seats)
                        Assert.DoesNotContain(seat.Token, endTurn.Body);
                    expectedRevision++;
                }

                var normalizedStates = await Task.WhenAll(clients.Select(
                    client => ReadSnapshot(client, matchId)));
                Assert.All(normalizedStates,
                    state => Assert.Equal(normalizedStates[0], state));

                using (var normalized = JsonDocument.Parse(normalizedStates[0]))
                {
                    var state = normalized.RootElement;
                    Assert.Equal(expectedRevision,
                        state.GetProperty("revision").GetInt64());
                    Assert.Equal(expectedRevision + 1,
                        state.GetProperty("events").GetArrayLength());

                    var lastEvent = state.GetProperty("events")[^1];
                    Assert.Equal(seats[current].PlayerId,
                        lastEvent.GetProperty("actorId").GetString());
                    Assert.Equal(current == count - 1
                            ? "round-settlement-pending"
                            : "turn-ended",
                        lastEvent.GetProperty("kind").GetString());

                    Assert.Equal(current == count - 1 ? 1 : 0,
                        state.GetProperty("phase").GetInt32());
                    if (current == count - 1)
                    {
                        Assert.Equal(JsonValueKind.Null,
                            state.GetProperty("activePlayerId").ValueKind);
                    }
                    else
                    {
                        Assert.Equal(seats[current + 1].PlayerId,
                            state.GetProperty("activePlayerId").GetString());
                    }

                    var currentPlayer = state.GetProperty("players")
                        .EnumerateArray()
                        .Single(p => p.GetProperty("playerId").GetString()
                            == seats[current].PlayerId);
                    Assert.Equal(winner.Kind == "free-move"
                            ? destination
                            : fromStreet,
                        currentPlayer.GetProperty("streetId").GetString());
                    Assert.Equal(winner.Kind == "free-move",
                        currentPlayer.GetProperty("freeMoveUsed").GetBoolean());

                    Assert.All(state.GetProperty("players").EnumerateArray(),
                        player =>
                        {
                            Assert.Equal(4,
                                player.GetProperty("atoms").GetInt32());
                            Assert.Equal(2,
                                player.GetProperty("diplomacyTokens").GetInt32());
                            Assert.Equal(15,
                                player.GetProperty("henchmenAvailable").GetInt32());
                        });
                    foreach (var seat in seats)
                        Assert.DoesNotContain(seat.Token, normalizedStates[0]);
                }

                using var auditResponse = await clients[0].GetAsync(
                    $"/api/dev/matches/{matchId}/audit");
                Assert.Equal(HttpStatusCode.OK, auditResponse.StatusCode);
                using var audit =
                    await auditResponse.Content.ReadFromJsonAsync<JsonDocument>();
                Assert.NotNull(audit);
                Assert.True(
                    audit.RootElement.GetProperty("isValid").GetBoolean());
                Assert.Equal(expectedRevision,
                    audit.RootElement.GetProperty("verifiedRevision").GetInt64());
            }

            var finalState = await ReadSnapshot(clients[0], matchId);
            using (var pending = JsonDocument.Parse(finalState))
            {
                Assert.Equal(1,
                    pending.RootElement.GetProperty("phase").GetInt32());
                Assert.Equal(JsonValueKind.Null,
                    pending.RootElement.GetProperty("activePlayerId").ValueKind);
            }

            foreach (var client in clients)
            {
                var denied = await PostEndTurn(
                    client, matchId, expectedRevision, 0);
                Assert.Equal(HttpStatusCode.Conflict, denied.Status);
                Assert.Equal("no-store", denied.CacheControl);
                using var error = JsonDocument.Parse(denied.Body);
                Assert.Equal("round_settlement_pending",
                    error.RootElement.GetProperty("code").GetString());
            }

            Assert.Equal(finalState,
                await ReadSnapshot(clients[0], matchId));
        }
        finally
        {
            foreach (var client in clients) client.Dispose();
        }
    }
}
