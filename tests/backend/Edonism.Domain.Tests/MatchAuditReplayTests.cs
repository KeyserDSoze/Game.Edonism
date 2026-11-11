using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class MatchAuditReplayTests
{
    private static GameMatch NewMatch() => GameMatch.CreateFromTrustedSetup(
        Guid.NewGuid(), BoardCatalog.LoadDefault(),
        [new("alice", "N-01"), new("bob", "S-01")]);

    private static MatchSnapshot Complete()
    {
        var match = NewMatch();
        Assert.True(match.TryFreeMove("alice", "planck", 0).Accepted);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryFreeMove("bob", "newton", 2).Accepted);
        Assert.True(match.TryEndTurn("bob", 3).Accepted);
        return match.Snapshot();
    }

    private static MatchSnapshot ReplaceEvent(MatchSnapshot snapshot, int i,
        Func<MatchAuditEvent, MatchAuditEvent> replace)
    {
        var events = snapshot.Events.ToArray();
        events[i] = replace(events[i]);
        return snapshot with { Events = Array.AsReadOnly(events) };
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void ReplaySupportsTwoThroughEightPlayersAndEveryIntermediateRevision(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(count)
            .Select((slot, i) => new MatchParticipantSeed($"player-{i}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        Assert.True(match.VerifyPublicAudit().IsValid);
        for (var i = 0; i < count; i++)
        {
            var actor = match.ActivePlayerId!;
            var original = match.Snapshot().Players.Single(p => p.PlayerId == actor);
            if (i % 2 == 0)
            {
                var next = board.Streets.Single(s => s.Id == original.StreetId).Neighbors[0];
                Assert.True(match.TryFreeMove(actor, next, match.Revision).Accepted);
                var step = match.VerifyPublicAudit();
                Assert.True(step.IsValid, step.Code);
                Assert.Equal(next, step.Players.Single(p => p.PlayerId == actor).StreetId);
                Assert.True(step.Players.Single(p => p.PlayerId == actor).FreeMoveUsed);
            }
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            var check = match.VerifyPublicAudit();
            Assert.True(check.IsValid, check.Code);
            Assert.Equal(match.Revision, check.VerifiedRevision);
        }
        var final = match.VerifyPublicAudit();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, final.Phase);
        Assert.Null(final.ActivePlayerId);
        Assert.Equal(match.Snapshot().Players.Select(p => p.StreetId),
            final.Players.Select(p => p.StreetId));
    }

    [Theory]
    [InlineData("revision", "invalid_event_revision")]
    [InlineData("round", "invalid_event_revision")]
    [InlineData("actor", "event_out_of_turn")]
    [InlineData("origin", "invalid_move_event")]
    [InlineData("destination", "invalid_move_event")]
    [InlineData("unknown", "unknown_event_kind")]
    public void RejectsTamperedEvents(string change, string expected)
    {
        var original = Complete();
        var modified = ReplaceEvent(original, 1, e => change switch
        {
            "revision" => e with { Revision = 10 },
            "round" => e with { Round = 2 },
            "actor" => e with { ActorId = "bob" },
            "origin" => e with { FromStreetId = "einstein" },
            "destination" => e with { ToStreetId = "not-a-street" },
            "unknown" => e with { Kind = "secret-action" },
            _ => throw new InvalidOperationException()
        });
        var check = MatchAuditReplay.Verify(BoardCatalog.LoadDefault(), modified);
        Assert.False(check.IsValid);
        Assert.Equal(expected, check.Code);
        Assert.Equal(0, check.VerifiedRevision);
    }

    [Fact]
    public void RepeatedFreeMoveAndEventsAfterRoundEndAreInvalid()
    {
        var original = Complete();
        var doubled = original.Events.ToList();
        doubled.Insert(2, new MatchAuditEvent(2, 1, "free-move",
            "alice", "planck", "einstein"));
        Assert.Equal("repeated_free_move",
            MatchAuditReplay.Verify(BoardCatalog.LoadDefault(),
                original with { Events = Array.AsReadOnly(doubled.ToArray()) }).Code);

        var after = original.Events.Concat([
            new MatchAuditEvent(5, 1, "turn-ended", "bob", null, null)
        ]).ToArray();
        Assert.Equal("events_after_settlement",
            MatchAuditReplay.Verify(BoardCatalog.LoadDefault(),
                original with { Events = Array.AsReadOnly(after) }).Code);
    }

    [Fact]
    public void PrematureRoundEndOrFinishingLastTurnWithWrongEventIsInvalid()
    {
        var original = Complete();
        Assert.Equal("invalid_settlement_event",
            MatchAuditReplay.Verify(BoardCatalog.LoadDefault(),
                ReplaceEvent(original, 2, e => e with { Kind = "round-settlement-pending" })).Code);
        Assert.Equal("invalid_turn_end_event",
            MatchAuditReplay.Verify(BoardCatalog.LoadDefault(),
                ReplaceEvent(original, 4, e => e with { Kind = "turn-ended" })).Code);
        Assert.Equal("invalid_genesis_event",
            MatchAuditReplay.Verify(BoardCatalog.LoadDefault(),
                original with { Events = Array.AsReadOnly(original.Events.Skip(1).ToArray()) }).Code);
    }

    [Fact]
    public void FinalStatePositionsFlagsRevisionsAndRotationMustMatchReplay()
    {
        var original = Complete();
        var board = BoardCatalog.LoadDefault();
        Assert.Equal("snapshot_state_mismatch",
            MatchAuditReplay.Verify(board, original with { Revision = 9 }).Code);
        Assert.Equal("snapshot_state_mismatch",
            MatchAuditReplay.Verify(board, original with { Phase = MatchPhase.PlayerTurns }).Code);
        Assert.Equal("snapshot_state_mismatch",
            MatchAuditReplay.Verify(board, original with { ActivePlayerId = "bob" }).Code);
        Assert.Equal("invalid_proposed_order",
            MatchAuditReplay.Verify(board, original with
                { ProposedNextRoundOrder = original.TurnOrder }).Code);
        var players = original.Players.ToArray();
        players[0] = players[0] with { StreetId = "gauss" };
        Assert.Equal("snapshot_position_mismatch",
            MatchAuditReplay.Verify(board, original with
                { Players = Array.AsReadOnly(players) }).Code);
        players[0] = original.Players[0] with { FreeMoveUsed = false };
        Assert.Equal("snapshot_position_mismatch",
            MatchAuditReplay.Verify(board, original with
                { Players = Array.AsReadOnly(players) }).Code);
    }

    [Fact]
    public void RejectedCommandsNeverAppendAuditEventsOrChangeReplay()
    {
        var match = NewMatch();
        Assert.False(match.TryFreeMove("bob", "planck", 0).Accepted);
        Assert.False(match.TryFreeMove("alice", "not-a-street", 0).Accepted);
        var snapshot = match.Snapshot();
        var result = match.VerifyPublicAudit();
        Assert.True(result.IsValid, result.Code);
        Assert.Equal(0, result.VerifiedRevision);
        Assert.Single(snapshot.Events);
        Assert.Equal(snapshot.Events, match.Snapshot().Events);
        Assert.Equal(snapshot.Players, match.Snapshot().Players);
    }

    [Fact]
    public void VerifiedHistoryFramesAreRevisionAlignedAndImmutableAfterFutureMoves()
    {
        var match = NewMatch();
        var genesis = match.VerifyPublicAudit();
        Assert.True(genesis.IsValid);
        var start = Assert.Single(genesis.Frames);
        Assert.Equal(0, start.Revision);
        Assert.Equal("match-created", start.Kind);
        Assert.Equal("system", start.ActorId);
        Assert.Equal("alice", start.ActivePlayerId);
        Assert.Equal("gauss", start.Players[0].StreetId);
        Assert.False(start.Players[0].FreeMoveUsed);
        Assert.Equal("einstein", start.Players[1].StreetId);

        Assert.True(match.TryFreeMove("alice", "planck", 0).Accepted);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryFreeMove("bob", "newton", 2).Accepted);
        Assert.True(match.TryEndTurn("bob", 3).Accepted);
        var verified = match.VerifyPublicAudit();

        Assert.True(verified.IsValid, verified.Code);
        Assert.Equal(5, verified.Frames.Count);
        Assert.Equal(new long[] { 0, 1, 2, 3, 4 },
            verified.Frames.Select(frame => frame.Revision).ToArray());
        Assert.Equal(new[] { "match-created", "free-move", "turn-ended",
                "free-move", "round-settlement-pending" },
            verified.Frames.Select(frame => frame.Kind).ToArray());
        Assert.Equal(new[] { "alice", "alice", "bob", "bob", null },
            verified.Frames.Select(frame => frame.ActivePlayerId).ToArray());
        Assert.Equal("gauss", verified.Frames[0].Players[0].StreetId);
        Assert.Equal("planck", verified.Frames[1].Players[0].StreetId);
        Assert.Equal("planck", verified.Frames[4].Players[0].StreetId);
        Assert.Equal("einstein", verified.Frames[0].Players[1].StreetId);
        Assert.Equal("einstein", verified.Frames[2].Players[1].StreetId);
        Assert.Equal("newton", verified.Frames[3].Players[1].StreetId);
        Assert.False(verified.Frames[0].Players[0].FreeMoveUsed);
        Assert.True(verified.Frames[1].Players[0].FreeMoveUsed);
        Assert.False(verified.Frames[2].Players[1].FreeMoveUsed);
        Assert.True(verified.Frames[3].Players[1].FreeMoveUsed);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, verified.Frames[4].Phase);
        Assert.Null(verified.Frames[4].ActivePlayerId);
        Assert.Equal(verified.Players, verified.Frames[^1].Players);
        Assert.Equal(match.Revision + 1, verified.Frames.Count);
    }

    [Fact]
    public void EightSeatHistoryFollowsCanonicalTurnsAndNeverInventsExtraEvents()
    {
        var board = BoardCatalog.LoadDefault();
        var participants = board.Slots.Take(8)
            .Select((slot, index) => new MatchParticipantSeed($"p{index}", slot.Id)).ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, participants);
        Assert.Equal(8, match.VerifyPublicAudit().Frames[0].Players.Count);
        for (var turn = 0; turn < 8; turn++)
        {
            var actor = match.ActivePlayerId!;
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
            var audit = match.VerifyPublicAudit();
            Assert.True(audit.IsValid, audit.Code);
            Assert.Equal(turn + 2, audit.Frames.Count);
            Assert.Equal(match.Revision, audit.Frames[^1].Revision);
            Assert.Equal(8, audit.Frames[^1].Players.Count);
            Assert.Equal(turn == 7 ? null : $"p{turn + 1}",
                audit.Frames[^1].ActivePlayerId);
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement,
            match.VerifyPublicAudit().Frames[^1].Phase);
    }

    [Fact]
    public void FailedVerificationNeverReturnsPartialHistoryToClients()
    {
        var match = Complete();
        var wrong = ReplaceEvent(match, 3, e => e with { ActorId = "alice" });
        var invalid = MatchAuditReplay.Verify(BoardCatalog.LoadDefault(), wrong);
        Assert.False(invalid.IsValid);
        Assert.Empty(invalid.Frames);
        var alteredPosition = match with
        {
            Players = Array.AsReadOnly(match.Players.Select((p, i) =>
                i == 0 ? p with { StreetId = "not-a-street" } : p).ToArray())
        };
        var tampered = MatchAuditReplay.Verify(BoardCatalog.LoadDefault(), alteredPosition);
        Assert.False(tampered.IsValid);
        Assert.Empty(tampered.Frames);
    }

    [Fact]
    public void FullDeckReplayContainsNoActionHandsTokensOrDrawPile()
    {
        var match = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var audit = match.VerifyPublicAudit();
        Assert.True(audit.IsValid, audit.Code);
        var json = JsonSerializer.Serialize(audit);
        Assert.DoesNotContain("test:action:", json);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, json);
        Assert.DoesNotContain("CardIds", json);
        Assert.DoesNotContain("Token", json);
        Assert.DoesNotContain("DrawPile", json);
    }
}
