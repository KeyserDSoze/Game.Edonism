using Edonism.Domain.Matches;
using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class MatchCheckpointPublicSetupIntegrityTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();

    private static GameMatch FullDeck() => GameMatch.CreateFromTrustedFullDeckSetup(
        Guid.NewGuid(), Board, ["alice", "bob"],
        CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
        ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    private static GameMatchCheckpoint FullCheckpoint() => FullDeck().CaptureCheckpoint();

    private static GameMatch Restore(GameMatchCheckpoint checkpoint) =>
        GameMatch.RestoreFromCheckpoint(Board, checkpoint);

    [Theory]
    [InlineData("unknown-category")]
    [InlineData("changed-category-quota")]
    [InlineData("duplicate-slot")]
    [InlineData("unknown-slot")]
    public void RejectsForgedPublicBoardEvenWhenThirtyCardsStillExist(string tamper)
    {
        var original = FullCheckpoint();
        var board = original.State.BoardActivities.ToArray();
        Assert.Equal(BoardDefinition.PrintedActivitySlotCount, board.Length);

        board[0] = tamper switch
        {
            "unknown-category" => board[0] with { Category = "unprinted" },
            "changed-category-quota" => board[0] with {
                Category = board.First(c => c.Category != board[0].Category).Category
            },
            "duplicate-slot" => board[0] with { SlotId = board[1].SlotId },
            "unknown-slot" => board[0] with { SlotId = "INVENTED" },
            _ => throw new ArgumentOutOfRangeException(nameof(tamper))
        };
        var forged = original with { State = original.State with { BoardActivities = board } };
        var error = Assert.Throws<InvalidDataException>(() => Restore(forged));
        Assert.DoesNotContain("test:action:", error.Message);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, error.Message);
        Assert.Equal(30, forged.State.BoardActivities.Count);
    }

    [Theory]
    [InlineData("duplicate-character")]
    [InlineData("hearts-zero")]
    [InlineData("hearts-six")]
    [InlineData("hearts-mismatch")]
    [InlineData("null-character")]
    public void RejectsForgedCharacterMetadataBeforeRestoringPrivateHands(string tamper)
    {
        var original = FullCheckpoint();
        var chars = original.State.AssignedCharacters.ToArray();
        var players = original.State.Players.ToArray();
        Assert.Equal(2, chars.Length);
        switch (tamper)
        {
            case "duplicate-character":
                chars[1] = chars[1] with { CharacterId = chars[0].CharacterId };
                break;
            case "hearts-zero":
                chars[0] = chars[0] with { PrintedInitialHearts = 0 };
                players[0] = players[0] with { Hearts = 0 };
                break;
            case "hearts-six":
                chars[0] = chars[0] with { PrintedInitialHearts = 6 };
                players[0] = players[0] with { Hearts = 6 };
                break;
            case "hearts-mismatch":
                players[0] = players[0] with { Hearts = chars[0].PrintedInitialHearts + 1 };
                break;
            case "null-character":
                chars[0] = null!;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(tamper));
        }
        var forged = original with { State = original.State with {
            Players = players, AssignedCharacters = chars
        } };
        var ex = Assert.Throws<InvalidDataException>(() => Restore(forged));
        Assert.DoesNotContain("test:action:", ex.Message);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, ex.Message);
    }

    [Theory]
    [InlineData("slot-only")]
    [InlineData("card-only")]
    public void RejectsInventedLegacyHeartsButKeepsLegitimateNoCharacterFixtures(string fixture)
    {
        var match = fixture == "slot-only"
            ? GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), Board,
                [new("alice", "N-01"), new("bob", "S-01")])
            : GameMatch.CreateFromTrustedCardSetup(Guid.NewGuid(), Board,
                [new("alice", "sport:01"), new("bob", "public-financing:01")],
                ActivitySetupFixture.Catalog(), 2026);
        var valid = match.CaptureCheckpoint();
        Assert.Empty(valid.State.AssignedCharacters);
        Assert.All(valid.State.Players, p => Assert.Null(p.Hearts));
        Assert.Null(valid.PrivateDeal);
        Assert.True(Restore(valid).VerifyPublicAudit().IsValid);

        var actors = valid.State.Players.ToArray();
        actors[0] = actors[0] with { Hearts = 3 };
        Assert.Throws<InvalidDataException>(() => Restore(valid with {
            State = valid.State with { Players = actors }
        }));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void AllEightPrintedQuotasSurviveCardOnlySetupAndRestoreAcrossSeatCounts(int count)
    {
        var catalog = ActivitySetupFixture.Catalog();
        var mandatory = catalog.GroupBy(c => c.Category, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal).Select(g => g.First().Id)
            .Take(count).ToArray();
        var match = GameMatch.CreateFromTrustedCardSetup(Guid.NewGuid(), Board,
            mandatory.Select((id, i) => new MatchParticipantCardSeed($"p-{i}", id)).ToArray(),
            catalog, 2026);
        var checkpoint = match.CaptureCheckpoint();
        var restored = Restore(checkpoint);
        Assert.True(restored.VerifyPublicAudit().IsValid);
        Assert.Equal(count, restored.Snapshot().Players.Count);
        Assert.Empty(restored.Snapshot().AssignedCharacters);
        Assert.Null(checkpoint.PrivateDeal);
        Assert.Equal(30, restored.Snapshot().BoardActivities.Count);
        foreach (var quota in ActivityPlacement.PrintedCategoryQuotas)
            Assert.Equal(quota.Value,
                restored.Snapshot().BoardActivities.Count(c => c.Category == quota.Key));
    }

    [Fact]
    public void CharacterAndFullDeckFirstRoundStillRestoreWithoutChangingPublicOrPrivateState()
    {
        var characters = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), Board, ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 2026);
        var charSnapshot = characters.CaptureCheckpoint();
        var charRestored = Restore(charSnapshot);
        Assert.Equal(charSnapshot.State.AssignedCharacters, charRestored.Snapshot().AssignedCharacters);
        Assert.Null(charRestored.PrivateHandForActor("alice"));

        var full = FullDeck();
        Assert.True(full.TryEndTurn("alice", 0).Accepted);
        Assert.True(full.TryEndTurn("bob", 1).Accepted);
        var checkpoint = full.CaptureCheckpoint();
        var replay = Restore(checkpoint);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, replay.Phase);
        Assert.Equal(checkpoint.State.BoardActivities, replay.Snapshot().BoardActivities);
        Assert.Equal(checkpoint.State.AssignedCharacters, replay.Snapshot().AssignedCharacters);
        Assert.True(replay.VerifyPublicAudit().IsValid);
        foreach (var seat in checkpoint.State.TurnOrder)
            Assert.Equal(full.PrivateHandForActor(seat)!.CardIds,
                replay.PrivateHandForActor(seat)!.CardIds);
    }
}
