using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #127: Public IDs are authored by the .NET technical MatchParticipantId
/// policy. React's new ingress boundary mirrors this display-safe shape
/// without becoming an authentication authority.
/// </summary>
public sealed class DevelopmentTechnicalPublicRosterContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void OfficialFirstRoundRosterRemainsDisplaySafeThroughCheckpoint(int seats)
    {
        var board = BoardCatalog.LoadDefault();
        var ids = new[]
        {
            "Renée", "王小明", "Alpha Player", "Player🙂",
            new string('A', 64), new string('界', 64),
            string.Concat(Enumerable.Repeat("🙂", 32)), "alice"
        };
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
            ids.Take(seats).Select((id, index) =>
                new MatchParticipantSeed(id, board.Slots[index].Id)).ToArray());

        void Verify(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(ids.Take(seats), state.Players.Select(p => p.PlayerId));
            Assert.Equal(ids.Take(seats), state.TurnOrder);
            Assert.All(state.Players, p => Assert.True(MatchParticipantId.IsValid(p.PlayerId)));
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        Verify(match);
        for (var i = 0; i < seats; i++)
        {
            var actor = match.ActivePlayerId!;
            var dest = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, dest, match.Revision).Accepted);
            Verify(match);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            Verify(match);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        Verify(GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint()));
    }
}
