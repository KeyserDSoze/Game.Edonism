using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// Real ASP.NET Core long-poll requests: authorization and timeout are decided
/// by the store, not the browser's guessed turn state.
/// </summary>
public sealed class DevelopmentLongPollingEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid Id, string Alice, string Bob)> Create(HttpClient creator)
    {
        using var response = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var root = json!.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            seats[0].GetProperty("token").GetString()!,
            seats[1].GetProperty("token").GetString()!);
    }

    private static async Task<HttpResponseMessage> Read(
        HttpClient client, Guid matchId, string? etag = null,
        string? prefer = null, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"/api/dev/matches/{matchId}");
        if (etag is not null)
            request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        if (prefer is not null)
            request.Headers.TryAddWithoutValidation("Prefer", prefer);
        return await client.SendAsync(request, cancellationToken);
    }

    private static void CheckPrivacy(HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
    }

    [Fact]
    public async Task QuietMatchTimesOutAs304WithoutBodyOrGameMutation()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        const string current = "W/\"edonism-revision-0\"";

        var watch = Stopwatch.StartNew();
        using var quiet = await Read(alice, id, current, "wait=1");
        watch.Stop();
        Assert.Equal(HttpStatusCode.NotModified, quiet.StatusCode);
        Assert.True(watch.Elapsed >= TimeSpan.FromMilliseconds(750),
            "An authenticated long poll should wait for a quiet match.");
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(4));
        Assert.Equal(current, quiet.Headers.ETag?.ToString());
        Assert.Empty(await quiet.Content.ReadAsByteArrayAsync());
        CheckPrivacy(quiet);

        using var state = await Read(alice, id);
        using var json = await state.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(0, json!.RootElement.GetProperty("revision").GetInt64());
        Assert.Single(json.RootElement.GetProperty("events").EnumerateArray());
    }

    [Fact]
    public async Task AcceptedTurnWakesBothSeatWaitersAndReportsExactRevision()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        const string current = "W/\"edonism-revision-0\"";

        var waitAlice = Read(alice, id, current, "wait=5");
        var waitBob = Read(bob, id, current, "wait=5");
        await Task.Delay(250);
        using var end = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, end.StatusCode);

        using var changedAlice = await waitAlice.WaitAsync(TimeSpan.FromSeconds(3));
        using var changedBob = await waitBob.WaitAsync(TimeSpan.FromSeconds(3));
        foreach (var response in new[] { changedAlice, changedBob })
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("W/\"edonism-revision-1\"", response.Headers.ETag?.ToString());
            CheckPrivacy(response);
            using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal(1, json!.RootElement.GetProperty("revision").GetInt64());
            Assert.Equal("bob", json.RootElement.GetProperty("activePlayerId").GetString());
            Assert.Equal(2, json.RootElement.GetProperty("events").GetArrayLength());
        }
    }

    [Fact]
    public async Task TokenRotationWakesRevokedWaiterWithoutAdvancingPublicRevision()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        const string current = "W/\"edonism-revision-0\"";

        var alicePending = Read(alice, id, current, "wait=5");
        var bobPending = Read(bob, id, current, "wait=5");
        await Task.Delay(250);
        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var json = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var newToken = json!.RootElement.GetProperty("token").GetString()!;

        using var denied = await alicePending.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        CheckPrivacy(denied);
        using var stillSame = await bobPending.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(HttpStatusCode.NotModified, stillSame.StatusCode);
        Assert.Equal(current, stillSame.Headers.ETag?.ToString());
        CheckPrivacy(stillSame);
        using var refreshed = Seat(host, newToken);
        using var newAccess = await Read(refreshed, id);
        Assert.Equal(HttpStatusCode.OK, newAccess.StatusCode);
        Assert.Equal(current, newAccess.Headers.ETag?.ToString());
        using var stillDenied = await Read(alice, id, current, "wait=5");
        Assert.Equal(HttpStatusCode.NotFound, stillDenied.StatusCode);
    }

    [Fact]
    public async Task CancellationRemovesWaiterAndDoesNotPreventLaterChanges()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var aborted = new CancellationTokenSource();
        var pending = Read(bob, id, "W/\"edonism-revision-0\"", "wait=10",
            aborted.Token);
        await Task.Delay(100);
        aborted.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await pending);

        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var bobAfter = await Read(bob, id, "W/\"edonism-revision-0\"", "wait=5");
        Assert.Equal(HttpStatusCode.OK, bobAfter.StatusCode);
        Assert.Equal("W/\"edonism-revision-1\"", bobAfter.Headers.ETag?.ToString());
    }

    [Fact]
    public async Task InvalidOrUnconditionalWaitCannotKeepConnectionOpen()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        const string tag = "W/\"edonism-revision-0\"";
        foreach (var preference in new[] { "wait=0", "wait=11", "wait=99999", "wait=abc", "respond-async" })
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var result = await Read(alice, id, tag, preference, cts.Token);
            Assert.Equal(HttpStatusCode.NotModified, result.StatusCode);
            CheckPrivacy(result);
        }

        using var noTagCts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        using var noTag = await Read(alice, id, prefer: "wait=10",
            cancellationToken: noTagCts.Token);
        Assert.Equal(HttpStatusCode.OK, noTag.StatusCode);
        using var wrongTagCts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        using var wrongTag = await Read(alice, id, "W/\"edonism-revision-999\"",
            "wait=10", wrongTagCts.Token);
        Assert.Equal(HttpStatusCode.OK, wrongTag.StatusCode);

        using var noAuth = await Read(creator, id, tag, "wait=5");
        Assert.Equal(HttpStatusCode.NotFound, noAuth.StatusCode);
        CheckPrivacy(noAuth);
    }

    [Fact]
    public async Task ProductionDoesNotExposeDevelopmentLongPoll()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await Read(client, Guid.NewGuid(),
            "W/\"edonism-revision-0\"", "wait=5");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
