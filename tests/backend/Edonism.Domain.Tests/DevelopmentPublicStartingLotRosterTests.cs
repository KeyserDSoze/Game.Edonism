using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #130: Starting lots are public player attributes in the .NET
/// authoritative snapshot. They never move with pawns or reveal private hands.
/// </summary>
public sealed class DevelopmentPublicStartingLotRosterTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicStartingLotRosterStaysStableAndDistinctAcrossFirstRound(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(count).Select((slot, index) =>
            new MatchParticipantSeed($"player-{index + 1}", slot.Id)).ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var originalSlots = seeds.Select(s => s.StartingSlotId).ToArray();

        void Verify(GameMatch game)
        {
            var state = game.Snapshot();
            Assert.Equal(originalSlots, state.Players.Select(p => p.StartingSlotId));
            Assert.Equal(count, state.Players.Select(p => p.StartingSlotId)
                .Distinct(StringComparer.Ordinal).Count());
            Assert.All(state.Players, player =>
                Assert.Contains(player.StartingSlotId, board.Slots.Select(s => s.Id)));
            Assert.Equal(count, state.ControlledActivities.Count);
            Assert.All(state.Players, player =>
                Assert.Contains(state.ControlledActivities,
                    c => c.SlotId == player.StartingSlotId
                      && c.OwnerPlayerId == player.PlayerId));
            Assert.True(game.VerifyPublicAudit().IsValid);
        }

        Verify(match);
        for (var i = 0; i < count; i++)
        {
            var actor = match.ActivePlayerId!;
            var destination = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, destination, match.Revision).Accepted);
            Verify(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            Verify(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        Verify(GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint()));
    }
}
