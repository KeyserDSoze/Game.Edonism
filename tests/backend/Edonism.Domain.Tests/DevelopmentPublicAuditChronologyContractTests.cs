using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #119: The currently implemented first-round Domain guarantees an
/// uninterrupted public revision/event timeline for 2/4/8 seats. The
/// browser only checks this shape; replay semantics stay in .NET.
/// </summary>
public sealed class DevelopmentPublicAuditChronologyContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EveryAcceptedFirstRoundActionAddsExactlyOneConsecutivePublicEvent(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var participants = board.Slots.Take(count)
            .Select((slot, index) => new MatchParticipantSeed($"seat-{index + 1}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, participants);

        void AssertPublicChronology()
        {
            var state = match.Snapshot();
            Assert.Equal(1, state.Round);
            Assert.Equal(state.Revision + 1, state.Events.Count);
            Assert.Equal(0, state.Events[0].Revision);
            Assert.Equal(1, state.Events[0].Round);
            Assert.Equal("match-created", state.Events[0].Kind);
            Assert.Equal("system", state.Events[0].ActorId);
            Assert.Null(state.Events[0].FromStreetId);
            Assert.Null(state.Events[0].ToStreetId);
            for (var i = 0; i < state.Events.Count; i++)
            {
                Assert.Equal(i, state.Events[i].Revision);
                Assert.Equal(1, state.Events[i].Round);
            }
            var replay = match.VerifyPublicAudit();
            Assert.True(replay.IsValid, replay.Code);
            Assert.Equal(state.Revision, replay.VerifiedRevision);
        }

        AssertPublicChronology();
        for (var turn = 0; turn < count; turn++)
        {
            var actor = match.ActivePlayerId!;
            if (turn % 2 == 0)
            {
                var position = match.Snapshot().Players.Single(p => p.PlayerId == actor).StreetId;
                var neighbor = board.Streets.Single(s => s.Id == position).Neighbors[0];
                var move = match.TryFreeMove(actor, neighbor, match.Revision);
                Assert.True(move.Accepted, move.Code);
                AssertPublicChronology();
            }

            var end = match.TryEndTurn(actor, match.Revision);
            Assert.True(end.Accepted, end.Code);
            AssertPublicChronology();
        }

        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        Assert.Null(match.ActivePlayerId);
        Assert.Equal("round-settlement-pending", match.Snapshot().Events[^1].Kind);
    }
}
