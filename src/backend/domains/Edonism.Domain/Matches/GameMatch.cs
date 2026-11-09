using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>
/// Trusted, preconfigured start fixture. The character-to-activity deck setup from
/// rulebook2 p.4 is not implemented yet. Never accept these locations as player claims
/// in a production match.
/// </summary>
public sealed record MatchParticipantSeed(string PlayerId, string StartingSlotId);

public enum MatchPhase
{
    PlayerTurns,
    AwaitingRoundSettlement
}

public sealed record MatchPlayerSnapshot(
    string PlayerId,
    string StartingSlotId,
    string StreetId,
    int Atoms,
    int DiplomacyTokens,
    int HenchmenTotal,
    bool FreeMoveUsed);

public sealed record MatchAuditEvent(
    long Revision,
    int Round,
    string Kind,
    string ActorId,
    string? FromStreetId,
    string? ToStreetId);

public sealed record MatchSnapshot(
    Guid MatchId,
    string BoardVersion,
    long Revision,
    int Round,
    MatchPhase Phase,
    string? ActivePlayerId,
    IReadOnlyList<string> TurnOrder,
    IReadOnlyList<string> ProposedNextRoundOrder,
    IReadOnlyList<MatchPlayerSnapshot> Players,
    IReadOnlyList<MatchAuditEvent> Events);

public sealed record MatchCommandResult(bool Accepted, string Code, MatchSnapshot State);

/// <summary>
/// Authoritative in-process movement/turn aggregate for the original street topology.
/// One free move is permitted per player turn (rulebook2 pp.6-7).
/// Round resolution deliberately pauses before salary, draws, votes and taxes (#6).
/// Calls must be serialized by an application service/store; snapshots are copied.
/// </summary>
public sealed class GameMatch
{
    private const int MaxPrintedPlayers = 8;
    private const int InitialAtoms = 4;
    private const int InitialDiplomacyTokens = 2;
    private const int TotalHenchmen = 16;

    private readonly BoardDefinition _board;
    private readonly List<MatchPlayerSnapshot> _players;
    private readonly List<string> _turnOrder;
    private readonly List<MatchAuditEvent> _events = [];

    private int _turnIndex;

    private GameMatch(Guid matchId, BoardDefinition board, List<MatchPlayerSnapshot> players)
    {
        MatchId = matchId;
        _board = board;
        _players = players;
        _turnOrder = players.Select(p => p.PlayerId).ToList();
        _events.Add(new MatchAuditEvent(0, 1, "match-created", "system", null, null));
    }

    public Guid MatchId { get; }
    public long Revision { get; private set; }
    public int Round { get; } = 1;
    public MatchPhase Phase { get; private set; } = MatchPhase.PlayerTurns;
    public string? ActivePlayerId => Phase == MatchPhase.PlayerTurns ? _turnOrder[_turnIndex] : null;

    public static GameMatch CreateFromTrustedSetup(
        Guid matchId,
        BoardDefinition board,
        IReadOnlyList<MatchParticipantSeed> participants)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(participants);
        board.Validate();

        if (matchId == Guid.Empty)
        {
            throw new ArgumentException("Match ID cannot be empty.", nameof(matchId));
        }

        // Preview fixture bounds; the printed set has eight colored players.
        // The production match's minimum player count still needs design approval.
        if (participants.Count is < 2 or > MaxPrintedPlayers
            || participants.Any(p => p is null || string.IsNullOrWhiteSpace(p.PlayerId)
                || string.IsNullOrWhiteSpace(p.StartingSlotId))
            || participants.Select(p => p.PlayerId).Distinct(StringComparer.Ordinal).Count() != participants.Count
            || participants.Select(p => p.StartingSlotId).Distinct(StringComparer.Ordinal).Count() != participants.Count)
        {
            throw new ArgumentException("A trusted preview requires 2–8 distinct players and starting slots.", nameof(participants));
        }

        var slots = board.Slots.ToDictionary(s => s.Id, StringComparer.Ordinal);
        if (participants.Any(p => !slots.ContainsKey(p.StartingSlotId)))
        {
            throw new ArgumentException("Every starting slot must exist on the printed board.", nameof(participants));
        }

        var players = participants.Select(p => new MatchPlayerSnapshot(
            p.PlayerId,
            p.StartingSlotId,
            slots[p.StartingSlotId].StreetId,
            InitialAtoms,
            InitialDiplomacyTokens,
            TotalHenchmen,
            FreeMoveUsed: false)).ToList();

        return new GameMatch(matchId, board, players);
    }

    public MatchSnapshot Snapshot() => new(
        MatchId,
        _board.Version,
        Revision,
        Round,
        Phase,
        ActivePlayerId,
        Array.AsReadOnly(_turnOrder.ToArray()),
        Array.AsReadOnly(RotateLastToFirst(_turnOrder).ToArray()),
        Array.AsReadOnly(_players.ToArray()),
        Array.AsReadOnly(_events.ToArray()));

    public MatchCommandResult TryFreeMove(string actorId, string destinationStreetId, long expectedRevision)
    {
        var failure = ValidateActorAndTurn(actorId, expectedRevision);
        if (failure is not null) return Reject(failure);

        var playerIndex = _players.FindIndex(p => p.PlayerId == actorId);
        var player = _players[playerIndex];
        if (player.FreeMoveUsed) return Reject("free_move_already_used");
        if (string.IsNullOrWhiteSpace(destinationStreetId)
            || !_board.Streets.Any(s => s.Id == destinationStreetId))
        {
            return Reject("unknown_street");
        }

        if (!_board.CanMoveOneStreet(player.StreetId, destinationStreetId))
        {
            return Reject("not_adjacent");
        }

        var fromStreet = player.StreetId;
        _players[playerIndex] = player with { StreetId = destinationStreetId, FreeMoveUsed = true };
        AppendEvent("free-move", actorId, fromStreet, destinationStreetId);
        return Accept();
    }

    public MatchCommandResult TryEndTurn(string actorId, long expectedRevision)
    {
        var failure = ValidateActorAndTurn(actorId, expectedRevision);
        if (failure is not null) return Reject(failure);

        if (_turnIndex == _turnOrder.Count - 1)
        {
            // No automatic salary, hands, mayor elections, or next round before their
            // rule contracts are implemented in issue #6.
            Phase = MatchPhase.AwaitingRoundSettlement;
            AppendEvent("round-settlement-pending", actorId, null, null);
        }
        else
        {
            _turnIndex++;
            AppendEvent("turn-ended", actorId, null, null);
        }

        return Accept();
    }

    /// <summary>Rulebook2 p.5: last player becomes first, previous first becomes second.</summary>
    public static IReadOnlyList<string> RotateLastToFirst(IReadOnlyList<string> order)
    {
        ArgumentNullException.ThrowIfNull(order);
        if (order.Count == 0) return Array.Empty<string>();
        var rotated = new string[order.Count];
        rotated[0] = order[^1];
        for (var i = 1; i < rotated.Length; i++) rotated[i] = order[i - 1];
        return Array.AsReadOnly(rotated);
    }

    private string? ValidateActorAndTurn(string actorId, long expectedRevision)
    {
        if (expectedRevision != Revision) return "revision_conflict";
        if (Phase != MatchPhase.PlayerTurns) return "round_settlement_pending";
        if (string.IsNullOrWhiteSpace(actorId) || !_players.Any(p => p.PlayerId == actorId))
            return "unknown_player";
        if (ActivePlayerId != actorId) return "not_your_turn";
        return null;
    }

    private void AppendEvent(string kind, string actorId, string? from, string? to)
    {
        Revision++;
        _events.Add(new MatchAuditEvent(Revision, Round, kind, actorId, from, to));
    }

    private MatchCommandResult Accept() => new(true, "ok", Snapshot());
    private MatchCommandResult Reject(string code) => new(false, code, Snapshot());
}
