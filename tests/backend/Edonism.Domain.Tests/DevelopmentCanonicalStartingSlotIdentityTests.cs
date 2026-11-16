using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #129: Only .NET decides the actual 30-lot trusted setup and legal moves.
/// Public origin IDs remain canonical and immutable after each command.
/// </summary>
public sealed class DevelopmentCanonicalStartingSlotIdentityTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void OriginsStayUniqueCanonicalAndImmutableThroughCommandsAndRestore(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(count).Select((s, i) =>
            new MatchParticipantSeed($"seat-{i + 1}", s.Id)).ToArray();
        var validSlotIds = board.Slots.Select(s => s.Id)
            .ToHashSet(StringComparer.Ordinal);
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);

        void Verify(GameMatch current)
        {
            var state = current.Snapshot();
            Assert.Equal(seeds.Select(s => s.StartingSlotId),
                state.Players.Select(p => p.StartingSlotId));
            Assert.Equal(count, state.Players.Select(p => p.StartingSlotId)
                .Distinct(StringComparer.Ordinal).Count());
            Assert.All(state.Players, p => Assert.Contains(p.StartingSlotId, validSlotIds));
            Assert.True(current.VerifyPublicAudit().IsValid);
        }

        Verify(match);
        for (var turn = 0; turn < count; turn++)
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

        // Changing even one trusted origin is a setup/audit failure, not a
        // free-move. The verifier must withhold every partial history frame.
        foreach (var wrong in new[] { seeds[0].StartingSlotId, "foreign-lot" })
        {
            var invalid = seeds.Select((p, i) => i == count - 1
                ? p with { StartingSlotId = wrong } : p).ToArray();
            Assert.Throws<ArgumentException>(() =>
                GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, invalid));

            var state = match.Snapshot();
            var forgedPlayers = state.Players.Select((p, i) => i == count - 1
                ? p with { StartingSlotId = wrong } : p).ToArray();
            var result = MatchAuditReplay.Verify(board, state with { Players = forgedPlayers });
            Assert.False(result.IsValid);
            Assert.Equal("invalid_audit_setup", result.Code);
            Assert.Empty(result.Frames);
        }
    }
}
