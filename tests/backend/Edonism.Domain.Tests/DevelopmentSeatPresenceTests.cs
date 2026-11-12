using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentSeatPresenceTests
{
    private sealed class ManualClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 11, 9, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow()
        {
            lock (this) return _now;
        }

        public void Advance(TimeSpan amount)
        {
            lock (this) _now += amount;
        }
    }

    private static DevMatchCreated Create(DevelopmentMatchStore store, int count = 2)
    {
        var slots = BoardCatalog.LoadDefault().Slots.Take(count).ToArray();
        var players = slots.Select((slot, index) =>
            new MatchParticipantSeed($"seat-{index}", slot.Id)).ToArray();
        return store.Create(players);
    }

    private static HttpClient AsSeat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Fact]
    public void PresenceIsExplicitAndDoesNotMutateAnyCanonicalGameplayState()
    {
        var clock = new ManualClock();
        var store = new DevelopmentMatchStore(timeProvider: clock);
        var created = Create(store);
        var id = created.MatchId;
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;

        Assert.True(store.TryRead(id, alice, out var before));
        Assert.True(store.TryReadPresence(id, alice, out var initial));
        Assert.Equal(id, initial!.MatchId);
        Assert.Equal(new[] { false, false },
            initial.Seats.Select(s => s.IsActive).ToArray());

        Assert.True(store.TryHeartbeat(id, alice, out var first));
        Assert.Equal(new[] { true, false },
            first!.Seats.Select(s => s.IsActive).ToArray());
        Assert.True(store.TryReadPresence(id, bob, out var observed));
        Assert.Equal(new[] { true, false },
            observed!.Seats.Select(s => s.IsActive).ToArray());
        Assert.True(store.TryHeartbeat(id, alice, out _));
        Assert.True(store.TryHeartbeat(id, bob, out var both));
        Assert.All(both!.Seats, s => Assert.True(s.IsActive));

        Assert.True(store.TryRead(id, alice, out var after));
        Assert.NotNull(before);
        Assert.NotNull(after);
        Assert.Equal(before!.MatchId, after!.MatchId);
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(before.Players.Select(p => p.StreetId),
            after.Players.Select(p => p.StreetId));
        Assert.Equal(before.Events.Select(e => e.Kind),
            after.Events.Select(e => e.Kind));
        Assert.Equal(0, after.Revision);
        Assert.Single(after.Events);
        Assert.Equal("seat-0", after.ActivePlayerId);
        Assert.True(store.TryReadHistory(id, alice, out var history));
        Assert.Equal(0, history!.VerifiedRevision);
        Assert.Single(history.Frames);
        Assert.DoesNotContain("Token", JsonSerializer.Serialize(both));
        Assert.DoesNotContain(alice, JsonSerializer.Serialize(both));
        Assert.DoesNotContain(bob, JsonSerializer.Serialize(both));
    }

    [Fact]
    public void TtlExpiresWithoutTimerOrGameRevisionAndReHeartbeatOnlyRenewsActor()
    {
        var clock = new ManualClock();
        var store = new DevelopmentMatchStore(timeProvider: clock);
        var created = Create(store);
        var id = created.MatchId;
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;

        Assert.True(store.TryHeartbeat(id, alice, out _));
        clock.Advance(TimeSpan.FromSeconds(14));
        Assert.True(store.TryReadPresence(id, bob, out var nearExpiry));
        Assert.True(nearExpiry!.Seats[0].IsActive);
        Assert.False(nearExpiry.Seats[1].IsActive);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(store.TryReadPresence(id, bob, out var expired));
        Assert.False(expired!.Seats[0].IsActive);
        Assert.True(store.TryHeartbeat(id, bob, out var onlyBob));
        Assert.False(onlyBob!.Seats[0].IsActive);
        Assert.True(onlyBob.Seats[1].IsActive);

        clock.Advance(TimeSpan.FromSeconds(10));
        Assert.True(store.TryHeartbeat(id, alice, out var both));
        Assert.All(both!.Seats, seat => Assert.True(seat.IsActive));
        clock.Advance(TimeSpan.FromSeconds(6));
        Assert.True(store.TryReadPresence(id, alice, out var onlyAlice));
        Assert.True(onlyAlice!.Seats[0].IsActive);
        Assert.False(onlyAlice.Seats[1].IsActive);
        Assert.True(store.TryRead(id, alice, out var snapshot));
        Assert.Equal(0, snapshot!.Revision);
    }

    [Fact]
    public void RotationInvalidatesOldBearerAndClearsOnlyThatSeatsPresence()
    {
        var store = new DevelopmentMatchStore(timeProvider: new ManualClock());
        var created = Create(store);
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;
        var id = created.MatchId;

        Assert.True(store.TryHeartbeat(id, alice, out _));
        Assert.True(store.TryHeartbeat(id, bob, out _));
        Assert.True(store.TryRotateSeatToken(id, alice, out var credential));
        Assert.NotNull(credential);
        Assert.Equal("seat-0", credential.PlayerId);
        Assert.False(store.TryHeartbeat(id, alice, out var forbidden));
        Assert.Null(forbidden);
        Assert.False(store.TryReadPresence(id, alice, out _));

        Assert.True(store.TryReadPresence(id, credential.Token, out var after));
        Assert.Equal(new[] { false, true },
            after!.Seats.Select(s => s.IsActive).ToArray());
        Assert.True(store.TryHeartbeat(id, credential.Token, out var renewed));
        Assert.All(renewed!.Seats, s => Assert.True(s.IsActive));
        Assert.True(store.TryRead(id, bob, out var snapshot));
        Assert.Equal(0, snapshot!.Revision);
    }

    [Fact]
    public void EightActorRegistryRemainsBoundedWithManyConcurrentHeartbeats()
    {
        var store = new DevelopmentMatchStore(timeProvider: new ManualClock());
        var created = Create(store, 8);
        var id = created.MatchId;
        Parallel.For(0, 512, i =>
        {
            var token = created.Credentials[i % 8].Token;
            Assert.True(store.TryHeartbeat(id, token, out var state));
            Assert.NotNull(state);
            Assert.Equal(8, state.Seats.Count);
        });

        Assert.True(store.TryReadPresence(id, created.Credentials[0].Token,
            out var everyone));
        Assert.Equal(8, everyone!.Seats.Count);
        Assert.All(everyone.Seats, s => Assert.True(s.IsActive));
        Assert.Equal(8, everyone.Seats.Select(s => s.PlayerId).Distinct().Count());

        var fake = new string('0', 64);
        Assert.False(store.TryHeartbeat(id, fake, out var unauthorized));
        Assert.Null(unauthorized);
        Assert.False(store.TryHeartbeat(Guid.NewGuid(), created.Credentials[0].Token, out _));
        Assert.True(store.TryRead(id, created.Credentials[0].Token, out var unchanged));
        Assert.Equal(0, unchanged!.Revision);
        Assert.Single(unchanged.Events);
    }

    [Fact]
    public async Task HeartbeatDoesNotWakeLongPollSubscribers()
    {
        var store = new DevelopmentMatchStore(timeProvider: new ManualClock());
        var created = Create(store);
        var token = created.Credentials[0].Token;
        var id = created.MatchId;
        var pending = store.WaitForRevisionAsync(
            id, token, 0, TimeSpan.FromMilliseconds(150));
        Assert.False(pending.IsCompleted);
        for (var i = 0; i < 10; i++)
            Assert.True(store.TryHeartbeat(id, token, out _));
        Assert.False(pending.IsCompleted);
        var completed = await pending.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(completed.Found);
        Assert.False(completed.Saturated);
        Assert.Equal(0, completed.State!.Revision);
    }

    [Fact]
    public async Task HttpPresenceIsBearerBoundNoStoreAndHiddenInProduction()
    {
        using var host = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
        using var creator = host.CreateClient();
        using var created = await creator.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[] {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var data = await created.Content.ReadFromJsonAsync<JsonDocument>();
        var id = data!.RootElement.GetProperty("matchId").GetGuid();
        var creds = data.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = creds[0].GetProperty("token").GetString()!;
        var bobToken = creds[1].GetProperty("token").GetString()!;
        var path = $"/api/dev/matches/{id}/presence";

        using var missing = await creator.GetAsync(path);
        using var deniedPost = await creator.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deniedPost.StatusCode);
        using var forged = AsSeat(host, new string('0', 64));
        using var fakeGet = await forged.GetAsync(path);
        using var fakePost = await forged.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, fakeGet.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, fakePost.StatusCode);

        using var alice = AsSeat(host, aliceToken);
        using var bob = AsSeat(host, bobToken);
        using var initial = await alice.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        using var initially = await initial.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.All(initially!.RootElement.GetProperty("seats").EnumerateArray().ToArray(),
            seat => Assert.False(seat.GetProperty("isActive").GetBoolean()));

        // #82: a client-supplied playerId body is no longer silently
        // discarded. Reject it before any heartbeat or seat identity change.
        using var bodySpoof = await alice.PostAsJsonAsync(
            path + "?playerId=bob", new { playerId = "bob" });
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, bodySpoof.StatusCode);
        Assert.Equal("no-store", bodySpoof.Headers.CacheControl?.ToString());
        using (var deniedJson = await bodySpoof.Content.ReadFromJsonAsync<JsonDocument>())
            Assert.Equal("dev_bodyless_payload_not_allowed",
                deniedJson!.RootElement.GetProperty("code").GetString());
        using (var untouched = await alice.GetFromJsonAsync<JsonDocument>(path))
            Assert.All(untouched!.RootElement.GetProperty("seats").EnumerateArray(),
                seat => Assert.False(seat.GetProperty("isActive").GetBoolean()));

        // The query string is still untrusted; empty-body POST marks only
        // Alice (resolved under the match lock), not the claimed Bob.
        using var heartbeat = await alice.PostAsync(path + "?playerId=bob", null);
        Assert.Equal(HttpStatusCode.OK, heartbeat.StatusCode);
        Assert.Equal("no-store", heartbeat.Headers.CacheControl?.ToString());
        Assert.Equal("no-cache", Assert.Single(heartbeat.Headers.Pragma).Name);
        Assert.False(heartbeat.Headers.Contains("ETag"));
        var raw = await heartbeat.Content.ReadAsStringAsync();
        using var state = JsonDocument.Parse(raw);
        Assert.Equal(id, state.RootElement.GetProperty("matchId").GetGuid());
        var seats = state.RootElement.GetProperty("seats").EnumerateArray().ToArray();
        Assert.Equal("alice", seats[0].GetProperty("playerId").GetString());
        Assert.True(seats[0].GetProperty("isActive").GetBoolean());
        Assert.Equal("bob", seats[1].GetProperty("playerId").GetString());
        Assert.False(seats[1].GetProperty("isActive").GetBoolean());
        Assert.DoesNotContain(aliceToken, raw);
        Assert.DoesNotContain(bobToken, raw);
        Assert.DoesNotContain("lastSeen", raw);
        Assert.DoesNotContain("Card", raw, StringComparison.OrdinalIgnoreCase);

        using var readByBob = await bob.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, readByBob.StatusCode);
        using var unchanged = await readByBob.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.True(unchanged!.RootElement.GetProperty("seats")[0]
            .GetProperty("isActive").GetBoolean());
        Assert.False(unchanged.RootElement.GetProperty("seats")[1]
            .GetProperty("isActive").GetBoolean());
        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var replacement = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var newToken = replacement!.RootElement.GetProperty("token").GetString()!;
        using var oldPost = await alice.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, oldPost.StatusCode);
        using var fresh = AsSeat(host, newToken);
        using var after = await fresh.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, after.StatusCode);
        using var afterData = await after.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.False(afterData!.RootElement.GetProperty("seats")[0]
            .GetProperty("isActive").GetBoolean());

        using var production = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var client = production.CreateClient();
        using var disabledGet = await client.GetAsync(path);
        using var disabledPost = await client.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, disabledGet.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, disabledPost.StatusCode);
    }
}
