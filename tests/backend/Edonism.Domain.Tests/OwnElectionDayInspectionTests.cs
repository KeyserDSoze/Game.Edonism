using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #164: inspection is ONLY of the bearer seat's current four-card hand.
/// No typed physical ID leaks, even when Election Day is in another seat's
/// hand or the hidden draw pile; historical v1 remains honestly unknown.
/// </summary>
public sealed class OwnElectionDayInspectionTests
{
    private static readonly Edonism.Domain.World.BoardDefinition Board =
        BoardCatalog.LoadDefault();

    private static GameMatch Full(int count, int seed = 2026) =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), Board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, seed);

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void OwnSeatIndexIsExactAndNoOtherHandOrPileIsInspected(int seats)
    {
        var game = Full(seats);
        var before = JsonSerializer.Serialize(game.CaptureCheckpoint());
        var deal = game.CaptureCheckpoint().PrivateDeal!;
        var special = deal.ElectionDayCardId!;
        Assert.Equal(ActionDeckFixture.ElectionDayId, special);
        var first = game.Snapshot();

        for (var i = 0; i < seats; i++)
        {
            var player = first.Players[i].PlayerId;
            var ownCards = game.PrivateHandForActor(player)!.CardIds;
            var expectedIndex = Array.IndexOf(ownCards.ToArray(), special);
            var response = game.InspectOwnElectionDayForActor(player);
            Assert.NotNull(response);
            Assert.Equal(game.MatchId, response.MatchId);
            Assert.Equal(player, response.PlayerId);
            Assert.Equal(0, response.VerifiedRevision);
            Assert.True(response.ClassificationAvailable);
            Assert.Equal(expectedIndex < 0 ? null : expectedIndex,
                response.OwnHandIndex);
            if (response.OwnHandIndex is not null)
            {
                Assert.InRange(response.OwnHandIndex.Value, 0, 3);
                Assert.Equal(special, ownCards[response.OwnHandIndex.Value]);
            }

            var wire = JsonSerializer.Serialize(response);
            Assert.DoesNotContain("ElectionDayCardId", wire);
            Assert.DoesNotContain("CardIds", wire);
            Assert.DoesNotContain(special, wire);
            Assert.DoesNotContain("DrawPile", wire);
            Assert.DoesNotContain("Token", wire);
        }
        Assert.Null(game.InspectOwnElectionDayForActor("system"));
        Assert.Null(game.InspectOwnElectionDayForActor("outsider"));
        Assert.Null(game.InspectOwnElectionDayForActor(""));
        Assert.Equal(before, JsonSerializer.Serialize(game.CaptureCheckpoint()));
        Assert.True(game.VerifyPublicAudit().IsValid);
    }

    [Fact]
    public void GenuinePrivateCardCanBeInOwnHandAnotherHandOrRemainingPile()
    {
        var sawOwnHand = false;
        var sawOtherHand = false;
        var sawPile = false;
        for (var seed = 0; seed < 250
            && !(sawOwnHand && sawOtherHand && sawPile); seed++)
        {
            var game = Full(4, seed);
            var deal = game.CaptureCheckpoint().PrivateDeal!;
            var special = deal.ElectionDayCardId!;
            var own = game.InspectOwnElectionDayForActor("player-0")!;
            Assert.True(own.ClassificationAvailable);
            var expectedIndex = Array.IndexOf(deal.Hands[0].CardIds.ToArray(), special);
            Assert.Equal(expectedIndex < 0 ? null : expectedIndex,
                own.OwnHandIndex);

            if (expectedIndex >= 0)
                sawOwnHand = true;
            else if (deal.Hands.Skip(1)
                .Any(hand => hand.CardIds.Contains(special)))
                sawOtherHand = true;
            else
                sawPile = true;
        }
        Assert.True(sawOwnHand);
        Assert.True(sawOtherHand);
        Assert.True(sawPile);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void MovementEndTurnAndCheckpointRestoreNeverChangeClassification(int seats)
    {
        var game = Full(seats);
        var original = game.Snapshot();
        var expected = original.Players.ToDictionary(
            player => player.PlayerId,
            player => game.InspectOwnElectionDayForActor(player.PlayerId)!,
            StringComparer.Ordinal);
        var first = original.Players[0];
        var nextRoad = Board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(game.TryFreeMove(first.PlayerId, nextRoad, 0).Accepted);
        foreach (var player in original.Players)
            Assert.True(game.TryEndTurn(player.PlayerId, game.Revision).Accepted);

        var after = game.Snapshot();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, after.Phase);
        foreach (var player in after.Players)
        {
            var current = game.InspectOwnElectionDayForActor(player.PlayerId)!;
            Assert.Equal(after.Revision, current.VerifiedRevision);
            Assert.Equal(expected[player.PlayerId].ClassificationAvailable,
                current.ClassificationAvailable);
            Assert.Equal(expected[player.PlayerId].OwnHandIndex, current.OwnHandIndex);
        }
        var restored = GameMatch.RestoreFromCheckpoint(Board, game.CaptureCheckpoint());
        Assert.True(restored.VerifyPublicAudit().IsValid);
        foreach (var player in after.Players)
            Assert.Equal(game.InspectOwnElectionDayForActor(player.PlayerId),
                restored.InspectOwnElectionDayForActor(player.PlayerId));
        Assert.Equal(original.Players.Select(x => x.Atoms),
            after.Players.Select(x => x.Atoms));
    }

    [Fact]
    public void HistoricalV1NeverLiesAboutMissingPrintedType()
    {
        var newCheckpoint = Full(2).CaptureCheckpoint();
        var legacy = newCheckpoint with
        {
            FormatVersion = GameMatch.LegacyCheckpointVersion,
            PrivateDeal = newCheckpoint.PrivateDeal! with
            {
                ElectionDayCardId = null
            }
        };
        var restored = GameMatch.RestoreFromCheckpoint(Board, legacy);
        for (var i = 0; i < 2; i++)
        {
            var seat = $"player-{i}";
            var inspection = restored.InspectOwnElectionDayForActor(seat)!;
            Assert.False(inspection.ClassificationAvailable);
            Assert.Null(inspection.OwnHandIndex);
            Assert.Equal(0, inspection.VerifiedRevision);
        }
        Assert.Null(restored.InspectOwnElectionDayForActor("unknown"));
        Assert.Equal(GameMatch.LegacyCheckpointVersion,
            restored.CaptureCheckpoint().FormatVersion);
        Assert.Null(restored.CaptureCheckpoint().PrivateDeal!.ElectionDayCardId);
    }

    [Fact]
    public void LegacyFixtureWithNoPrivateCardsReturnsNoInspectionAtAll()
    {
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), Board,
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "S-01")]);
        Assert.Null(match.InspectOwnElectionDayForActor("alice"));
        Assert.Null(match.InspectOwnElectionDayForActor("bob"));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }
}
