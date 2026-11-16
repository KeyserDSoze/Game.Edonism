using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #131: Canonical initial lot -> board street is a stable, PUBLIC server
/// attribute for read-only city inspection, not a client movement command.
/// </summary>
public sealed class DevelopmentReadOnlyOriginInspectorContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void CanonicalInitialLotStreetIsStableEvenWhenPawnMovesAway(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var slotMap = board.Slots.ToDictionary(x => x.Id, x => x.StreetId,
            StringComparer.Ordinal);
        var seeds = board.Slots.Take(count).Select((slot, i) =>
            new MatchParticipantSeed($"seat-{i + 1}", slot.Id)).ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var originals = seeds.ToDictionary(s => s.PlayerId, s => s.StartingSlotId,
            StringComparer.Ordinal);

        void AssertReadOnlyOrigins(GameMatch game)
        {
            var state = game.Snapshot();
            Assert.Equal(count, state.Players.Count);
            foreach (var player in state.Players)
            {
                Assert.Equal(originals[player.PlayerId], player.StartingSlotId);
                Assert.Contains(player.StartingSlotId, slotMap.Keys);
            }
            Assert.True(game.VerifyPublicAudit().IsValid);
        }

        AssertReadOnlyOrigins(match);
        for (var turn = 0; turn < count; turn++)
        {
            var active = match.ActivePlayerId!;
            var before = match.Snapshot().Players.Single(p => p.PlayerId == active);
            Assert.Equal(slotMap[before.StartingSlotId], before.StreetId);
            var destination = match.TurnOptionsForActor(active)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(active, destination, match.Revision).Accepted);
            var moved = match.Snapshot().Players.Single(p => p.PlayerId == active);
            Assert.Equal(originals[active], moved.StartingSlotId);
            Assert.NotEqual(before.StreetId, moved.StreetId);
            // Browser inspection remains on the originally assigned board lot
            // while the live pawn occupies an independently authored street.
            Assert.NotEqual(slotMap[moved.StartingSlotId], moved.StreetId);
            AssertReadOnlyOrigins(match);
            Assert.True(match.TryEndTurn(active, match.Revision).Accepted);
            AssertReadOnlyOrigins(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        AssertReadOnlyOrigins(GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint()));
    }
}
