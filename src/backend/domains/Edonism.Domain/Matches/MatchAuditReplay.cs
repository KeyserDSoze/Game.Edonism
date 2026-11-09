using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>Only the first-round public movement/turn state can be replayed at present.</summary>
public sealed record ReplayedMatchPlayer(string PlayerId, string StreetId, bool FreeMoveUsed);

/// <summary>Verification of the CURRENT public command subset; not a persisted match restore.</summary>
public sealed record MatchAuditReplayResult(
    bool IsValid,
    string Code,
    long VerifiedRevision,
    MatchPhase Phase,
    string? ActivePlayerId,
    IReadOnlyList<ReplayedMatchPlayer> Players);

/// <summary>
/// Reconstructs the first round's movement/turn projection from genesis and public
/// audit events, independently of GameMatch command handlers. The canonical street
/// graph decides adjacency, never the client-side 3D coordinates.
/// This deliberately rejects future event kinds until explicitly versioned.
/// </summary>
public static class MatchAuditReplay
{
    public static MatchAuditReplayResult Verify(BoardDefinition board, MatchSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(snapshot);
        board.Validate();

        static MatchAuditReplayResult Fail(string code, long revision) =>
            new(false, code, revision, MatchPhase.PlayerTurns, null,
                Array.Empty<ReplayedMatchPlayer>());

        if (snapshot.MatchId == Guid.Empty || snapshot.BoardVersion != board.Version
            || snapshot.Round != 1 || snapshot.Players is null
            || snapshot.TurnOrder is null || snapshot.ProposedNextRoundOrder is null
            || snapshot.Events is null || snapshot.Players.Count is < 2 or > 8
            || snapshot.TurnOrder.Count != snapshot.Players.Count)
            return Fail("invalid_audit_setup", 0);

        var slotMap = board.Slots.ToDictionary(s => s.Id, StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var startingSlots = new HashSet<string>(StringComparer.Ordinal);
        var positions = new Dictionary<string, string>(StringComparer.Ordinal);
        var moved = new Dictionary<string, bool>(StringComparer.Ordinal);
        for (var i = 0; i < snapshot.Players.Count; i++)
        {
            var player = snapshot.Players[i];
            if (player is null || string.IsNullOrWhiteSpace(player.PlayerId)
                || string.IsNullOrWhiteSpace(player.StartingSlotId)
                || snapshot.TurnOrder[i] != player.PlayerId
                || !ids.Add(player.PlayerId) || !startingSlots.Add(player.StartingSlotId)
                || !slotMap.TryGetValue(player.StartingSlotId, out var slot))
                return Fail("invalid_audit_setup", 0);

            positions.Add(player.PlayerId, slot.StreetId);
            moved.Add(player.PlayerId, false);
        }

        if (!snapshot.ProposedNextRoundOrder.SequenceEqual(
                GameMatch.RotateLastToFirst(snapshot.TurnOrder), StringComparer.Ordinal))
            return Fail("invalid_proposed_order", 0);

        if (snapshot.Events.Count == 0 || snapshot.Events[0] is not
            { Revision: 0, Round: 1, Kind: "match-created", ActorId: "system",
              FromStreetId: null, ToStreetId: null })
            return Fail("invalid_genesis_event", 0);

        var revision = 0L;
        var turnIndex = 0;
        var phase = MatchPhase.PlayerTurns;
        for (var i = 1; i < snapshot.Events.Count; i++)
        {
            var entry = snapshot.Events[i];
            if (entry is null || entry.Revision != revision + 1 || entry.Round != 1)
                return Fail("invalid_event_revision", revision);

            if (phase != MatchPhase.PlayerTurns)
                return Fail("events_after_settlement", revision);

            var expectedActor = snapshot.TurnOrder[turnIndex];
            if (entry.ActorId != expectedActor)
                return Fail("event_out_of_turn", revision);

            switch (entry.Kind)
            {
                case "free-move":
                    if (moved[expectedActor])
                        return Fail("repeated_free_move", revision);
                    if (entry.FromStreetId != positions[expectedActor]
                        || string.IsNullOrWhiteSpace(entry.ToStreetId)
                        || !board.CanMoveOneStreet(entry.FromStreetId, entry.ToStreetId))
                        return Fail("invalid_move_event", revision);
                    positions[expectedActor] = entry.ToStreetId;
                    moved[expectedActor] = true;
                    break;

                case "turn-ended":
                    if (entry.FromStreetId is not null || entry.ToStreetId is not null
                        || turnIndex == snapshot.TurnOrder.Count - 1)
                        return Fail("invalid_turn_end_event", revision);
                    turnIndex++;
                    break;

                case "round-settlement-pending":
                    if (entry.FromStreetId is not null || entry.ToStreetId is not null
                        || turnIndex != snapshot.TurnOrder.Count - 1)
                        return Fail("invalid_settlement_event", revision);
                    phase = MatchPhase.AwaitingRoundSettlement;
                    break;

                default:
                    return Fail("unknown_event_kind", revision);
            }
            revision++;
        }

        var active = phase == MatchPhase.PlayerTurns ? snapshot.TurnOrder[turnIndex] : null;
        if (snapshot.Revision != revision || snapshot.ActivePlayerId != active
            || snapshot.Phase != phase)
            return Fail("snapshot_state_mismatch", revision);

        if (snapshot.Players.Any(p =>
                p.StreetId != positions[p.PlayerId] || p.FreeMoveUsed != moved[p.PlayerId]))
            return Fail("snapshot_position_mismatch", revision);

        return new MatchAuditReplayResult(true, "ok", revision, phase, active,
            Array.AsReadOnly(snapshot.TurnOrder
                .Select(id => new ReplayedMatchPlayer(id, positions[id], moved[id]))
                .ToArray()));
    }
}
