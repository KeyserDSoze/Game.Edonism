using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
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

public sealed class DevelopmentCheckpointPersistenceTests
{
    private sealed class TempDirectory : IDisposable
    {
        public string PathOnDisk { get; } = Path.Combine(Path.GetTempPath(),
            "edonism-dev-checkpoint-tests-" + Guid.NewGuid().ToString("N"));

        public string KeyHex { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        public DevelopmentMatchCheckpointFiles Files() => new(PathOnDisk, KeyHex);

        public void Dispose()
        {
            if (Directory.Exists(PathOnDisk))
                Directory.Delete(PathOnDisk, recursive: true);
            else if (File.Exists(PathOnDisk))
                File.Delete(PathOnDisk);
        }
    }

    private static DevMatchCreated Create(DevelopmentMatchStore store) =>
        store.CreateWithFullDeck(["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    [Fact]
    public void StorageRoundTripsDifferentActorsPrivateHandsAndCommandsAfterRestart()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var id = created.MatchId;
        var aliceToken = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        var bobToken = created.Credentials.Single(c => c.PlayerId == "bob").Token;
        var starting = created.State.Players.Single(p => p.PlayerId == "alice").StreetId;
        var destination = BoardCatalog.LoadDefault().Streets.Single(s => s.Id == starting).Neighbors[0];

        Assert.True(first.TryFreeMove(id, aliceToken, destination, 0, out var move));
        Assert.True(move!.Accepted);
        Assert.True(first.TryEndTurn(id, aliceToken, 1, out var turn));
        Assert.True(turn!.Accepted);
        Assert.Equal(2, turn.State.Revision);

        // A different store object, as after a process restart, reloads on demand.
        var resumed = new DevelopmentMatchStore(temp.Files());
        Assert.True(resumed.TryRead(id, bobToken, out var state));
        Assert.Equal(2, state!.Revision);
        Assert.Equal("bob", state.ActivePlayerId);
        Assert.Equal(destination, state.Players[0].StreetId);
        Assert.True(resumed.TryReadHand(id, aliceToken, out var aliceHand));
        Assert.True(resumed.TryReadHand(id, bobToken, out var bobHand));
        Assert.Equal(4, aliceHand!.CardIds.Count);
        Assert.Equal(4, bobHand!.CardIds.Count);
        Assert.Empty(aliceHand.CardIds.Intersect(bobHand.CardIds));
        Assert.False(resumed.TryReadHand(id, new string('0', 64), out _));

        Assert.True(resumed.TryEndTurn(id, bobToken, 2, out var ended));
        Assert.True(ended!.Accepted);
        Assert.Equal(3, ended.State.Revision);
        var third = new DevelopmentMatchStore(temp.Files());
        Assert.True(third.TryReadAudit(id, aliceToken, out var audit));
        Assert.True(audit!.IsValid);
        Assert.Equal(3, audit.VerifiedRevision);
        Assert.True(third.TryRead(id, bobToken, out var final));
        Assert.Equal(1, (int)final!.Phase);
        Assert.Null(final.ActivePlayerId);
    }

    [Fact]
    public void CiphertextDoesNotContainTokensOrCardsAndWrongKeyOrTamperingFailsClosed()
    {
        using var temp = new TempDirectory();
        var store = new DevelopmentMatchStore(temp.Files());
        var created = Create(store);
        var aliceToken = created.Credentials[0].Token;
        Assert.True(store.TryReadHand(created.MatchId, aliceToken, out var hand));

        var path = System.IO.Path.Combine(temp.PathOnDisk,
            created.MatchId.ToString("N") + ".edonism");
        var bytes = File.ReadAllBytes(path);
        var raw = Encoding.UTF8.GetString(bytes);
        Assert.DoesNotContain(aliceToken, raw);
        foreach (var card in hand!.CardIds)
            Assert.DoesNotContain(card, raw);
        Assert.DoesNotContain("RemainingDrawPile", raw);

        var foreignKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var wrongStore = new DevelopmentMatchStore(
            new DevelopmentMatchCheckpointFiles(temp.PathOnDisk, foreignKey));
        Assert.False(wrongStore.TryRead(created.MatchId, aliceToken, out _));

        bytes[^1] ^= 0xFF;
        File.WriteAllBytes(path, bytes);
        var newStore = new DevelopmentMatchStore(temp.Files());
        Assert.False(newStore.TryRead(created.MatchId, aliceToken, out _));
        Assert.Throws<InvalidDataException>(() => temp.Files().Load(created.MatchId));
    }

    [Fact]
    public void UnconfiguredStoreIsVolatileAndInvalidKeyOrPathAreRejected()
    {
        var volatileStore = new DevelopmentMatchStore();
        var created = Create(volatileStore);
        Assert.False(new DevelopmentMatchStore().TryRead(created.MatchId,
            created.Credentials[0].Token, out _));
        using var dir = new TempDirectory();
        Assert.Throws<ArgumentException>(() =>
            new DevelopmentMatchCheckpointFiles("relative/path", dir.KeyHex));
        Assert.Throws<ArgumentException>(() =>
            new DevelopmentMatchCheckpointFiles(dir.PathOnDisk, "0000"));
        Assert.Throws<ArgumentException>(() =>
            new DevelopmentMatchCheckpointFiles(dir.PathOnDisk, new string('G', 64)));
    }

    [Fact]
    public void FailedWriteCannotPublishAnAcceptedCommandInMemory()
    {
        using var dir = new TempDirectory();
        var store = new DevelopmentMatchStore(dir.Files());
        var created = Create(store);
        var token = created.Credentials[0].Token;
        var from = created.State.Players[0].StreetId;
        var destination = BoardCatalog.LoadDefault().Streets.Single(s => s.Id == from).Neighbors[0];

        // Replace the storage directory with a regular file to force save failure.
        Directory.Delete(dir.PathOnDisk, recursive: true);
        File.WriteAllText(dir.PathOnDisk, "not a directory");
        Assert.ThrowsAny<IOException>(() =>
            store.TryFreeMove(created.MatchId, token, destination, 0, out _));

        Assert.True(store.TryRead(created.MatchId, token, out var after));
        Assert.Equal(0, after!.Revision);
        Assert.Equal(from, after.Players[0].StreetId);
        Assert.Single(after.Events);
    }

    private static WebApplicationFactory<Program> ApiFactory(TempDirectory dir) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DevelopmentMatchStore>();
                services.AddSingleton(new DevelopmentMatchStore(dir.Files()));
            });
        });

    [Fact]
    public async Task ApiInstancesWithDifferentStoresKeepPrivateHandsAndMatchRevision()
    {
        using var temp = new TempDirectory();
        Guid id;
        string aliceToken;
        string bobToken;
        string destination;

        using (var original = ApiFactory(temp))
        using (var creator = original.CreateClient())
        {
            using var response = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck",
                new {
                    playerIds = new[] { "alice", "bob" },
                    characters = CharacterSetupFixture.Catalog(),
                    availableActivities = ActivitySetupFixture.Catalog(),
                    actionCardIds = ActionDeckFixture.ActionIds(),
                    electionDayCardId = ActionDeckFixture.ElectionDayId,
                    seed = 2026
                });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
            id = created!.RootElement.GetProperty("matchId").GetGuid();
            var credentials = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
            aliceToken = credentials[0].GetProperty("token").GetString()!;
            bobToken = credentials[1].GetProperty("token").GetString()!;
            var street = created.RootElement.GetProperty("state").GetProperty("players")[0]
                .GetProperty("streetId").GetString();
            destination = BoardCatalog.LoadDefault().Streets.Single(s => s.Id == street).Neighbors[0];
            using var move = original.CreateClient();
            move.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
            using var accepted = await move.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
                new { destinationStreetId = destination, expectedRevision = 0 });
            Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        }

        // Completely new WebApplicationFactory, DI singleton and application host.
        using var restarted = ApiFactory(temp);
        using var alice = restarted.CreateClient();
        using var bob = restarted.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);
        using var publicRead = await bob.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, publicRead.StatusCode);
        using var snapshot = await publicRead.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(1, snapshot!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(destination, snapshot.RootElement.GetProperty("players")[0]
            .GetProperty("streetId").GetString());
        using var handA = await alice.GetAsync($"/api/dev/matches/{id}/hand");
        using var handB = await bob.GetAsync($"/api/dev/matches/{id}/hand?playerId=alice");
        using var handAn = await handA.Content.ReadFromJsonAsync<JsonDocument>();
        using var handBn = await handB.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", handAn!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", handBn!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal(4, handAn.RootElement.GetProperty("cardIds").GetArrayLength());
        Assert.Equal(4, handBn.RootElement.GetProperty("cardIds").GetArrayLength());
        using var invalid = restarted.CreateClient();
        invalid.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", new string('0', 64));
        using var forbidden = await invalid.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
    }
}
