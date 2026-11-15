using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #122: The authoritative first-round match board version comes only
/// from BoardCatalog's canonical shared JSON; read/commands cannot drift
/// into an incompatible client board version at a stable match ID.
/// </summary>
public sealed class DevelopmentCanonicalBoardVersionContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicBoardVersionAlwaysMatchesCanonicalSourceThroughAllFirstRoundTurns(
        int count)
    {
        var board = BoardCatalog.LoadDefault();
        Assert.Equal("edonism-streets-v1", board.Version);
        var seats = board.Slots.Take(count)
            .Select((slot, i) => new MatchParticipantSeed($"seat-{i + 1}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seats);
        var initialVersion = match.Snapshot().BoardVersion;

        void AssertBoardVersion()
        {
            var state = match.Snapshot();
            Assert.Equal(board.Version, state.BoardVersion);
            Assert.Equal(initialVersion, state.BoardVersion);
            var verification = match.VerifyPublicAudit();
            Assert.True(verification.IsValid, verification.Code);
            Assert.Equal(state.Revision, verification.VerifiedRevision);
        }

        AssertBoardVersion();
        for (var i = 0; i < count; i++)
        {
            var actor = match.ActivePlayerId!;
            if (i % 2 == 0)
            {
                var streetId = match.Snapshot().Players.Single(p => p.PlayerId == actor).StreetId;
                var next = board.Streets.Single(p => p.Id == streetId).Neighbors[0];
                var move = match.TryFreeMove(actor, next, match.Revision);
                Assert.True(move.Accepted, move.Code);
                AssertBoardVersion();
            }

            var end = match.TryEndTurn(actor, match.Revision);
            Assert.True(end.Accepted, end.Code);
            AssertBoardVersion();
        }

        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var checkpoint = match.CaptureCheckpoint();
        Assert.Equal(board.Version, checkpoint.State.BoardVersion);
        var restored = GameMatch.RestoreFromCheckpoint(board, checkpoint);
        Assert.Equal(board.Version, restored.Snapshot().BoardVersion);
        AssertBoardVersion();
    }
}
