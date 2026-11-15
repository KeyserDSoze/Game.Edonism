using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #123: Public match streets from the authoritative Domain always exist on
/// the canonical board; client admission must not invent street locations.
/// </summary>
public sealed class DevelopmentCanonicalPublicStreetContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void MatchStreetsAreCanonicalThroughoutFirstRoundAndCheckpoint(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var streetIds = board.Streets.Select(street => street.Id)
            .ToHashSet(StringComparer.Ordinal);
        Assert.Equal(7, streetIds.Count);
        var seats = board.Slots.Take(count)
            .Select((slot, index) => new MatchParticipantSeed($"seat-{index + 1}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seats);

        void AssertCanonical(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(board.Version, state.BoardVersion);
            Assert.Equal(count, state.Players.Count);
            Assert.All(state.Players, player => Assert.Contains(player.StreetId, streetIds));
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        AssertCanonical(match);
        for (var index = 0; index < count; index++)
        {
            var actor = match.ActivePlayerId!;
            var from = match.Snapshot().Players.Single(player => player.PlayerId == actor).StreetId;
            var destination = board.Streets.Single(street => street.Id == from).Neighbors[0];
            Assert.True(match.TryFreeMove(actor, destination, match.Revision).Accepted);
            AssertCanonical(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            AssertCanonical(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        AssertCanonical(restored);
        Assert.Equal(match.Snapshot().Players, restored.Snapshot().Players);
    }
}
