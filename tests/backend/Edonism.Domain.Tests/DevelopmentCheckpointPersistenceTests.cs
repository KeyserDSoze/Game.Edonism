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

    private static void RewriteCheckpointWithDigests(
        TempDirectory temp, PersistedDevelopmentMatch saved,
        IReadOnlyDictionary<string, string> digests)
    {
        // Construct a fully AES-GCM authenticated checkpoint whose mapping
        // is *semantically* forged. An unmodified ciphertext would be stopped
        // by the AES tag and would not exercise the seat-identity trust boundary.
        var payload = JsonSerializer.SerializeToUtf8Bytes(saved with
        {
            TokenDigests = digests
        });
        try
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var cipher = new byte[payload.Length];
            var tag = new byte[16];
            using (var aes = new AesGcm(Convert.FromHexString(temp.KeyHex), 16))
                aes.Encrypt(nonce, payload, cipher, tag, saved.MatchId.ToByteArray());

            var fileBytes = new byte[8 + 12 + 16 + cipher.Length];
            "EDONDM01"u8.CopyTo(fileBytes);
            nonce.CopyTo(fileBytes, 8);
            tag.CopyTo(fileBytes, 20);
            cipher.CopyTo(fileBytes, 36);
            File.WriteAllBytes(Path.Combine(temp.PathOnDisk,
                saved.MatchId.ToString("N") + ".edonism"), fileBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(payload);
        }
    }

    [Theory]
    [InlineData("same-digest")]
    [InlineData("hex-alias")]
    [InlineData("null")]
    [InlineData("too-short")]
    [InlineData("non-hex")]
    public void AuthenticatedFileWithInvalidSeatDigestMappingNeverRestores(
        string tamper)
    {
        using var temp = new TempDirectory();
        var existing = new DevelopmentMatchStore(temp.Files());
        var created = Create(existing);
        var persisted = temp.Files().Load(created.MatchId);
        Assert.NotNull(persisted);

        var changed = persisted.TokenDigests.ToDictionary(
            kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);
        var aliceHash = changed["alice"];
        changed["bob"] = tamper switch
        {
            "same-digest" => aliceHash,
            "hex-alias" => aliceHash.ToLowerInvariant(),
            "null" => null!,
            "too-short" => aliceHash[..63],
            "non-hex" => new string('X', 64),
            _ => throw new ArgumentOutOfRangeException(nameof(tamper))
        };
        RewriteCheckpointWithDigests(temp, persisted, changed);

        var restarted = new DevelopmentMatchStore(temp.Files());
        foreach (var bearer in created.Credentials.Select(c => c.Token))
        {
            Assert.False(restarted.TryRead(created.MatchId, bearer, out _));
            Assert.False(restarted.TryReadHand(created.MatchId, bearer, out _));
            Assert.False(restarted.TryReadHistory(created.MatchId, bearer, out _));
            Assert.False(restarted.TryBootstrapSeat(created.MatchId, bearer, out _));
            Assert.False(restarted.HasSeatAccess(created.MatchId, bearer));
        }

        // The already-authenticated, unrelated in-memory entry remains sound.
        foreach (var c in created.Credentials)
        {
            Assert.True(existing.TryRead(created.MatchId, c.Token, out var state));
            Assert.Equal(0, state!.Revision);
            Assert.True(existing.TryReadHand(created.MatchId, c.Token, out var hand));
            Assert.Equal(c.PlayerId, hand!.PlayerId);
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
    public void DistinctInitialSeatCapabilitiesStayIsolatedAfterRotationAndEncryptedRestart(
        int seatCount)
    {
        using var temp = new TempDirectory();
        var store = new DevelopmentMatchStore(temp.Files());
        var slots = BoardCatalog.LoadDefault().Slots.ToArray();
        var created = store.Create(Enumerable.Range(0, seatCount)
            .Select(i => new Edonism.Domain.Matches.MatchParticipantSeed(
                $"player-{i}", slots[i].Id)).ToArray());
        Assert.Equal(seatCount, created.Credentials.Count);
        Assert.Equal(seatCount, created.Credentials
            .Select(c => c.Token).Distinct(StringComparer.Ordinal).Count());
        Assert.All(created.Credentials, c =>
        {
            Assert.Equal(64, c.Token.Length);
            Assert.True(store.TryRead(created.MatchId, c.Token, out var state));
            Assert.Equal(seatCount, state!.Players.Count);
        });

        var first = created.Credentials[0];
        Assert.True(store.TryRotateSeatToken(created.MatchId, first.Token,
            out var replacement));
        Assert.Equal(first.PlayerId, replacement!.PlayerId);
        Assert.NotEqual(first.Token, replacement.Token);
        Assert.False(store.TryRead(created.MatchId, first.Token, out _));

        var restored = new DevelopmentMatchStore(temp.Files());
        Assert.False(restored.TryRead(created.MatchId, first.Token, out _));
        Assert.True(restored.TryRead(created.MatchId, replacement.Token, out _));
        for (var i = 1; i < created.Credentials.Count; i++)
        {
            var credential = created.Credentials[i];
            Assert.True(restored.TryRead(created.MatchId, credential.Token, out var state));
            Assert.Equal("player-0", state!.TurnOrder[0]);
            Assert.Equal(credential.PlayerId, state.Players[i].PlayerId);
            Assert.True(restored.HasSeatAccess(created.MatchId, credential.Token));
        }
    }

    [Fact]
    public void EphemeralSeatPresenceNeverWritesEncryptedCheckpointAndRestartsInactive()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var id = created.MatchId;
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;
        var location = Path.Combine(temp.PathOnDisk, id.ToString("N") + ".edonism");
        var originalBytes = File.ReadAllBytes(location);
        Assert.True(first.TryHeartbeat(id, alice, out var active));
        Assert.True(active!.Seats[0].IsActive);
        Assert.False(active.Seats[1].IsActive);
        Assert.True(first.TryHeartbeat(id, bob, out var both));
        Assert.All(both!.Seats, s => Assert.True(s.IsActive));
        Assert.Equal(originalBytes, File.ReadAllBytes(location));

        // A completely new DevelopmentMatchStore restores private state and
        // credentials from AES-GCM, but nobody is 'recently active' yet.
        var restored = new DevelopmentMatchStore(temp.Files());
        Assert.True(restored.TryReadPresence(id, alice, out var inactive));
        Assert.All(inactive!.Seats, s => Assert.False(s.IsActive));
        Assert.True(restored.TryReadHand(id, alice, out var aliceHand));
        Assert.True(restored.TryReadHand(id, bob, out var bobHand));
        Assert.Equal(4, aliceHand!.CardIds.Count);
        Assert.Equal(4, bobHand!.CardIds.Count);
        Assert.True(restored.TryRead(id, bob, out var state));
        Assert.Equal(0, state!.Revision);
        Assert.Single(state.Events);
        Assert.Equal(originalBytes, File.ReadAllBytes(location));
    }

    [Fact]
    public void AcceptedIdempotencyReceiptPersistsAtomicallyAndReplaysAfterRestart()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;
        var id = created.MatchId;
        var aliceKey = Guid.NewGuid().ToString("D");

        Assert.True(first.TryEndTurn(id, alice, 0, out var accepted, aliceKey));
        Assert.True(accepted!.Accepted);
        Assert.Equal(1, accepted.State.Revision);

        var encrypted = File.ReadAllText(Path.Combine(temp.PathOnDisk, id.ToString("N") + ".edonism"));
        Assert.DoesNotContain(alice, encrypted);
        Assert.DoesNotContain(bob, encrypted);
        Assert.DoesNotContain(aliceKey, encrypted);
        var persisted = temp.Files().Load(id);
        Assert.NotNull(persisted);
        Assert.Equal(2, persisted.FormatVersion);
        Assert.Single(persisted.CommandReceipts!);
        Assert.Equal("alice", persisted.CommandReceipts![0].ActorId);
        Assert.Equal(aliceKey, persisted.CommandReceipts![0].Key);
        Assert.Equal(1, persisted.CommandReceipts![0].AcceptedRevision);

        var restarted = new DevelopmentMatchStore(temp.Files());
        Assert.True(restarted.TryEndTurn(id, alice, 0, out var replay, aliceKey));
        Assert.True(replay!.Accepted);
        Assert.Equal(1, replay.State.Revision);
        Assert.Equal(2, replay.State.Events.Count);
        Assert.True(restarted.TryEndTurn(id, alice, 1, out var mismatched, aliceKey));
        Assert.False(mismatched!.Accepted);
        Assert.Equal("idempotency_key_reused", mismatched.Code);

        // Identical UUID belongs to a DIFFERENT actor and is not a replay.
        Assert.True(restarted.TryEndTurn(id, bob, 1, out var next, aliceKey));
        Assert.True(next!.Accepted);
        Assert.Equal(2, next.State.Revision);
        var onceMore = new DevelopmentMatchStore(temp.Files());
        Assert.True(onceMore.TryEndTurn(id, bob, 1, out var bobReplay, aliceKey));
        Assert.True(bobReplay!.Accepted);
        Assert.Equal(2, bobReplay.State.Revision);
        Assert.Equal(3, bobReplay.State.Events.Count);

        // A replay after somebody else advanced the game returns the CURRENT
        // authoritative state, not a stale snapshot from the original ACK.
        Assert.True(onceMore.TryEndTurn(id, alice, 0, out var lateReplay, aliceKey));
        Assert.True(lateReplay!.Accepted);
        Assert.Equal(2, lateReplay.State.Revision);
        Assert.Equal(3, lateReplay.State.Events.Count);
    }

    [Fact]
    public async Task IdempotentReplayDoesNotWakeSubscribersOrAdvanceAnyRevision()
    {
        var store = new DevelopmentMatchStore();
        var created = Create(store);
        var alice = created.Credentials[0].Token;
        var bob = created.Credentials[1].Token;
        var id = created.MatchId;
        var key = Guid.NewGuid().ToString("D");
        Assert.True(store.TryEndTurn(id, alice, 0, out var first, key));
        Assert.True(first!.Accepted);

        var pending = store.WaitForRevisionAsync(
            id, bob, 1, TimeSpan.FromMilliseconds(250));
        Assert.True(store.TryEndTurn(id, alice, 0, out var replay, key));
        Assert.True(replay!.Accepted);
        Assert.False(pending.IsCompleted);
        var idle = await pending.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(idle.Found);
        Assert.Equal(1, idle.State!.Revision);
        Assert.Equal(2, idle.State.Events.Count);
    }

    [Fact]
    public void FailedEncryptedCommandCannotPublishReceiptOrWakeAStaleRevision()
    {
        using var temp = new TempDirectory();
        var store = new DevelopmentMatchStore(temp.Files());
        var created = Create(store);
        var alice = created.Credentials[0].Token;
        var id = created.MatchId;
        var key = Guid.NewGuid().ToString("D");
        Directory.Delete(temp.PathOnDisk, recursive: true);
        File.WriteAllText(temp.PathOnDisk, "force atomic checkpoint write failure");

        Assert.ThrowsAny<IOException>(() =>
            store.TryEndTurn(id, alice, 0, out _, key));
        Assert.True(store.TryRead(id, alice, out var notApplied));
        Assert.Equal(0, notApplied!.Revision);
        Assert.Single(notApplied.Events);

        File.Delete(temp.PathOnDisk);
        Directory.CreateDirectory(temp.PathOnDisk);
        Assert.True(store.TryEndTurn(id, alice, 0, out var accepted, key));
        Assert.True(accepted!.Accepted);
        Assert.Equal(1, accepted.State.Revision);
        var newStore = new DevelopmentMatchStore(temp.Files());
        Assert.True(newStore.TryEndTurn(id, alice, 0, out var replay, key));
        Assert.True(replay!.Accepted);
        Assert.Equal(1, replay.State.Revision);
        Assert.Equal(2, replay.State.Events.Count);
    }

    [Fact]
    public void ValidLegacyEncryptedV1CheckpointCanBeReadAndMigratesToV2OnCommand()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var id = created.MatchId;
        var alice = created.Credentials[0].Token;
        var previous = temp.Files().Load(id);
        Assert.NotNull(previous);

        // Build an authentic v1 encrypted payload with no CommandReceipts
        // property, as issued before #35. The envelope and AES AAD are
        // unchanged: the version refers to the trusted plaintext metadata.
        var legacyPayload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            FormatVersion = 1,
            MatchId = id,
            Checkpoint = previous.Checkpoint,
            TokenDigests = previous.TokenDigests
        });
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[legacyPayload.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(Convert.FromHexString(temp.KeyHex), 16))
            aes.Encrypt(nonce, legacyPayload, cipher, tag, id.ToByteArray());
        var bytes = new byte[8 + 12 + 16 + cipher.Length];
        "EDONDM01"u8.CopyTo(bytes);
        nonce.CopyTo(bytes, 8);
        tag.CopyTo(bytes, 20);
        cipher.CopyTo(bytes, 36);
        File.WriteAllBytes(Path.Combine(temp.PathOnDisk, id.ToString("N") + ".edonism"), bytes);
        CryptographicOperations.ZeroMemory(legacyPayload);

        var legacyStore = new DevelopmentMatchStore(temp.Files());
        Assert.True(legacyStore.TryRead(id, alice, out var unchanged));
        Assert.Equal(0, unchanged!.Revision);
        var key = Guid.NewGuid().ToString("D");
        Assert.True(legacyStore.TryEndTurn(id, alice, 0, out var accepted, key));
        Assert.True(accepted!.Accepted);

        var migrated = temp.Files().Load(id);
        Assert.NotNull(migrated);
        Assert.Equal(2, migrated.FormatVersion);
        Assert.Single(migrated.CommandReceipts!);
        var subsequent = new DevelopmentMatchStore(temp.Files());
        Assert.True(subsequent.TryEndTurn(id, alice, 0, out var replay, key));
        Assert.True(replay!.Accepted);
        Assert.Equal(1, replay.State.Revision);
    }

    [Theory]
    [InlineData("printed-quota")]
    [InlineData("unknown-category")]
    [InlineData("duplicate-character")]
    [InlineData("invalid-hearts")]
    public void AuthenticatedButInvalidPublicSetupCannotRestoreOrExposePrivateHands(
        string tamper)
    {
        using var temp = new TempDirectory();
        var original = new DevelopmentMatchStore(temp.Files());
        var created = Create(original);
        var persisted = temp.Files().Load(created.MatchId);
        Assert.NotNull(persisted);

        var state = persisted.Checkpoint.State;
        var activities = state.BoardActivities.ToArray();
        var characters = state.AssignedCharacters.ToArray();
        var players = state.Players.ToArray();
        switch (tamper)
        {
            case "printed-quota":
                activities[0] = activities[0] with
                {
                    Category = activities.First(c => c.Category != activities[0].Category).Category
                };
                break;
            case "unknown-category":
                activities[0] = activities[0] with { Category = "fake-printed-category" };
                break;
            case "duplicate-character":
                characters[1] = characters[1] with { CharacterId = characters[0].CharacterId };
                break;
            case "invalid-hearts":
                characters[0] = characters[0] with { PrintedInitialHearts = 6 };
                players[0] = players[0] with { Hearts = 6 };
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(tamper));
        }
        var altered = state with
        {
            BoardActivities = activities, AssignedCharacters = characters, Players = players
        };
        var digest = persisted.TokenDigests.ToDictionary(
            kv => kv.Key, kv => Convert.FromHexString(kv.Value), StringComparer.Ordinal);

        // Correct AES-GCM authentication does not establish that PUBLIC
        // board/category/character state was produced by trusted composers.
        temp.Files().Save(persisted.Checkpoint with { State = altered },
            digest, persisted.CommandReceipts);

        var restarted = new DevelopmentMatchStore(temp.Files());
        var alice = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        Assert.False(restarted.TryRead(created.MatchId, alice, out _));
        Assert.False(restarted.TryReadHand(created.MatchId, alice, out _));
        Assert.False(restarted.TryReadHistory(created.MatchId, alice, out _));

        // A different, valid in-memory match is unaffected by the disk forgery.
        Assert.True(original.TryReadHand(created.MatchId, alice, out var hand));
        Assert.Equal(4, hand!.CardIds.Count);
    }

    [Theory]
    [InlineData("swap-private-hand")]
    [InlineData("reorder-draw-pile")]
    public void AuthenticatedButNonCanonicalPrivateDealIsRejectedOnEncryptedRestart(
        string tamper)
    {
        using var temp = new TempDirectory();
        var original = new DevelopmentMatchStore(temp.Files());
        var created = Create(original);
        var persisted = temp.Files().Load(created.MatchId);
        Assert.NotNull(persisted);
        var deal = persisted.Checkpoint.PrivateDeal!;
        var hands = deal.Hands.Select(h =>
            h with { CardIds = h.CardIds.ToArray() }).ToArray();
        var pile = deal.RemainingDrawPile.ToArray();

        if (tamper == "swap-private-hand")
        {
            var left = hands[0].CardIds.ToArray();
            var right = hands[1].CardIds.ToArray();
            (left[0], right[0]) = (right[0], left[0]);
            hands[0] = hands[0] with { CardIds = left };
            hands[1] = hands[1] with { CardIds = right };
        }
        else
            (pile[0], pile[1]) = (pile[1], pile[0]);

        var tampered = deal with { Hands = hands, RemainingDrawPile = pile };
        var digests = persisted.TokenDigests.ToDictionary(
            kv => kv.Key, kv => Convert.FromHexString(kv.Value), StringComparer.Ordinal);
        // Authenticated AES-GCM envelope is not proof of logical deck order:
        // simulate an internally inconsistent but correctly re-encrypted file.
        temp.Files().Save(persisted.Checkpoint with { PrivateDeal = tampered },
            digests, persisted.CommandReceipts);

        var restarted = new DevelopmentMatchStore(temp.Files());
        var alice = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        Assert.False(restarted.TryRead(created.MatchId, alice, out _));
        Assert.False(restarted.TryReadHand(created.MatchId, alice, out _));
        Assert.False(restarted.TryReadHistory(created.MatchId, alice, out _));

        // Existing store memory is untouched; only the corrupted restarted
        // instance fails closed, with no private cards from the forged file.
        Assert.True(original.TryReadHand(created.MatchId, alice, out var privateHand));
        Assert.Equal(4, privateHand!.CardIds.Count);
    }

    [Fact]
    public void EncryptedCheckpointWithForgedReceiptDoesNotRestore()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var data = temp.Files().Load(created.MatchId);
        Assert.NotNull(data);
        var digests = data.TokenDigests.ToDictionary(kv => kv.Key,
            kv => Convert.FromHexString(kv.Value), StringComparer.Ordinal);
        // AES authentication alone is not proof that a receipt corresponds
        // to an actual canonical event, actor and accepted revision.
        temp.Files().Save(data.Checkpoint, digests,
        [
            new DevCommandReceipt("bob", Guid.NewGuid().ToString("D"),
                "end-turn", null, 0, 1)
        ]);
        var forged = new DevelopmentMatchStore(temp.Files());
        Assert.False(forged.TryRead(created.MatchId, created.Credentials[0].Token, out _));
    }

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
    public async Task RestoredEncryptedMatchSignalsLongPollAndCleansUpCanceledWaiter()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var id = created.MatchId;
        var alice = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        var bob = created.Credentials.Single(c => c.PlayerId == "bob").Token;
        Assert.True(first.TryEndTurn(id, alice, 0, out var firstTurn));
        Assert.True(firstTurn!.Accepted);

        // A brand-new store reconstructs the match and subscription state
        // from a sealed Development checkpoint, not an event stream.
        var restored = new DevelopmentMatchStore(temp.Files());
        using var cancellation = new CancellationTokenSource();
        var canceled = restored.WaitForRevisionAsync(
            id, alice, 1, TimeSpan.FromSeconds(5), cancellation.Token);
        await Task.Delay(50);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            _ = await canceled;
        });

        var pending = restored.WaitForRevisionAsync(id, bob, 1, TimeSpan.FromSeconds(5));
        await Task.Delay(60);
        Assert.True(restored.TryEndTurn(id, bob, 1, out var ended));
        Assert.True(ended!.Accepted);
        var completion = await pending.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.True(completion.Found);
        Assert.NotNull(completion.State);
        Assert.Equal(2, completion.State.Revision);
        Assert.Equal(1, (int)completion.State.Phase);

        // Old subscribers cannot reveal a later checkpoint via a revoked
        // bearer even when they know the exact public revision.
        Assert.True(restored.TryRotateSeatToken(id, bob, out var replacement));
        var denied = await restored.WaitForRevisionAsync(
            id, bob, 2, TimeSpan.FromSeconds(1));
        Assert.False(denied.Found);
        var current = await restored.WaitForRevisionAsync(
            id, replacement!.Token, 1, TimeSpan.FromSeconds(1));
        Assert.True(current.Found);
        Assert.Equal(2, current.State!.Revision);
    }

    [Fact]
    public void AtomicBootstrapSurvivesEncryptedRestartAndTokenRotation()
    {
        using var temp = new TempDirectory();
        var live = new DevelopmentMatchStore(temp.Files());
        var created = Create(live);
        var id = created.MatchId;
        var oldBobToken = created.Credentials.Single(c => c.PlayerId == "bob").Token;
        var aliceToken = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        Assert.True(live.TryEndTurn(id, aliceToken, 0, out var ended));
        Assert.True(ended!.Accepted);
        Assert.True(live.TryRotateSeatToken(id, oldBobToken, out var rotated));

        var restarted = new DevelopmentMatchStore(temp.Files());
        Assert.False(restarted.TryBootstrapSeat(id, oldBobToken, out _));
        Assert.True(restarted.TryBootstrapSeat(id, rotated!.Token, out var bootstrap));
        Assert.NotNull(bootstrap);
        Assert.Equal(id, bootstrap.MatchId);
        Assert.Equal("bob", bootstrap.PlayerId);
        Assert.Equal("bob", bootstrap.Hand.PlayerId);
        Assert.Equal("bob", bootstrap.TurnOptions.PlayerId);
        Assert.Equal(1, bootstrap.State.Revision);
        Assert.Equal(bootstrap.State.Revision, bootstrap.TurnOptions.Revision);
        Assert.True(bootstrap.TurnOptions.CanEndTurn);
        Assert.Equal(4, bootstrap.Hand.CardIds.Count);
        Assert.DoesNotContain(oldBobToken, System.Text.Json.JsonSerializer.Serialize(bootstrap));
        Assert.DoesNotContain(rotated.Token, System.Text.Json.JsonSerializer.Serialize(bootstrap));

        Assert.True(restarted.TryBootstrapSeat(id, aliceToken, out var alice));
        Assert.NotNull(alice);
        Assert.False(alice.TurnOptions.CanEndTurn);
        Assert.Empty(alice.Hand.CardIds.Intersect(bootstrap.Hand.CardIds));
        Assert.True(restarted.TryRead(id, aliceToken, out var unchanged));
        Assert.Equal(1, unchanged!.Revision);
        Assert.Equal(2, unchanged.Events.Count);
    }

    [Fact]
    public void AtomicBootstrapDoesNotMixRevisionsUnderConcurrentEndTurn()
    {
        var store = new DevelopmentMatchStore();
        var created = Create(store);
        var aliceToken = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        var bobToken = created.Credentials.Single(c => c.PlayerId == "bob").Token;
        Parallel.For(0, 80, index =>
        {
            if (index == 13)
            {
                Assert.True(store.TryEndTurn(created.MatchId, aliceToken, 0, out var outcome));
                Assert.True(outcome!.Accepted);
                return;
            }

            var token = index % 2 == 0 ? aliceToken : bobToken;
            Assert.True(store.TryBootstrapSeat(created.MatchId, token, out var bundle));
            Assert.NotNull(bundle);
            Assert.Equal(bundle.State.Revision, bundle.TurnOptions.Revision);
            Assert.Equal(bundle.State.MatchId, bundle.Hand.MatchId);
            Assert.Equal(bundle.PlayerId, bundle.Hand.PlayerId);
            Assert.Equal(bundle.PlayerId, bundle.TurnOptions.PlayerId);
            Assert.Equal(bundle.State.ActivePlayerId == bundle.PlayerId,
                bundle.TurnOptions.CanEndTurn);
            Assert.Equal(4, bundle.Hand.CardIds.Count);
        });
        Assert.True(store.TryRead(created.MatchId, bobToken, out var after));
        Assert.Equal(1, after!.Revision);
        Assert.True(after.ActivePlayerId == "bob");
    }

    [Fact]
    public void RestoredMatchTurnOptionsStayActorScopedAndRevisionBound()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var aliceToken = created.Credentials[0].Token;
        var bobToken = created.Credentials[1].Token;

        Assert.True(first.TryReadTurnOptions(created.MatchId, aliceToken, out var initial));
        Assert.True(initial!.CanEndTurn);
        Assert.NotEmpty(initial.FreeMoveStreetIds);
        Assert.False(first.TryReadTurnOptions(created.MatchId, new string('0', 64), out _));
        Assert.True(first.TryEndTurn(created.MatchId, aliceToken, 0, out var ended));
        Assert.True(ended!.Accepted);

        var resumed = new DevelopmentMatchStore(temp.Files());
        Assert.True(resumed.TryReadTurnOptions(created.MatchId, aliceToken, out var alice));
        Assert.Equal(1, alice!.Revision);
        Assert.False(alice.CanEndTurn);
        Assert.Empty(alice.FreeMoveStreetIds);
        Assert.True(resumed.TryReadTurnOptions(created.MatchId, bobToken, out var bob));
        Assert.Equal(1, bob!.Revision);
        Assert.True(bob.CanEndTurn);
        Assert.NotEmpty(bob.FreeMoveStreetIds);
        Assert.True(resumed.TryRead(created.MatchId, aliceToken, out var unchanged));
        Assert.Equal(1, unchanged!.Revision);
        Assert.Equal(2, unchanged.Events.Count);
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


    [Fact]
    public void RotatedSeatCapabilitySurvivesEncryptedRestartAndLeavesOtherSeatsIntact()
    {
        using var temp = new TempDirectory();
        var first = new DevelopmentMatchStore(temp.Files());
        var created = Create(first);
        var previous = created.Credentials.Single(c => c.PlayerId == "alice").Token;
        var other = created.Credentials.Single(c => c.PlayerId == "bob").Token;

        Assert.True(first.TryRotateSeatToken(created.MatchId, previous, out var rotated));
        Assert.Equal("alice", rotated!.PlayerId);
        Assert.Matches("^[A-F0-9]{64}$", rotated.Token);
        Assert.NotEqual(previous, rotated.Token);
        Assert.False(first.TryRead(created.MatchId, previous, out _));
        Assert.True(first.TryRead(created.MatchId, rotated.Token, out var unchanged));
        Assert.Equal(0, unchanged!.Revision);
        Assert.Single(unchanged.Events);

        var saved = File.ReadAllText(Path.Combine(temp.PathOnDisk,
            created.MatchId.ToString("N") + ".edonism"));
        Assert.DoesNotContain(previous, saved);
        Assert.DoesNotContain(rotated.Token, saved);

        var restarted = new DevelopmentMatchStore(temp.Files());
        Assert.False(restarted.TryReadHand(created.MatchId, previous, out _));
        Assert.False(restarted.TryRotateSeatToken(created.MatchId, previous, out _));
        Assert.True(restarted.TryReadHand(created.MatchId, rotated.Token, out var hand));
        Assert.Equal("alice", hand!.PlayerId);
        Assert.Equal(4, hand.CardIds.Count);
        Assert.True(restarted.TryReadHand(created.MatchId, other, out var bobHand));
        Assert.Equal("bob", bobHand!.PlayerId);
    }

    [Fact]
    public void FailedTokenRotationDoesNotPublishRevocationOrChangeMatch()
    {
        using var temp = new TempDirectory();
        var store = new DevelopmentMatchStore(temp.Files());
        var created = Create(store);
        var original = created.Credentials[0].Token;
        var other = created.Credentials[1].Token;

        // Presence must not be cleared if the disk-backed rotation fails.
        Assert.True(store.TryHeartbeat(created.MatchId, original, out var before));
        Assert.True(before!.Seats[0].IsActive);
        // Force failure before the encrypted atomic rename.
        Directory.Delete(temp.PathOnDisk, recursive: true);
        File.WriteAllText(temp.PathOnDisk, "not a directory");
        Assert.ThrowsAny<IOException>(() =>
            store.TryRotateSeatToken(created.MatchId, original, out _));

        Assert.True(store.TryRead(created.MatchId, original, out var unchanged));
        Assert.Equal(0, unchanged!.Revision);
        Assert.Single(unchanged.Events);
        Assert.True(store.TryReadHand(created.MatchId, other, out _));
        Assert.True(store.TryReadPresence(created.MatchId, original, out var stillActive));
        Assert.True(stillActive!.Seats[0].IsActive);
        Assert.False(stillActive.Seats[1].IsActive);
    }

    [Fact]
    public void ConcurrentRotationsOfSameCapabilityHaveExactlyOneWinner()
    {
        var store = new DevelopmentMatchStore();
        var created = Create(store);
        var original = created.Credentials[0].Token;
        var replacements = new System.Collections.Concurrent.ConcurrentBag<DevSeatCredential>();
        Parallel.For(0, 32, _ =>
        {
            if (store.TryRotateSeatToken(created.MatchId, original, out var replaced))
                replacements.Add(replaced!);
        });

        var single = Assert.Single(replacements);
        Assert.False(store.TryRead(created.MatchId, original, out _));
        Assert.True(store.TryRead(created.MatchId, single.Token, out var state));
        Assert.Equal(0, state!.Revision);
        Assert.True(store.TryRead(created.MatchId, created.Credentials[1].Token, out _));
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
