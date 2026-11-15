using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #126: .NET authors the first-round public audit. The browser only checks
/// membership of public actor identifiers, not event or command legality.
/// </summary>
public sealed class DevelopmentCanonicalPublicAuditActorsTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EventsReferenceCurrentMatchSeatsOrReservedSystemActor(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(count)
            .Select((slot, index) =>
                new MatchParticipantSeed($"seat-{index + 1}", slot.Id)).ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var ids = seeds.Select(p => p.PlayerId).ToHashSet(StringComparer.Ordinal);

        void Verify(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(count, state.Players.Count);
            Assert.Equal("system", state.Events[0].ActorId);
            Assert.Equal("match-created", state.Events[0].Kind);
            Assert.All(state.Events.Skip(1), entry =>
                Assert.Contains(entry.ActorId, ids));
            Assert.Equal((long)state.Events.Count - 1, state.Revision);
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        Verify(match);
        for (var step = 0; step < count; step++)
        {
            var actor = match.ActivePlayerId!;
            var street = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, street, match.Revision).Accepted);
            Assert.Equal(actor, match.Snapshot().Events[^1].ActorId);
            Verify(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            Assert.Equal(actor, match.Snapshot().Events[^1].ActorId);
            Verify(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Verify(restored);
        Assert.Equal(match.Snapshot().Events, restored.Snapshot().Events);
    }
}
