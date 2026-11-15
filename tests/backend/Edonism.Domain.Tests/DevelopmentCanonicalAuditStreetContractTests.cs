using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #125: The Domain is the only authority for legal moves and immutable
/// public audit. Browser ingress merely refuses nonprinted street IDs.
/// </summary>
public sealed class DevelopmentCanonicalAuditStreetContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void FirstRoundPublicAuditEndpointsRemainOnTheCanonicalBoard(int seatCount)
    {
        var board = BoardCatalog.LoadDefault();
        var canonical = board.Streets.Select(s => s.Id)
            .ToHashSet(StringComparer.Ordinal);
        Assert.Equal(7, canonical.Count);
        var players = board.Slots.Take(seatCount)
            .Select((s, i) => new MatchParticipantSeed($"seat-{i + 1}", s.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, players);

        void Verify(GameMatch actual)
        {
            var state = actual.Snapshot();
            Assert.True(actual.VerifyPublicAudit().IsValid);
            Assert.Equal(state.Revision + 1, (long)state.Events.Count);
            foreach (var evt in state.Events)
            {
                if (evt.FromStreetId is not null)
                    Assert.Contains(evt.FromStreetId, canonical);
                if (evt.ToStreetId is not null)
                    Assert.Contains(evt.ToStreetId, canonical);
            }
        }

        Verify(match);
        for (var i = 0; i < seatCount; i++)
        {
            var actor = match.ActivePlayerId!;
            var available = match.TurnOptionsForActor(actor)!;
            var source = match.Snapshot().Players.Single(p => p.PlayerId == actor).StreetId;
            var destination = available.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, destination, match.Revision).Accepted);
            Verify(match);
            var moved = match.Snapshot().Events[^1];
            Assert.Equal("free-move", moved.Kind);
            Assert.Equal(source, moved.FromStreetId);
            Assert.Equal(destination, moved.ToStreetId);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            Verify(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Verify(restored);
        Assert.Equal(match.Snapshot().Events, restored.Snapshot().Events);
    }
}
