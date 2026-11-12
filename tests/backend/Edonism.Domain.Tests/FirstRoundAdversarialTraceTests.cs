using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #75: deterministic adversarial interleavings for the IMPLEMENTED first
/// round only. No cards, settlement, elections, latency, or Production identity.
/// GameMatch's caller must still serialize commands and authenticate the actor.
/// </summary>
public sealed class FirstRoundAdversarialTraceTests
{
    public static IEnumerable<object[]> Scenarios
    {
        get
        {
            foreach (var seats in Enumerable.Range(2, 7))
            foreach (var seed in new[] { 13, 73, 233 })
                yield return new object[] { seats, seed };
        }
    }

    private static void RejectWithoutMutation(
        GameMatch match, Func<MatchCommandResult> command, string expectedCode)
    {
        // Public snapshot contains economy, owned lots, event history, turn
        // state and revision; it deliberately does NOT include secret hands.
        var before = JsonSerializer.Serialize(match.Snapshot());
        var result = command();
        Assert.False(result.Accepted);
        Assert.Equal(expectedCode, result.Code);
        Assert.Equal(before, JsonSerializer.Serialize(result.State));
        Assert.Equal(before, JsonSerializer.Serialize(match.Snapshot()));
        var replay = match.VerifyPublicAudit();
        Assert.True(replay.IsValid, replay.Code);
        Assert.Equal(match.Revision, replay.VerifiedRevision);
    }

    private static void AssertReplayMatchesCurrent(GameMatch match)
    {
        var state = match.Snapshot();
        var replay = match.VerifyPublicAudit();
        Assert.True(replay.IsValid, replay.Code);
        Assert.Equal(state.Revision, replay.VerifiedRevision);
        Assert.Equal(state.Phase, replay.Phase);
        Assert.Equal(state.ActivePlayerId, replay.ActivePlayerId);
        Assert.Equal(state.Players.Select(p => p.PlayerId),
            replay.Players.Select(p => p.PlayerId));
        Assert.Equal(state.Players.Select(p => p.StreetId),
            replay.Players.Select(p => p.StreetId));
        Assert.Equal(state.Players.Select(p => p.FreeMoveUsed),
            replay.Players.Select(p => p.FreeMoveUsed));
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void RejectedOpponentAndStaleCommandsNeverMutateAuthoritativeState(
        int seats, int seed)
    {
        var board = BoardCatalog.LoadDefault();
        var rng = new Random(seed);
        var selectedSlots = board.Slots.OrderBy(_ => rng.Next()).Take(seats).ToArray();
        var participants = selectedSlots
            .Select((slot, i) => new MatchParticipantSeed($"seat-{i + 1}", slot.Id))
            .ToArray();
        var actorIds = participants.Select(p => p.PlayerId).ToArray();

        var match = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), board, participants);
        AssertReplayMatchesCurrent(match);
        var acceptedCommands = 0;

        for (var turn = 0; turn < seats; turn++)
        {
            var actor = actorIds[turn];
            var opponent = actorIds[(turn + 1) % seats];
            var before = match.Snapshot();
            Assert.Equal(actor, before.ActivePlayerId);
            Assert.Equal(MatchPhase.PlayerTurns, before.Phase);

            // A different player cannot end or move on this actor's turn.
            RejectWithoutMutation(match,
                () => match.TryEndTurn(opponent, match.Revision), "not_your_turn");
            RejectWithoutMutation(match,
                () => match.TryFreeMove(opponent, "gauss", match.Revision), "not_your_turn");

            var street = before.Players.Single(p => p.PlayerId == actor).StreetId;
            RejectWithoutMutation(match,
                () => match.TryFreeMove(actor, "not-a-street", match.Revision),
                "unknown_street");
            RejectWithoutMutation(match,
                () => match.TryFreeMove(actor, street, match.Revision),
                "not_adjacent");

            // Every trace chooses a reproducible mixture of players that move
            // and players that end without moving. Never infer a legal move
            // from coordinates: use only the canonical Domain street graph.
            if (rng.Next(2) == 0)
            {
                var neighbors = board.Streets.Single(s => s.Id == street).Neighbors;
                var destination = neighbors[rng.Next(neighbors.Count)];
                var revision = match.Revision;
                var result = match.TryFreeMove(actor, destination, revision);
                Assert.True(result.Accepted, result.Code);
                Assert.Equal(revision + 1, match.Revision);
                acceptedCommands++;
                AssertReplayMatchesCurrent(match);

                RejectWithoutMutation(match,
                    () => match.TryFreeMove(actor, destination, revision),
                    "revision_conflict");
                RejectWithoutMutation(match,
                    () => match.TryFreeMove(actor, destination, match.Revision),
                    "free_move_already_used");
            }

            RejectWithoutMutation(match,
                () => match.TryEndTurn(opponent, match.Revision), "not_your_turn");
            var beforeEnd = match.Revision;
            var end = match.TryEndTurn(actor, beforeEnd);
            Assert.True(end.Accepted, end.Code);
            Assert.Equal(beforeEnd + 1, match.Revision);
            acceptedCommands++;
            AssertReplayMatchesCurrent(match);

            RejectWithoutMutation(match,
                () => match.TryEndTurn(actor, beforeEnd), "revision_conflict");
        }

        var pending = match.Snapshot();
        Assert.Equal((long)acceptedCommands, pending.Revision);
        Assert.Equal(acceptedCommands + 1, pending.Events.Count);
        Assert.Equal(1, pending.Round);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, pending.Phase);
        Assert.Null(pending.ActivePlayerId);
        Assert.Equal(actorIds[^1], pending.ProposedNextRoundOrder[0]);
        Assert.Equal(actorIds, pending.TurnOrder);
        Assert.Equal("round-settlement-pending", pending.Events[^1].Kind);
        Assert.All(pending.Players, p =>
        {
            Assert.Equal(4, p.Atoms);
            Assert.Equal(2, p.DiplomacyTokens);
            Assert.Equal(16, p.HenchmenTotal);
            Assert.Equal(15, p.HenchmenAvailable);
        });

        foreach (var actor in actorIds)
        {
            RejectWithoutMutation(match,
                () => match.TryEndTurn(actor, match.Revision),
                "round_settlement_pending");
            RejectWithoutMutation(match,
                () => match.TryFreeMove(actor, "gauss", match.Revision),
                "round_settlement_pending");
        }

        // Restore never invents another round or unfreezes a settled game.
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Assert.Equal(JsonSerializer.Serialize(pending),
            JsonSerializer.Serialize(restored.Snapshot()));
        AssertReplayMatchesCurrent(restored);
        RejectWithoutMutation(restored,
            () => restored.TryEndTurn(actorIds[0], restored.Revision),
            "round_settlement_pending");
        Assert.Null(restored.PrivateHandForActor(actorIds[0]));
    }
}
