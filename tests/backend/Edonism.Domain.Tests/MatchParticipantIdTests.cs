using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class MatchParticipantIdTests
{
    [Theory]
    [InlineData("alice")]
    [InlineData("seat-with_Dots.42")]
    [InlineData("Renée")]
    [InlineData("王小明")]
    [InlineData("Alpha Player")]
    [InlineData("Player🙂")]
    public void AcceptsOrdinaryPrintableTechnicalIdentifiers(string id)
    {
        Assert.True(MatchParticipantId.IsValid(id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(" alice")]
    [InlineData("alice ")]
    [InlineData("Alice\nBob")]
    [InlineData("Alice\tBob")]
    [InlineData("Alice\u007fBob")]
    [InlineData("alice\u200B")]
    [InlineData("alice\u202E")]
    [InlineData("alice\u2066")]
    [InlineData("alice\u2028")]
    [InlineData("alice\u2029")]
    [InlineData("alice\u00a0bob")]
    public void RejectsBlankInvisibleOrControlIdentifiers(string? id)
    {
        Assert.False(MatchParticipantId.IsValid(id));
    }

    [Fact]
    public void LimitIsExplicitlyUtf16AndRejectsTheSixtyFifthCodeUnit()
    {
        Assert.Equal(64, MatchParticipantId.MaxLength);
        Assert.True(MatchParticipantId.IsValid(new string('A', 64)));
        Assert.False(MatchParticipantId.IsValid(new string('A', 65)));
        Assert.True(MatchParticipantId.IsValid(new string('界', 64)));
        Assert.False(MatchParticipantId.IsValid(new string('界', 65)));
        // A supplementary rune occupies TWO UTF-16 code units.
        Assert.True(MatchParticipantId.IsValid(string.Concat(Enumerable.Repeat("🙂", 32))));
        Assert.False(MatchParticipantId.IsValid(string.Concat(Enumerable.Repeat("🙂", 33))));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void ServerAuthoritativeSetupAndReplayStillAcceptTwoToEightSeats(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var ids = Enumerable.Range(0, count).Select(i => $"seat-{i}").ToArray();
        var fixture = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
            ids.Select((id, i) => new MatchParticipantSeed(id, board.Slots[i].Id)).ToArray());
        var snapshot = fixture.Snapshot();
        Assert.Equal(ids, snapshot.TurnOrder);
        Assert.True(fixture.VerifyPublicAudit().IsValid);
        Assert.Equal(count, fixture.VerifyPublicAudit().Frames[0].Players.Count);
    }

    [Theory]
    [InlineData("long")]
    [InlineData("control")]
    [InlineData("bidi")]
    public void EveryAuthoritativeCreationPathRejectsInvalidPlayerIds(string caseName)
    {
        var bad = caseName switch
        {
            "long" => new string('a', 65),
            "control" => "alice\nintruder",
            _ => "alice\u202Eevil"
        };
        var board = BoardCatalog.LoadDefault();
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), board,
            [new MatchParticipantSeed(bad, "N-01"), new MatchParticipantSeed("bob", "S-01")]));
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), board,
            [new MatchParticipantCardSeed(bad, "sport:01"),
             new MatchParticipantCardSeed("bob", "public-financing:01")],
            ActivitySetupFixture.Catalog(), 2026));
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board, [bad, "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 2026));
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board, [bad, "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026));
        Assert.Throws<ArgumentException>(() => CharacterSetupComposer.Draw(
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), [bad, "bob"], 2026));
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId,
            [bad, "bob"], 2026));
    }

    [Fact]
    public void IdentityRemainsOrdinalCaseSensitiveAndDuplicateSeatsAreRejected()
    {
        var board = BoardCatalog.LoadDefault();
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), board,
            [new("alice", "N-01"), new("alice", "S-01")]));
        var source = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), board,
            [new("Alice", "N-01"), new("alice", "S-01")]);
        Assert.True(source.VerifyPublicAudit().IsValid);
        Assert.Equal("Alice", source.Snapshot().Players[0].PlayerId);
        Assert.Equal("alice", source.Snapshot().Players[1].PlayerId);
        Assert.False(source.TryEndTurn("ALICE", 0).Accepted);
        Assert.True(source.TryEndTurn("Alice", 0).Accepted);
        Assert.Equal("alice", source.ActivePlayerId);
    }

    [Fact]
    public void MaxLengthPlayerIdSurvivesPrivateDealAndPublicAuditWithoutConfusion()
    {
        var alice = new string('A', MatchParticipantId.MaxLength);
        var match = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), [alice, "Renée"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        Assert.Equal(alice, match.Snapshot().Players[0].PlayerId);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Equal(alice, match.PrivateHandForActor(alice)!.PlayerId);
        Assert.Equal(4, match.PrivateHandForActor(alice)!.CardIds.Count);
        Assert.Null(match.PrivateHandForActor(new string('A', 63)));
        Assert.True(GameMatch.RestoreFromCheckpoint(
            BoardCatalog.LoadDefault(), match.CaptureCheckpoint()).VerifyPublicAudit().IsValid);
    }

    [Fact]
    public void AlteredAuditAndEncryptedCheckpointContentsCannotRestoreHiddenActorControlChars()
    {
        var original = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            [new("alice", "N-01"), new("bob", "S-01")]).CaptureCheckpoint();
        var forged = "alice\u202Eghost";
        var players = original.State.Players.Select((p, i) =>
            i == 0 ? p with { PlayerId = forged } : p).ToArray();
        var tampered = original with
        {
            State = original.State with
            {
                Players = players,
                TurnOrder = [forged, "bob"],
                ProposedNextRoundOrder = ["bob", forged],
            }
        };
        var verification = MatchAuditReplay.Verify(BoardCatalog.LoadDefault(), tampered.State);
        Assert.False(verification.IsValid);
        Assert.Equal("invalid_audit_setup", verification.Code);
        Assert.Empty(verification.Frames);
        Assert.Throws<InvalidDataException>(() =>
            GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(), tampered));
    }
}
