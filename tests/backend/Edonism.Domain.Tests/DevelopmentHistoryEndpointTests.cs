using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// No user-supplied playerId or private card catalog can authorize history.
/// The actor-bound endpoint only returns Domain-verified public first-round frames.
/// </summary>
public sealed class DevelopmentHistoryEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment(environment));

    private static HttpClient Actor(WebApplicationFactory<Program> host, string bearer)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bearer);
        return client;
    }

    [Fact]
    public async Task HistoryIsAuthenticatedAndFollowsMovesAcrossActorsWithoutPrivateData()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        using var createdResponse = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
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
        var id = created!.RootElement.GetProperty("matchId").GetGuid();
        var credentials = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = credentials[0].GetProperty("token").GetString()!;
        var bobToken = credentials[1].GetProperty("token").GetString()!;
        var url = $"/api/dev/matches/{id}/history";

        using var anonymous = await creator.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var forged = Actor(host, new string('0', 64));
        using var denied = await forged.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var alice = Actor(host, aliceToken);
        using var first = await alice.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("no-store", first.Headers.CacheControl?.ToString());
        using var genesis = await first.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(id, genesis!.RootElement.GetProperty("matchId").GetGuid());
        Assert.Equal(0, genesis.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Single(genesis.RootElement.GetProperty("frames").EnumerateArray());
        var firstStreet = created.RootElement.GetProperty("state")
            .GetProperty("players")[0].GetProperty("streetId").GetString()!;
        Assert.Equal(firstStreet, genesis.RootElement.GetProperty("frames")[0]
            .GetProperty("players")[0].GetProperty("streetId").GetString());
        // Full-deck character setup is authoritative; never assume Alice
        // starts on Gauss, or that Planck is always adjacent.
        using var options = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/turn-options");
        Assert.NotNull(options);
        var destination = options.RootElement.GetProperty("freeMoveStreetIds")[0].GetString()!;
        Assert.NotEqual(firstStreet, destination);
        using var moved = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = destination, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        using var ended = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, ended.StatusCode);

        using var bob = Actor(host, bobToken);
        using var next = await bob.GetAsync(url + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        Assert.Equal("no-store", next.Headers.CacheControl?.ToString());
        var text = await next.Content.ReadAsStringAsync();
        using var history = JsonDocument.Parse(text);
        Assert.Equal(2, history.RootElement.GetProperty("verifiedRevision").GetInt64());
        var frames = history.RootElement.GetProperty("frames").EnumerateArray().ToArray();
        Assert.Equal(3, frames.Length);
        Assert.Equal(new long[] { 0, 1, 2 },
            frames.Select(f => f.GetProperty("revision").GetInt64()));
        Assert.Equal(firstStreet, frames[0].GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.Equal(destination, frames[1].GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.Equal("bob", frames[2].GetProperty("activePlayerId").GetString());
        Assert.DoesNotContain(aliceToken, text);
        Assert.DoesNotContain(bobToken, text);
        Assert.DoesNotContain("cardIds", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("actionCard", text, StringComparison.OrdinalIgnoreCase);

        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var tokenBody = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var replaced = tokenBody!.RootElement.GetProperty("token").GetString()!;
        using var revoked = await alice.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var renewed = Actor(host, replaced);
        using var newHistory = await renewed.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, newHistory.StatusCode);
        using var bobStill = await bob.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, bobStill.StatusCode);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task EverySeatReceivesOnlyWhitelistedPublicHistoryFields(
        int seatCount)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, seatCount)
            .Select(index => $"player-{index}").ToArray();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var id = created.RootElement.GetProperty("matchId").GetGuid();
        var credentials = created.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(c => (
                PlayerId: c.GetProperty("playerId").GetString()!,
                Token: c.GetProperty("token").GetString()!)).ToArray();

        using var actor = Actor(host, credentials[0].Token);
        using var options = await actor.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/turn-options");
        Assert.NotNull(options);
        var destination = options.RootElement.GetProperty("freeMoveStreetIds")[0]
            .GetString()!;
        using var moved = await actor.PostAsJsonAsync(
            $"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = destination, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        static string[] Keys(JsonElement element) =>
            element.EnumerateObject().Select(property => property.Name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();

        foreach (var credential in credentials)
        {
            using var seat = Actor(host, credential.Token);
            using var historyResponse =
                await seat.GetAsync($"/api/dev/matches/{id}/history");
            Assert.Equal(HttpStatusCode.OK, historyResponse.StatusCode);
            Assert.Equal("no-store", historyResponse.Headers.CacheControl?.ToString());
            var text = await historyResponse.Content.ReadAsStringAsync();
            using var history = JsonDocument.Parse(text);
            var root = history.RootElement;
            Assert.Equal(new[] { "frames", "matchId", "verifiedRevision" }, Keys(root));
            Assert.Equal(id, root.GetProperty("matchId").GetGuid());
            Assert.Equal(1, root.GetProperty("verifiedRevision").GetInt64());
            var frames = root.GetProperty("frames").EnumerateArray().ToArray();
            Assert.Equal(2, frames.Length);
            for (var revision = 0; revision < frames.Length; revision++)
            {
                var frame = frames[revision];
                Assert.Equal(new[] {
                    "activePlayerId", "actorId", "kind", "phase", "players", "revision"
                }, Keys(frame));
                Assert.Equal(revision, frame.GetProperty("revision").GetInt32());
                Assert.Equal(seatCount,
                    frame.GetProperty("players").GetArrayLength());
                foreach (var player in frame.GetProperty("players").EnumerateArray())
                {
                    Assert.Equal(new[] { "freeMoveUsed", "playerId", "streetId" },
                        Keys(player));
                    Assert.Contains(player.GetProperty("playerId").GetString()!, players);
                    Assert.False(string.IsNullOrWhiteSpace(
                        player.GetProperty("streetId").GetString()));
                }
            }

            foreach (var secret in credentials.Select(c => c.Token))
                Assert.DoesNotContain(secret, text);
            using var handResponse =
                await seat.GetAsync($"/api/dev/matches/{id}/hand");
            using var hand = await handResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(hand);
            foreach (var card in hand.RootElement.GetProperty("cardIds").EnumerateArray())
                Assert.DoesNotContain(card.GetString()!, text);
            Assert.DoesNotContain("cardIds", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("drawPile", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("token", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("digest", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task PublicReplayAcrossAllSeatsCompletesFirstRoundInStrictTurnOrder(
        int seatCount)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, seatCount)
            .Select(index => $"player-{index}").ToArray();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = ids,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(c => c.GetProperty("token").GetString()!)
            .ToArray();
        Assert.Equal(seatCount, tokens.Length);

        for (var index = 0; index < tokens.Length; index++)
        {
            using var actor = Actor(host, tokens[index]);
            using var turn = await actor.PostAsJsonAsync(
                $"/api/dev/matches/{matchId}/end-turn",
                new { expectedRevision = index });
            Assert.Equal(HttpStatusCode.OK, turn.StatusCode);
        }

        foreach (var token in tokens)
        {
            using var actor = Actor(host, token);
            using var response = await actor.GetAsync(
                $"/api/dev/matches/{matchId}/history");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            var text = await response.Content.ReadAsStringAsync();
            using var history = JsonDocument.Parse(text);
            Assert.Equal(seatCount,
                history.RootElement.GetProperty("verifiedRevision").GetInt64());
            var frames = history.RootElement.GetProperty("frames")
                .EnumerateArray().ToArray();
            Assert.Equal(seatCount + 1, frames.Length);
            for (var revision = 0; revision < frames.Length; revision++)
            {
                var frame = frames[revision];
                Assert.Equal(revision,
                    frame.GetProperty("revision").GetInt32());
                Assert.Equal(seatCount,
                    frame.GetProperty("players").GetArrayLength());
                if (revision == 0)
                {
                    Assert.Equal("match-created",
                        frame.GetProperty("kind").GetString());
                    Assert.Equal(ids[0],
                        frame.GetProperty("activePlayerId").GetString());
                }
                else if (revision < seatCount)
                {
                    Assert.Equal("turn-ended",
                        frame.GetProperty("kind").GetString());
                    Assert.Equal(ids[revision - 1],
                        frame.GetProperty("actorId").GetString());
                    Assert.Equal(ids[revision],
                        frame.GetProperty("activePlayerId").GetString());
                    Assert.Equal(0, frame.GetProperty("phase").GetInt32());
                }
                else
                {
                    Assert.Equal("round-settlement-pending",
                        frame.GetProperty("kind").GetString());
                    Assert.Equal(ids[^1],
                        frame.GetProperty("actorId").GetString());
                    Assert.Equal(1, frame.GetProperty("phase").GetInt32());
                    Assert.Equal(JsonValueKind.Null,
                        frame.GetProperty("activePlayerId").ValueKind);
                }
                Assert.All(frame.GetProperty("players").EnumerateArray(),
                    player => Assert.False(player.GetProperty("freeMoveUsed").GetBoolean()));
            }
            foreach (var secret in tokens)
                Assert.DoesNotContain(secret, text);
            Assert.DoesNotContain("cardIds", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("token", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task PublicMovementFramesExposeExactlyEachActorsCurrentPosition(
        int seatCount)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, seatCount)
            .Select(i => $"player-{i}").ToArray();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
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
        var credentials = created.RootElement.GetProperty("credentials")
            .EnumerateArray().ToArray();
        var initial = created.RootElement.GetProperty("state")
            .GetProperty("players").EnumerateArray().ToArray();

        using var firstActor = Actor(host,
            credentials[0].GetProperty("token").GetString()!);
        using var options = await firstActor.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}/turn-options");
        Assert.NotNull(options);
        var destination = options.RootElement
            .GetProperty("freeMoveStreetIds")[0].GetString()!;
        using var moved = await firstActor.PostAsJsonAsync(
            $"/api/dev/matches/{matchId}/free-move",
            new { destinationStreetId = destination, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        // Any other authorized seat must see exactly the same PUBLIC frame
        // progression without gaining the first actor's private cards.
        using var reader = Actor(host,
            credentials[1].GetProperty("token").GetString()!);
        using var historyResponse = await reader.GetAsync(
            $"/api/dev/matches/{matchId}/history");
        Assert.Equal(HttpStatusCode.OK, historyResponse.StatusCode);
        var json = await historyResponse.Content.ReadAsStringAsync();
        using var history = JsonDocument.Parse(json);
        Assert.Equal(1,
            history.RootElement.GetProperty("verifiedRevision").GetInt64());
        var frames = history.RootElement.GetProperty("frames")
            .EnumerateArray().ToArray();
        Assert.Equal(2, frames.Length);
        Assert.Equal("match-created",
            frames[0].GetProperty("kind").GetString());
        Assert.Equal("free-move",
            frames[1].GetProperty("kind").GetString());
        Assert.Equal(players[0],
            frames[1].GetProperty("actorId").GetString());
        Assert.Equal(players[0],
            frames[1].GetProperty("activePlayerId").GetString());

        for (var i = 0; i < seatCount; i++)
        {
            var before = frames[0].GetProperty("players")[i];
            var after = frames[1].GetProperty("players")[i];
            var origin = initial[i].GetProperty("streetId").GetString();
            Assert.Equal(players[i], before.GetProperty("playerId").GetString());
            Assert.Equal(players[i], after.GetProperty("playerId").GetString());
            Assert.Equal(origin, before.GetProperty("streetId").GetString());
            Assert.False(before.GetProperty("freeMoveUsed").GetBoolean());
            Assert.Equal(i == 0 ? destination : origin,
                after.GetProperty("streetId").GetString());
            Assert.Equal(i == 0,
                after.GetProperty("freeMoveUsed").GetBoolean());
        }

        foreach (var c in credentials)
            Assert.DoesNotContain(c.GetProperty("token").GetString()!, json);
        Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProductionDoesNotExposeReplayHistory()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync($"/api/dev/matches/{Guid.NewGuid()}/history");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
