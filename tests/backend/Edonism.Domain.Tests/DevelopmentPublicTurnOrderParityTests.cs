using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #120: Ground the browser's narrow first-round ordered public read-model
/// invariant in the real authoritative .NET Domain, for 2, 4 and 8 seats.
/// The next-round order remains a PROPOSAL, not a settlement command.
/// </summary>
public sealed class DevelopmentPublicTurnOrderParityTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PlayersKeepImmutableFirstRoundTurnOrderAndExactlyRotatedNextRoundProposal(int seats)
    {
        var board = BoardCatalog.LoadDefault();
        var participants = board.Slots.Take(seats)
            .Select((slot, index) => new MatchParticipantSeed($"seat-{index + 1}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, participants);
        var originalOrder = participants.Select(x => x.PlayerId).ToArray();
        var expectedProposal = originalOrder.TakeLast(1)
            .Concat(originalOrder.Take(originalOrder.Length - 1)).ToArray();

        void AssertOrderedSnapshot()
        {
            var current = match.Snapshot();
            Assert.Equal(1, current.Round);
            Assert.Equal(originalOrder, current.TurnOrder);
            Assert.Equal(originalOrder, current.Players.Select(p => p.PlayerId));
            Assert.Equal(expectedProposal, current.ProposedNextRoundOrder);
            Assert.Equal(GameMatch.RotateLastToFirst(current.TurnOrder),
                current.ProposedNextRoundOrder);
            var replay = match.VerifyPublicAudit();
            Assert.True(replay.IsValid, replay.Code);
            Assert.Equal(current.Revision, replay.VerifiedRevision);
        }

        AssertOrderedSnapshot();
        for (var index = 0; index < seats; index++)
        {
            var actor = match.ActivePlayerId!;
            if (index % 2 == 0)
            {
                var street = match.Snapshot().Players.Single(p => p.PlayerId == actor).StreetId;
                var next = board.Streets.Single(p => p.Id == street).Neighbors[0];
                var moved = match.TryFreeMove(actor, next, match.Revision);
                Assert.True(moved.Accepted, moved.Code);
                AssertOrderedSnapshot();
            }
            var ended = match.TryEndTurn(actor, match.Revision);
            Assert.True(ended.Accepted, ended.Code);
            AssertOrderedSnapshot();
        }

        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        Assert.Null(match.ActivePlayerId);
        Assert.Equal(expectedProposal, match.PendingSettlementPreview()!.NextTurnOrder);
    }
}
