using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// The long-poll actor quota protects other PvP seats from one client opening
/// excessive requests. All registrations happen under the match lock.
/// </summary>
public sealed class DevelopmentLongPollCapacityTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment(environment));

    private static DevMatchCreated Create(DevelopmentMatchStore store,
        IReadOnlyList<string>? seats = null) =>
        store.CreateWithFullDeck(seats ?? ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    private static HttpClient Actor(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<HttpResponseMessage> WaitGet(
        HttpClient client, Guid id, string tag = "W/\"edonism-revision-0\"",
        string preference = "wait=5", CancellationToken token = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"/api/dev/matches/{id}");
        request.Headers.TryAddWithoutValidation("If-None-Match", tag);
        request.Headers.TryAddWithoutValidation("Prefer", preference);
        return await client.SendAsync(request, token);
    }

    [Fact]
    public async Task FifthPendingWaitForOneActorGets429ButOtherSeatIsStillServed()
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
        using var json = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        var id = json!.RootElement.GetProperty("matchId").GetGuid();
        var credentials = json.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = credentials[0].GetProperty("token").GetString()!;
        var bobToken = credentials[1].GetProperty("token").GetString()!;
        var store = host.Services.GetRequiredService<DevelopmentMatchStore>();
        using var alice = Actor(host, aliceToken);
        using var bob = Actor(host, bobToken);
        using var abort = new CancellationTokenSource();
        var pendingAlice = Enumerable.Range(0,
            DevelopmentMatchStore.MaxPendingWaitsPerActor)
            .Select(_ => store.WaitForRevisionAsync(id, aliceToken, 0,
                TimeSpan.FromSeconds(10), abort.Token)).ToArray();
        Assert.All(pendingAlice, task => Assert.False(task.IsCompleted));

        var watch = Stopwatch.StartNew();
        using var overloaded = await WaitGet(alice, id);
        watch.Stop();
        Assert.Equal(HttpStatusCode.TooManyRequests, overloaded.StatusCode);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2));
        Assert.Equal("1", Assert.Single(overloaded.Headers.GetValues("Retry-After")));
        Assert.Equal("no-store", overloaded.Headers.CacheControl?.ToString());
        Assert.True(overloaded.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
        Assert.Null(overloaded.Headers.ETag);
        var message = await overloaded.Content.ReadAsStringAsync();
        Assert.DoesNotContain(aliceToken, message);
        Assert.DoesNotContain(bobToken, message);

        var pendingBob = store.WaitForRevisionAsync(id, bobToken, 0,
            TimeSpan.FromSeconds(10), abort.Token);
        Assert.False(pendingBob.IsCompleted);

        // A forged token never reaches a capacity check or learns the quota.
        using var anonymous = await WaitGet(creator, id);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var fake = Actor(host, new string('0', 64));
        using var unauthorized = await WaitGet(fake, id);
        Assert.Equal(HttpStatusCode.NotFound, unauthorized.StatusCode);

        using var accepted = await alice.PostAsJsonAsync(
            $"/api/dev/matches/{id}/end-turn", new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        foreach (var waiter in pendingAlice)
        {
            var result = await waiter.WaitAsync(TimeSpan.FromSeconds(2));
            Assert.True(result.Found);
            Assert.False(result.Saturated);
            Assert.Equal(1, result.State!.Revision);
        }
        var bobResult = await pendingBob.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(bobResult.Found);
        Assert.Equal(1, bobResult.State!.Revision);
        using var normal = await WaitGet(alice, id);
        Assert.Equal(HttpStatusCode.OK, normal.StatusCode);
        Assert.Equal("W/\"edonism-revision-1\"", normal.Headers.ETag?.ToString());
    }

    [Fact]
    public async Task EightSeatsCanSubscribeToAll32SlotsThenCancellationAndRevocationReleaseCapacity()
    {
        var store = new DevelopmentMatchStore();
        var seats = new[] { "alice", "bob", "charlie", "diana",
            "eve", "frank", "grace", "heidi" };
        var created = Create(store, seats);
        var id = created.MatchId;
        using var canceled = new CancellationTokenSource();
        var all = created.Credentials
            .SelectMany(cred => Enumerable.Range(0,
                DevelopmentMatchStore.MaxPendingWaitsPerActor)
                .Select(_ => (
                    PlayerId: cred.PlayerId,
                    Token: cred.Token,
                    Pending: store.WaitForRevisionAsync(id, cred.Token, 0,
                        TimeSpan.FromSeconds(10), canceled.Token))))
            .ToArray();
        Assert.Equal(DevelopmentMatchStore.MaxPendingWaitsPerMatch, all.Length);
        Assert.All(all, pending => Assert.False(pending.Pending.IsCompleted));

        var fifth = await store.WaitForRevisionAsync(id, created.Credentials[0].Token,
            0, TimeSpan.FromSeconds(1));
        Assert.True(fifth.Found);
        Assert.True(fifth.Saturated);
        Assert.Null(fifth.State);

        // Rotating Alice's current bearer wakes all clients. Her prior
        // requests cannot get 304, and other actors remain authorized.
        Assert.True(store.TryRotateSeatToken(id, created.Credentials[0].Token,
            out var replaced));
        var results = await Task.WhenAll(all.Select(x => x.Pending));
        Assert.Equal(4, results.Count(x => !x.Found));
        Assert.Equal(28, results.Count(x =>
            x.Found && !x.Saturated && x.State!.Revision == 0));

        var denied = await store.WaitForRevisionAsync(id,
            created.Credentials[0].Token, 0, TimeSpan.FromMilliseconds(50));
        Assert.False(denied.Found);
        Assert.False(denied.Saturated);
        var renewed = store.WaitForRevisionAsync(id, replaced!.Token, 0,
            TimeSpan.FromSeconds(5), canceled.Token);
        Assert.False(renewed.IsCompleted);
        canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            _ = await renewed;
        });
        var again = await store.WaitForRevisionAsync(id, replaced.Token, 0,
            TimeSpan.FromMilliseconds(60));
        Assert.True(again.Found);
        Assert.False(again.Saturated);
        Assert.Equal(0, again.State!.Revision);
    }

    [Fact]
    public async Task ActorSlotsAreFreedAfterTimeoutCancellationAndSuccessfulTurn()
    {
        var store = new DevelopmentMatchStore();
        var created = Create(store);
        var id = created.MatchId;
        var alice = created.Credentials[0].Token;
        using var cancelOne = new CancellationTokenSource();
        var waiters = Enumerable.Range(0,
            DevelopmentMatchStore.MaxPendingWaitsPerActor)
            .Select(_ => store.WaitForRevisionAsync(id, alice, 0,
                TimeSpan.FromSeconds(5), cancelOne.Token)).ToArray();
        Assert.True((await store.WaitForRevisionAsync(id, alice, 0,
            TimeSpan.FromMilliseconds(10))).Saturated);

        cancelOne.Cancel();
        foreach (var pending in waiters)
            await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            {
                _ = await pending;
            });

        var single = await store.WaitForRevisionAsync(id, alice, 0,
            TimeSpan.FromMilliseconds(80));
        Assert.True(single.Found);
        Assert.False(single.Saturated);
        Assert.Equal(0, single.State!.Revision);

        var notify = store.WaitForRevisionAsync(id, alice, 0,
            TimeSpan.FromSeconds(3));
        Assert.False(notify.IsCompleted);
        Assert.True(store.TryEndTurn(id, alice, 0, out var accepted));
        Assert.True(accepted!.Accepted);
        var updated = await notify.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(updated.Found);
        Assert.False(updated.Saturated);
        Assert.Equal(1, updated.State!.Revision);
    }

    [Fact]
    public async Task UnconditionalOrChangedEtagNeverEntersCapacityQueueAndProductionStaysDisabled()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var created = Create(host.Services.GetRequiredService<DevelopmentMatchStore>());
        using var alice = Actor(host, created.Credentials[0].Token);
        using var aborted = new CancellationTokenSource();
        var tasks = Enumerable.Range(0, DevelopmentMatchStore.MaxPendingWaitsPerActor)
            .Select(_ => host.Services.GetRequiredService<DevelopmentMatchStore>()
                .WaitForRevisionAsync(created.MatchId, created.Credentials[0].Token, 0,
                    TimeSpan.FromSeconds(5), aborted.Token)).ToArray();
        try
        {
            using var noEtag = await alice.GetAsync($"/api/dev/matches/{created.MatchId}");
            Assert.Equal(HttpStatusCode.OK, noEtag.StatusCode);
            using var wrongTag = await WaitGet(alice, created.MatchId,
                "W/\"edonism-revision-999\"", "wait=5");
            Assert.Equal(HttpStatusCode.OK, wrongTag.StatusCode);
            using var invalidWait = await WaitGet(alice, created.MatchId,
                preference: "wait=99999");
            Assert.Equal(HttpStatusCode.NotModified, invalidWait.StatusCode);
            using var productionHost = Host("Production");
            using var prodClient = productionHost.CreateClient();
            using var none = await WaitGet(prodClient, created.MatchId);
            Assert.Equal(HttpStatusCode.NotFound, none.StatusCode);
        }
        finally
        {
            aborted.Cancel();
            foreach (var task in tasks)
                await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
                {
                    _ = await task;
                });
        }
    }
}
