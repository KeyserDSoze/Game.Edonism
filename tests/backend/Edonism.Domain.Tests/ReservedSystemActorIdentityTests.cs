using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #128: "system" is the single audit-genesis principal, never a player.
/// Reserved identity must not leak through trusted setup, public audit,
/// authoritative turn actors or checkpoint restoration.
/// </summary>
public sealed class ReservedSystemActorIdentityTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void CannotCreateOrRestoreASeatThatCollidesWithGenesis(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var names = Enumerable.Range(0, count)
            .Select(i => $"seat-{i + 1}").ToArray();
        names[^1] = "System"; // Exact-case distinction remains supported.
        var validSeeds = names.Select((id, i) =>
            new MatchParticipantSeed(id, board.Slots[i].Id)).ToArray();
        var invalidSeeds = validSeeds.Select((p, i) => i == count - 1
            ? p with { PlayerId = "system" } : p).ToArray();
        Assert.False(MatchParticipantId.IsValid("system"));
        Assert.True(MatchParticipantId.IsValid("System"));
        Assert.True(MatchParticipantId.IsValid("SYSTEM"));
        Assert.Throws<ArgumentException>(() =>
            GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, invalidSeeds));

        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, validSeeds);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Equal("system", match.Snapshot().Events[0].ActorId);
        for (var i = 0; i < count; i++)
        {
            var actor = match.ActivePlayerId!;
            var destination = match.TurnOptionsForActor(actor)!.FreeMoveStreetIds[0];
            Assert.True(match.TryFreeMove(actor, destination, match.Revision).Accepted);
            Assert.Equal(actor, match.Snapshot().Events[^1].ActorId);
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            Assert.True(match.VerifyPublicAudit().IsValid);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
        var checkpoint = match.CaptureCheckpoint();
        var restored = GameMatch.RestoreFromCheckpoint(board, checkpoint);
        Assert.True(restored.VerifyPublicAudit().IsValid);
        Assert.Equal("System", restored.Snapshot().Players[^1].PlayerId);

        // Tamper all public roster references coherently, not merely the
        // displayed name: the replay boundary must still refuse the reserved
        // technical principal and publish zero partial frames.
        var state = checkpoint.State;
        var tamperedPlayers = state.Players.Select((p, i) =>
            i == count - 1 ? p with { PlayerId = "system" } : p).ToArray();
        var tamperedOrder = state.TurnOrder.Select(id =>
            id == "System" ? "system" : id).ToArray();
        var forged = checkpoint with
        {
            State = state with
            {
                Players = tamperedPlayers,
                TurnOrder = tamperedOrder,
                ProposedNextRoundOrder = state.ProposedNextRoundOrder
                    .Select(id => id == "System" ? "system" : id).ToArray()
            }
        };
        var verification = MatchAuditReplay.Verify(board, forged.State);
        Assert.False(verification.IsValid);
        Assert.Equal("invalid_audit_setup", verification.Code);
        Assert.Empty(verification.Frames);
        Assert.Throws<InvalidDataException>(() =>
            GameMatch.RestoreFromCheckpoint(board, forged));
    }
}
