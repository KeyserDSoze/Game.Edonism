using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #80: two simultaneous rotations of the same old bearer, for every seat
/// at once, must produce only one successor per actor. No game mutation.
/// </summary>
public sealed class DevelopmentParallelSeatRotationTests
{
    private sealed record Seat(string PlayerId, string Token);
    private sealed record Rotation(int ActorIndex, HttpResponseMessage Response);

    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static HttpClient AsSeat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid Id, Seat[] Seats)> Create(HttpClient creator, int count)
    {
        var players = BoardCatalog.LoadDefault().Slots.Take(count)
            .Select((slot, i) => new
            {
                playerId = $"seat-{i}",
                startingSlotId = slot.Id
            }).ToArray();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/", new { players });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var seats = json.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(x => new Seat(
                x.GetProperty("playerId").GetString()!,
                x.GetProperty("token").GetString()!)).ToArray();
        Assert.Equal(count, seats.Length);
        Assert.Equal(count, seats.Select(s => s.Token).Distinct().Count());
        return (json.RootElement.GetProperty("matchId").GetGuid(), seats);
    }

    private static void NoStore(HttpResponseMessage response) =>
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task DoubleRotationForAllSeatsPublishesOneSuccessorEach(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, seats) = await Create(creator, count);
        var initialClients = seats.Select(s => AsSeat(host, s.Token)).ToArray();
        var release = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        const string revisionTag = "W/\"edonism-revision-0\"";

        try
        {
            using var beforeResponse = await initialClients[0].GetAsync(
                $"/api/dev/matches/{id}");
            Assert.Equal(HttpStatusCode.OK, beforeResponse.StatusCode);
            NoStore(beforeResponse);
            var before = await beforeResponse.Content.ReadAsStringAsync();

            // All seats race with themselves and with the other seats.
            // The winner must depend only on the match lock ordering, never
            // on client scheduling. Distinct HTTP clients prevent shared
            // mutable request state.
            var clients = Enumerable.Range(0, count).SelectMany(index =>
                Enumerable.Range(0, 2).Select(_ => (index, client:
                    AsSeat(host, seats[index].Token)))).ToArray();
            try
            {
                var attempts = clients.Select(item => Task.Run(async () =>
                {
                    await release.Task;
                    return new Rotation(item.index, await item.client.PostAsync(
                        $"/api/dev/matches/{id}/rotate-token", null));
                })).ToArray();
                release.SetResult();
                var outcomes = await Task.WhenAll(attempts);
                try
                {
                    var successors = new Seat[count];
                    foreach (var group in outcomes.GroupBy(o => o.ActorIndex))
                    {
                        Assert.Equal(2, group.Count());
                        var winner = Assert.Single(group, r =>
                            r.Response.StatusCode == HttpStatusCode.OK);
                        var loser = Assert.Single(group, r =>
                            r.Response.StatusCode == HttpStatusCode.NotFound);
                        NoStore(winner.Response);
                        NoStore(loser.Response);

                        using var denied = await loser.Response.Content
                            .ReadFromJsonAsync<JsonDocument>();
                        Assert.NotNull(denied);
                        Assert.Equal("match_not_found",
                            denied.RootElement.GetProperty("code").GetString());
                        var body = await winner.Response.Content
                            .ReadFromJsonAsync<JsonDocument>();
                        Assert.NotNull(body);
                        using (body)
                        {
                            var seat = new Seat(
                                body.RootElement.GetProperty("playerId").GetString()!,
                                body.RootElement.GetProperty("token").GetString()!);
                            Assert.Equal(seats[group.Key].PlayerId, seat.PlayerId);
                            Assert.NotEqual(seats[group.Key].Token, seat.Token);
                            successors[group.Key] = seat;
                        }
                    }
                    Assert.Equal(count,
                        successors.Select(s => s.Token).Distinct().Count());
                    Assert.All(successors, successor =>
                        Assert.DoesNotContain(successor.Token,
                            seats.Select(s => s.Token)));

                    // The old bearer has no ability to read even the public
                    // snapshot, its own seat bootstrap, or another rotation.
                    for (var i = 0; i < count; i++)
                    {
                        using var denied = await initialClients[i].GetAsync(
                            $"/api/dev/matches/{id}");
                        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
                        NoStore(denied);
                        using var deniedSeat = await initialClients[i].GetAsync(
                            $"/api/dev/matches/{id}/seat");
                        Assert.Equal(HttpStatusCode.NotFound, deniedSeat.StatusCode);
                        NoStore(deniedSeat);
                        using var deniedRotate = await initialClients[i].PostAsync(
                            $"/api/dev/matches/{id}/rotate-token", null);
                        Assert.Equal(HttpStatusCode.NotFound, deniedRotate.StatusCode);
                        NoStore(deniedRotate);
                    }

                    for (var i = 0; i < count; i++)
                    {
                        using var current = AsSeat(host, successors[i].Token);
                        using var snapshotResponse = await current.GetAsync(
                            $"/api/dev/matches/{id}");
                        Assert.Equal(HttpStatusCode.OK, snapshotResponse.StatusCode);
                        Assert.Equal(revisionTag,
                            snapshotResponse.Headers.ETag?.ToString());
                        NoStore(snapshotResponse);
                        Assert.Equal(before,
                            await snapshotResponse.Content.ReadAsStringAsync());

                        using var bootstrapResponse = await current.GetAsync(
                            $"/api/dev/matches/{id}/seat");
                        Assert.Equal(HttpStatusCode.OK, bootstrapResponse.StatusCode);
                        NoStore(bootstrapResponse);
                        using var bootstrap = await bootstrapResponse.Content
                            .ReadFromJsonAsync<JsonDocument>();
                        Assert.NotNull(bootstrap);
                        Assert.Equal(seats[i].PlayerId,
                            bootstrap.RootElement.GetProperty("playerId").GetString());
                        Assert.Equal(0,
                            bootstrap.RootElement.GetProperty("state")
                                .GetProperty("revision").GetInt64());
                        Assert.Equal(seats[i].PlayerId,
                            bootstrap.RootElement.GetProperty("hand")
                                .GetProperty("playerId").GetString());

                        using var auditResponse = await current.GetAsync(
                            $"/api/dev/matches/{id}/audit");
                        Assert.Equal(HttpStatusCode.OK, auditResponse.StatusCode);
                        NoStore(auditResponse);
                        using var audit = await auditResponse.Content
                            .ReadFromJsonAsync<JsonDocument>();
                        Assert.NotNull(audit);
                        Assert.True(audit.RootElement.GetProperty("isValid").GetBoolean());
                        Assert.Equal(0,
                            audit.RootElement.GetProperty("verifiedRevision").GetInt64());
                    }

                    // Each winner remains a usable capability that can rotate
                    // independently again; no token is silently orphaned.
                    using var nextClient = AsSeat(host, successors[0].Token);
                    using var nextRotate = await nextClient.PostAsync(
                        $"/api/dev/matches/{id}/rotate-token", null);
                    Assert.Equal(HttpStatusCode.OK, nextRotate.StatusCode);
                    NoStore(nextRotate);
                    using var nextBody = await nextRotate.Content
                        .ReadFromJsonAsync<JsonDocument>();
                    Assert.NotNull(nextBody);
                    var nextToken = nextBody.RootElement.GetProperty("token").GetString()!;
                    Assert.NotEqual(successors[0].Token, nextToken);
                    using var replaced = await nextClient.GetAsync(
                        $"/api/dev/matches/{id}");
                    Assert.Equal(HttpStatusCode.NotFound, replaced.StatusCode);
                    using var newest = AsSeat(host, nextToken);
                    using var stillSame = await newest.GetAsync(
                        $"/api/dev/matches/{id}");
                    Assert.Equal(HttpStatusCode.OK, stillSame.StatusCode);
                    Assert.Equal(before, await stillSame.Content.ReadAsStringAsync());
                }
                finally
                {
                    foreach (var result in outcomes)
                        result.Response.Dispose();
                }
            }
            finally
            {
                foreach (var item in clients)
                    item.client.Dispose();
            }
        }
        finally
        {
            foreach (var client in initialClients)
                client.Dispose();
        }
    }
}
