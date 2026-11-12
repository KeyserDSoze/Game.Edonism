using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #83: a command and bearer rotation race must survive two completely new
/// HTTP application hosts backed by the same authenticated AES-GCM checkpoint.
/// Production multi-instance consistency and unapproved gameplay are excluded.
/// </summary>
public sealed class DevelopmentEncryptedCommandRotationRaceTests
{
    private sealed record Seat(string PlayerId, string Token);

    private sealed class TempDirectory : IDisposable
    {
        public string PathOnDisk { get; } = Path.Combine(Path.GetTempPath(),
            "edonism-http-command-rotation-" + Guid.NewGuid().ToString("N"));
        public string KeyHex { get; } =
            Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        public DevelopmentMatchCheckpointFiles Files() => new(PathOnDisk, KeyHex);

        public void Dispose()
        {
            if (Directory.Exists(PathOnDisk))
                Directory.Delete(PathOnDisk, recursive: true);
        }
    }

    private static WebApplicationFactory<Program> ApiFactory(TempDirectory directory) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DevelopmentMatchStore>();
                services.AddSingleton(new DevelopmentMatchStore(directory.Files()));
            });
        });

    private static HttpClient AsSeat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid Id, Seat[] Seats, string Origin)> Create(
        HttpClient creator, int seatCount)
    {
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = Enumerable.Range(0, seatCount)
                    .Select(i => $"seat-{i}").ToArray(),
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var root = json.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray()
            .Select(x => new Seat(x.GetProperty("playerId").GetString()!,
                x.GetProperty("token").GetString()!)).ToArray();
        Assert.Equal(seatCount, seats.Length);
        Assert.Equal(seatCount, seats.Select(x => x.Token).Distinct().Count());
        return (root.GetProperty("matchId").GetGuid(), seats,
            root.GetProperty("state").GetProperty("players")[0]
                .GetProperty("streetId").GetString()!);
    }

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, Guid id, string kind, string destination, string key)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/dev/matches/{id}/{kind}")
        {
            Content = JsonContent.Create(kind == "end-turn"
                ? (object)new { expectedRevision = 0 }
                : new { expectedRevision = 0, destinationStreetId = destination })
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request);
    }

    private static void NoStore(HttpResponseMessage response) =>
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

    private static async Task<string> ReadPublic(HttpClient client, Guid id)
    {
        using var response = await client.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        NoStore(response);
        return await response.Content.ReadAsStringAsync();
    }

    private static async Task<string[]> ReadHand(
        HttpClient client, Guid id, string playerId)
    {
        using var response = await client.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        NoStore(response);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        Assert.Equal(playerId, json.RootElement.GetProperty("playerId").GetString());
        return json.RootElement.GetProperty("cardIds").EnumerateArray()
            .Select(x => x.GetString()!).ToArray();
    }

    private static async Task AssertDenied(HttpResponseMessage response, string code = "match_not_found")
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        NoStore(response);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        Assert.Equal(code,
            json.RootElement.GetProperty("code").GetString());
    }

    private static async Task AssertValidAudit(HttpClient client, Guid id, long revision)
    {
        using var response = await client.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        NoStore(response);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        Assert.True(json.RootElement.GetProperty("isValid").GetBoolean());
        Assert.Equal(revision,
            json.RootElement.GetProperty("verifiedRevision").GetInt64());
    }

    private static void AssertPublicAfterCommand(
        string raw, Seat[] seats, string kind, string origin, string destination,
        params string[] secrets)
    {
        foreach (var secret in secrets.Concat(seats.Select(s => s.Token)))
            Assert.DoesNotContain(secret, raw);
        using var json = JsonDocument.Parse(raw);
        var state = json.RootElement;
        Assert.Equal(1, state.GetProperty("revision").GetInt64());
        Assert.Equal(2, state.GetProperty("events").GetArrayLength());
        var last = state.GetProperty("events").EnumerateArray().Last();
        Assert.Equal(seats[0].PlayerId, last.GetProperty("actorId").GetString());
        Assert.Equal(kind == "free-move" ? "free-move" : "turn-ended",
            last.GetProperty("kind").GetString());
        Assert.Equal(kind == "free-move" ? seats[0].PlayerId : seats[1].PlayerId,
            state.GetProperty("activePlayerId").GetString());
        Assert.Equal(kind == "free-move" ? destination : origin,
            state.GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.All(state.GetProperty("players").EnumerateArray(), player =>
        {
            Assert.Equal(4, player.GetProperty("atoms").GetInt32());
            Assert.Equal(2, player.GetProperty("diplomacyTokens").GetInt32());
            Assert.Equal(15, player.GetProperty("henchmenAvailable").GetInt32());
        });
    }

    [Theory]
    [InlineData(2, "free-move")]
    [InlineData(2, "end-turn")]
    [InlineData(3, "free-move")]
    [InlineData(3, "end-turn")]
    [InlineData(4, "free-move")]
    [InlineData(4, "end-turn")]
    [InlineData(5, "free-move")]
    [InlineData(5, "end-turn")]
    [InlineData(6, "free-move")]
    [InlineData(6, "end-turn")]
    [InlineData(7, "free-move")]
    [InlineData(7, "end-turn")]
    [InlineData(8, "free-move")]
    [InlineData(8, "end-turn")]
    public async Task EncryptedCheckpointSurvivesRotationCommandRaceAndTwoRestarts(
        int seatCount, string kind)
    {
        using var directory = new TempDirectory();
        Guid id;
        Seat[] seats;
        string origin;
        string nextToken;
        bool commandWon;
        var originalHands = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var key = Guid.NewGuid().ToString("D");
        string destination;

        // This is the FIRST real HTTP host. It owns its own DI singleton
        // and writes encrypted private hands, commands and bearer digests.
        using (var firstHost = ApiFactory(directory))
        using (var creator = firstHost.CreateClient())
        {
            (id, seats, origin) = await Create(creator, seatCount);
            destination = BoardCatalog.LoadDefault().Streets
                .Single(s => s.Id == origin).Neighbors[0];
            foreach (var seat in seats)
            {
                using var reader = AsSeat(firstHost, seat.Token);
                var hand = await ReadHand(reader, id, seat.PlayerId);
                Assert.Equal(4, hand.Length);
                originalHands.Add(seat.PlayerId, hand);
            }
            Assert.Equal(seatCount * 4, originalHands.Values.SelectMany(x => x)
                .Distinct(StringComparer.Ordinal).Count());

            using var commander = AsSeat(firstHost, seats[0].Token);
            using var rotator = AsSeat(firstHost, seats[0].Token);
            var release = new TaskCompletionSource(
                TaskCreationOptions.RunContinuationsAsynchronously);
            var submission = Task.Run(async () =>
            {
                await release.Task;
                return await Send(commander, id, kind, destination, key);
            });
            var rotation = Task.Run(async () =>
            {
                await release.Task;
                return await rotator.PostAsync(
                    $"/api/dev/matches/{id}/rotate-token", null);
            });
            release.SetResult();

            using var commandResponse = await submission;
            using var rotationResponse = await rotation;
            Assert.Equal(HttpStatusCode.OK, rotationResponse.StatusCode);
            NoStore(rotationResponse);
            NoStore(commandResponse);
            Assert.Contains(commandResponse.StatusCode,
                new[] { HttpStatusCode.OK, HttpStatusCode.NotFound });
            commandWon = commandResponse.StatusCode == HttpStatusCode.OK;
            if (!commandWon) await AssertDenied(commandResponse);

            using var credential = await rotationResponse.Content
                .ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(credential);
            Assert.Equal(seats[0].PlayerId,
                credential.RootElement.GetProperty("playerId").GetString());
            nextToken = credential.RootElement.GetProperty("token").GetString()!;
            Assert.NotEqual(seats[0].Token, nextToken);
            Assert.DoesNotContain(nextToken, seats.Select(s => s.Token));

            using var current = AsSeat(firstHost, nextToken);
            using var denied = await commander.GetAsync($"/api/dev/matches/{id}/hand");
            await AssertDenied(denied, "hand_not_found");
            using var initial = JsonDocument.Parse(await ReadPublic(current, id));
            Assert.Equal(commandWon ? 1 : 0,
                initial.RootElement.GetProperty("revision").GetInt64());
            Assert.Equal(commandWon ? 2 : 1,
                initial.RootElement.GetProperty("events").GetArrayLength());
        }

        // The FIRST cold disk read is performed AFTER destroying the first
        // HTTP host and its in-memory match store.
        var encrypted = directory.Files().Load(id);
        Assert.NotNull(encrypted);
        Assert.Equal(commandWon ? 1 : 0,
            encrypted.CommandReceipts?.Count ?? 0);
        Assert.Equal(seatCount, encrypted.TokenDigests.Count);
        Assert.Equal(Convert.ToHexString(
            SHA256.HashData(Convert.FromHexString(nextToken))),
            encrypted.TokenDigests[seats[0].PlayerId]);
        Assert.NotEqual(Convert.ToHexString(
            SHA256.HashData(Convert.FromHexString(seats[0].Token))),
            encrypted.TokenDigests[seats[0].PlayerId]);

        string committed;
        // SECOND real HTTP host, no shared in-memory state with the first.
        using (var recoveredHost = ApiFactory(directory))
        using (var fresh = AsSeat(recoveredHost, nextToken))
        using (var revoked = AsSeat(recoveredHost, seats[0].Token))
        {
            using (var denied = await revoked.GetAsync($"/api/dev/matches/{id}"))
                await AssertDenied(denied);
            using (var deniedHand = await revoked.GetAsync($"/api/dev/matches/{id}/hand"))
                await AssertDenied(deniedHand, "hand_not_found");
            using (var deniedReplay = await Send(revoked, id, kind, destination, key))
                await AssertDenied(deniedReplay);
            using (var deniedRotation = await revoked.PostAsync(
                $"/api/dev/matches/{id}/rotate-token", null))
                await AssertDenied(deniedRotation);

            var beforeRetry = await ReadPublic(fresh, id);
            using (var state = JsonDocument.Parse(beforeRetry))
            {
                Assert.Equal(commandWon ? 1 : 0,
                    state.RootElement.GetProperty("revision").GetInt64());
                Assert.Equal(commandWon ? 2 : 1,
                    state.RootElement.GetProperty("events").GetArrayLength());
            }
            for (var i = 0; i < seats.Length; i++)
            {
                var seat = seats[i];
                using var holder = AsSeat(recoveredHost, i == 0 ? nextToken : seat.Token);
                Assert.Equal(originalHands[seat.PlayerId],
                    await ReadHand(holder, id, seat.PlayerId));
                Assert.Equal(beforeRetry, await ReadPublic(holder, id));
            }

            // If the command had already committed, the encrypted receipt
            // produces an exact replay. If not, this is its first commit.
            using (var retry = await Send(fresh, id, kind, destination, key))
            {
                Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
                NoStore(retry);
            }
            committed = await ReadPublic(fresh, id);
            AssertPublicAfterCommand(committed, seats, kind, origin, destination,
                nextToken, key);
            await AssertValidAudit(fresh, id, 1);

            using (var duplicate = await Send(fresh, id, kind, destination, key))
            {
                Assert.Equal(HttpStatusCode.OK, duplicate.StatusCode);
                NoStore(duplicate);
            }
            Assert.Equal(committed, await ReadPublic(fresh, id));
            foreach (var seat in seats.Skip(1))
            {
                using var peer = AsSeat(recoveredHost, seat.Token);
                Assert.Equal(committed, await ReadPublic(peer, id));
                Assert.Equal(originalHands[seat.PlayerId],
                    await ReadHand(peer, id, seat.PlayerId));
            }
        }

        var persisted = directory.Files().Load(id);
        Assert.NotNull(persisted);
        var receipt = Assert.Single(persisted.CommandReceipts!);
        Assert.Equal(seats[0].PlayerId, receipt.ActorId);
        Assert.Equal(key, receipt.Key);
        Assert.Equal(kind, receipt.Kind);
        Assert.Equal(0, receipt.ExpectedRevision);
        Assert.Equal(1, receipt.AcceptedRevision);

        // SECOND cold restart: verify recovery of both the revocation and
        // the accepted UUID receipt, then replay without any new events.
        using (var finalHost = ApiFactory(directory))
        using (var fresh = AsSeat(finalHost, nextToken))
        using (var revoked = AsSeat(finalHost, seats[0].Token))
        {
            using (var denied = await revoked.GetAsync($"/api/dev/matches/{id}/hand"))
                await AssertDenied(denied, "hand_not_found");
            Assert.Equal(committed, await ReadPublic(fresh, id));
            Assert.Equal(originalHands[seats[0].PlayerId],
                await ReadHand(fresh, id, seats[0].PlayerId));
            using var replay = await Send(fresh, id, kind, destination, key);
            Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
            NoStore(replay);
            Assert.Equal(committed, await ReadPublic(fresh, id));
            await AssertValidAudit(fresh, id, 1);
            foreach (var seat in seats.Skip(1))
            {
                using var peer = AsSeat(finalHost, seat.Token);
                Assert.Equal(committed, await ReadPublic(peer, id));
                Assert.Equal(originalHands[seat.PlayerId],
                    await ReadHand(peer, id, seat.PlayerId));
            }
        }
    }
}
