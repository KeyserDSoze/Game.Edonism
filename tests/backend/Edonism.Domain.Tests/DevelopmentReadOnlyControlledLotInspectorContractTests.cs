using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #132: Visible controlled lots remain server-originated public setup
/// evidence; local React board inspection is not a command or ownership edit.
/// </summary>
public sealed class DevelopmentReadOnlyControlledLotInspectorContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void VisibleInitialControlledLotsRemainCanonicalAndOwnedThroughRound(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(count).Select((slot, i) =>
            new MatchParticipantSeed($"player-{i + 1}", slot.Id)).ToArray();
        var map = board.Slots.ToDictionary(s => s.Id, s => s.StreetId,
            StringComparer.Ordinal);
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var original = match.Snapshot().ControlledActivities
            .Select(c => (c.SlotId, c.OwnerPlayerId, c.Posture)).ToArray();

        void Verify(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(count, state.ControlledActivities.Count);
            Assert.Equal(original, state.ControlledActivities
                .Select(c => (c.SlotId, c.OwnerPlayerId, c.Posture)).ToArray());
            Assert.Equal(count, state.ControlledActivities
                .Select(c => c.SlotId).Distinct(StringComparer.Ordinal).Count());
            foreach (var control in state.ControlledActivities)
            {
                Assert.True(map.ContainsKey(control.SlotId));
                Assert.Contains(state.Players, p => p.PlayerId == control.OwnerPlayerId
                    && p.StartingSlotId == control.SlotId);
            }
            Assert.True(current.VerifyPublicAudit().IsValid);
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
