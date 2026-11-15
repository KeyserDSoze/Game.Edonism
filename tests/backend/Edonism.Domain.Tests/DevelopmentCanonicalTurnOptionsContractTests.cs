using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #124: The backend is authoritative for the complete route list. Client
/// validation only verifies destination membership, never adjacency.
/// </summary>
public sealed class DevelopmentCanonicalTurnOptionsContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void ActorTurnDestinationsRemainCanonicalAcrossMovesAndCheckpoint(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var ids = board.Streets.Select(street => street.Id)
            .ToHashSet(StringComparer.Ordinal);
        Assert.Equal(7, ids.Count);
        var seats = board.Slots.Take(count)
            .Select((slot, index) => new MatchParticipantSeed($"seat-{index + 1}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seats);

        void AssertOptions(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(board.Version, state.BoardVersion);
            foreach (var player in state.Players)
            {
                var options = current.TurnOptionsForActor(player.PlayerId);
                Assert.NotNull(options);
                Assert.Equal(state.Revision, options.Revision);
                Assert.Equal(player.PlayerId, options.PlayerId);
                Assert.Equal(state.MatchId, options.MatchId);
                Assert.All(options.FreeMoveStreetIds, id => Assert.Contains(id, ids));
                var acting = state.Phase == MatchPhase.PlayerTurns
                    && state.ActivePlayerId == player.PlayerId;
                Assert.Equal(acting, options.CanEndTurn);
                if (!acting || player.FreeMoveUsed)
                {
                    Assert.Empty(options.FreeMoveStreetIds);
                }
                else
                {
                    var neighbors = board.Streets.Single(s => s.Id == player.StreetId).Neighbors;
                    Assert.Equal(neighbors, options.FreeMoveStreetIds);
                }
            }
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        AssertOptions(match);
        for (var step = 0; step < count; step++)
        {
            var actor = match.ActivePlayerId!;
            var next = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, next, match.Revision).Accepted);
            AssertOptions(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            AssertOptions(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        AssertOptions(restored);
    }
}
