using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #133: PvP public current streets follow server-authored first-round
/// movement, not the immutable origin lot or viewer-only board selection.
/// </summary>
public sealed class DevelopmentReadOnlyCurrentStreetInspectorContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void ServerCurrentStreetMovesWhileStartingLotRemainsUnchanged(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var known = board.Streets.Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
        var seeds = board.Slots.Take(count).Select((slot, i) =>
            new MatchParticipantSeed($"player-{i + 1}", slot.Id)).ToArray();
        var initialStreet = board.Slots.ToDictionary(
            s => s.Id, s => s.StreetId, StringComparer.Ordinal);
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);

        void AssertPublicReadOnlyStreet(GameMatch current)
        {
            var snapshot = current.Snapshot();
            Assert.Equal(count, snapshot.Players.Count);
            foreach (var seat in snapshot.Players)
            {
                Assert.Contains(seat.StreetId, known);
                Assert.Contains(seat.StartingSlotId, initialStreet.Keys);
                Assert.Equal(seeds.Single(s => s.PlayerId == seat.PlayerId)
                    .StartingSlotId, seat.StartingSlotId);
            }
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        AssertPublicReadOnlyStreet(match);
        for (var turn = 0; turn < count; turn++)
        {
            var actor = match.ActivePlayerId!;
            var before = match.Snapshot().Players.Single(p => p.PlayerId == actor);
            Assert.Equal(initialStreet[before.StartingSlotId], before.StreetId);
            var next = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, next, match.Revision).Accepted);
            var moved = match.Snapshot().Players.Single(p => p.PlayerId == actor);
            Assert.Equal(next, moved.StreetId);
            Assert.NotEqual(before.StreetId, moved.StreetId);
            Assert.Equal(before.StartingSlotId, moved.StartingSlotId);
            AssertPublicReadOnlyStreet(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            AssertPublicReadOnlyStreet(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        AssertPublicReadOnlyStreet(GameMatch.RestoreFromCheckpoint(board,
            match.CaptureCheckpoint()));
    }
}
