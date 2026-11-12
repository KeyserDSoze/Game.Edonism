using System.Collections.Concurrent;
using System.Security.Cryptography;
using Edonism.Domain.Matches;
using Edonism.Domain.World;
using Edonism.Infrastructure.World;

namespace Edonism.Api.Development;

/// <summary>Ephemeral, single-process fixture for local API integration. Never register public match routes.</summary>
public sealed record DevSeatCredential(string PlayerId, string Token);
public sealed record DevMatchCreated(Guid MatchId, MatchSnapshot State, IReadOnlyList<DevSeatCredential> Credentials);

/// <summary>
/// A single authenticated Development read under one match lock. The only
/// private projection is the bearer holder's hand. Never persist or expose
/// this DTO as a public, multi-seat or Production match snapshot.
/// </summary>
public sealed record DevSeatBootstrap(
    Guid MatchId, string PlayerId, MatchSnapshot State,
    MatchPrivateHandSnapshot Hand, MatchTurnOptions TurnOptions);

/// <summary>
/// An actor-authenticated conditional read. Saturation is never an
/// authorization grant or a match snapshot; retry after bounded backoff.
/// </summary>
public sealed record DevRevisionWaitResult(
    bool Found, MatchSnapshot? State, bool Saturated = false);

/// <summary>
/// Only movement/turn data reconstructed and fully validated by the Domain
/// verifier; no hands, deck, setup secrets, capability tokens or money.
/// </summary>
public sealed record DevPublicHistory(
    Guid MatchId, long VerifiedRevision, IReadOnlyList<MatchReplayFrame> Frames);

/// <summary>
/// A non-authoritative, short-lived Development hint that an authenticated
/// browser recently signaled a seat. Never serialize timestamps or tokens.
/// </summary>
public sealed record DevSeatPresence(string PlayerId, bool IsActive);
public sealed record DevMatchPresence(Guid MatchId, IReadOnlyList<DevSeatPresence> Seats);

/// <summary>Only new Development fixtures are exhausted; existing sessions stay usable.</summary>
public sealed class DevelopmentMatchCapacityException : Exception
{
    public DevelopmentMatchCapacityException()
        : base("Development fixture creation capacity has been reached.") { }
}

public sealed class DevelopmentMatchStore
{
    // A second, process-lifetime boundary beyond the 64 attempts/minute gate (#46).
    // Do not count historical encrypted checkpoint reloads: rejecting a reload
    // would revoke legitimate seats. This is NOT a disk retention policy.
    public const int MaxNewMatchesPerProcess = 64;
    private const int MaxRetainedReceipts = 64;
    // Development single-process fairness: allow several tabs per player,
    // but never let one bearer monopolize a multi-seat match.
    public const int MaxPendingWaitsPerActor = 4;
    public const int MaxPendingWaitsPerMatch = 32;
    public static readonly TimeSpan PresenceTtl = TimeSpan.FromSeconds(15);

    private sealed record RevisionWaiter(
        string ActorId, TaskCompletionSource<bool> Signal);
    private readonly DevelopmentMatchCheckpointFiles? _checkpointFiles;
    private readonly TimeProvider _clock;
    private readonly object _creationGate = new();
    private readonly int _maxNewMatches;
    private int _newMatches;

    public DevelopmentMatchStore(
        DevelopmentMatchCheckpointFiles? checkpointFiles = null,
        TimeProvider? timeProvider = null,
        int maxNewMatches = MaxNewMatchesPerProcess)
    {
        if (maxNewMatches is < 1 or > MaxNewMatchesPerProcess)
            throw new ArgumentOutOfRangeException(nameof(maxNewMatches));
        _checkpointFiles = checkpointFiles;
        _clock = timeProvider ?? TimeProvider.System;
        _maxNewMatches = maxNewMatches;
    }

    private sealed class Entry
    {
        public Entry(GameMatch match, Dictionary<string, byte[]> tokenDigests,
            IReadOnlyList<DevCommandReceipt>? receipts = null)
        {
            Match = match;
            TokenDigests = tokenDigests;
            CommandReceipts = receipts?.ToList() ?? [];
        }

        public readonly object Gate = new();
        public GameMatch Match { get; set; }
        public Dictionary<string, byte[]> TokenDigests { get; }
        public List<DevCommandReceipt> CommandReceipts { get; }

        // Up to one time value for each actor, never one per tab or token.
        // Not checkpointed: a process restart means nobody recently pinged.
        public Dictionary<string, DateTimeOffset> LastPresenceByActor { get; } =
            new(StringComparer.Ordinal);

        // A bounded list of in-flight conditional HTTP reads. On every state
        // change, signal all waiters asynchronously; on timeout or cancellation,
        // each waiter removes itself. No retained idle-match continuations.
        public readonly List<RevisionWaiter> RevisionWaiters = [];

        public void NotifySubscribers()
        {
            foreach (var waiter in RevisionWaiters)
                waiter.Signal.TrySetResult(true);
            RevisionWaiters.Clear();
        }

        public string? ResolveActor(string? token)
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length != 64) return null;
            byte[] supplied;
            try { supplied = Convert.FromHexString(token); }
            catch (FormatException) { return null; }

            var suppliedDigest = SHA256.HashData(supplied);
            foreach (var (playerId, candidate) in TokenDigests)
            {
                if (CryptographicOperations.FixedTimeEquals(candidate, suppliedDigest)) return playerId;
            }

            return null;
        }
    }

    private readonly ConcurrentDictionary<Guid, Entry> _matches = new();

    /// <summary>
    /// Development-only: the creator receives ALL seat credentials. Real multiplayer
    /// authentication and durable storage are separate and tracked in issue #13.
    /// </summary>
    public DevMatchCreated Create(IReadOnlyList<MatchParticipantSeed> participants) =>
        Register(GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), BoardCatalog.LoadDefault(), participants));

    public DevMatchCreated CreateWithCards(
        IReadOnlyList<MatchParticipantCardSeed> participants,
        IReadOnlyCollection<ActivityCardId> catalog,
        int seed) =>
        Register(GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), participants, catalog, seed));

    public DevMatchCreated CreateWithCharacters(
        IReadOnlyList<string> playerIds,
        IReadOnlyCollection<CharacterCardDefinition> characters,
        IReadOnlyCollection<ActivityCardId> activities,
        int seed) =>
        Register(GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            playerIds, characters, activities, seed));

    public DevMatchCreated CreateWithFullDeck(
        IReadOnlyList<string> playerIds,
        IReadOnlyCollection<CharacterCardDefinition> characters,
        IReadOnlyCollection<ActivityCardId> activities,
        IReadOnlyCollection<string> actionCardIds,
        string electionDayCardId,
        int seed) =>
        Register(GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), playerIds,
            characters, activities, actionCardIds, electionDayCardId, seed));

    private DevMatchCreated Register(GameMatch match)
    {
        // Serialize only creation admission, independent of per-match command
        // locks. Validation happened before this point; failures do not take a
        // fixture slot. Do not evict any match that has already issued tokens.
        lock (_creationGate)
        {
            if (_newMatches >= _maxNewMatches)
                throw new DevelopmentMatchCapacityException();

            var secrets = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            var credentials = new List<DevSeatCredential>();
            foreach (var player in match.Snapshot().Players)
            {
                // Every seat needs its OWN cryptographic capability. Rotation
                // already retries digest collisions; initial admission must
                // maintain the same invariant instead of relying solely on
                // their overwhelming statistical improbability.
                byte[] digest;
                string newToken;
                do
                {
                    var bytes = RandomNumberGenerator.GetBytes(32);
                    digest = SHA256.HashData(bytes);
                    newToken = Convert.ToHexString(bytes);
                    CryptographicOperations.ZeroMemory(bytes);
                }
                while (secrets.Values.Any(existing =>
                    CryptographicOperations.FixedTimeEquals(existing, digest)));

                secrets.Add(player.PlayerId, digest);
                credentials.Add(new DevSeatCredential(player.PlayerId, newToken));
            }

            // Disk commit precedes in-memory publication and quota increment.
            // A failed encrypted save must not consume a slot or issue tokens.
            _checkpointFiles?.Save(match.CaptureCheckpoint(), secrets);
            if (!_matches.TryAdd(match.MatchId, new Entry(match, secrets)))
                throw new InvalidOperationException("Unexpected match ID collision.");
            _newMatches++;
            return new DevMatchCreated(match.MatchId, match.Snapshot(), credentials.AsReadOnly());
        }
    }

    private bool TryGetEntry(Guid matchId, out Entry entry)
    {
        if (_matches.TryGetValue(matchId, out entry!)) return true;
        if (_checkpointFiles is null) return false;

        // Lazy reload means restart works without retaining any bearer token in
        // process memory. Corruption/wrong key fail closed as not found.
        PersistedDevelopmentMatch? data;
        try { data = _checkpointFiles.Load(matchId); }
        catch (Exception ex) when (ex is InvalidDataException or IOException
            or UnauthorizedAccessException or ArgumentException)
        {
            return false;
        }
        if (data is null) return false;

        try
        {
            var match = GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(), data.Checkpoint);
            var playerIds = match.Snapshot().Players.Select(p => p.PlayerId)
                .ToHashSet(StringComparer.Ordinal);
            if (data.TokenDigests.Count != playerIds.Count
                || data.TokenDigests.Keys.Any(id => !playerIds.Contains(id)))
                return false;
            var hashes = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            var uniqueDigests = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (id, hex) in data.TokenDigests)
            {
                if (hex is null || hex.Length != 64) return false;
                var digest = Convert.FromHexString(hex);
                // Decoding before deduplication prevents a lowercase/uppercase
                // hex alias from assigning the SAME bearer to two seats.
                // ResolveActor would otherwise return the first actor, which
                // can reveal the wrong seat's private hand on restart.
                if (digest.Length != 32
                    || !uniqueDigests.Add(Convert.ToHexString(digest)))
                    return false;
                hashes.Add(id, digest);
            }
            // The encrypted v2 metadata is a trust boundary. Every receipt
            // must point to a real committed public event, for the same actor
            // and command, and duplicate client keys for one actor are invalid.
            var receipts = data.CommandReceipts?.ToArray() ?? [];
            var events = data.Checkpoint.State.Events;
            if (receipts.Length > MaxRetainedReceipts
                || receipts.Any(r => r is null
                    || !playerIds.Contains(r.ActorId)
                    || !Guid.TryParseExact(r.Key, "D", out var parsed) || parsed == Guid.Empty
                    || r.Key != parsed.ToString("D")
                    || r.ExpectedRevision < 0 || r.AcceptedRevision != r.ExpectedRevision + 1
                    || r.AcceptedRevision > match.Revision
                    || (r.Kind != "free-move" && r.Kind != "end-turn")
                    || (r.Kind == "free-move" && string.IsNullOrWhiteSpace(r.DestinationStreetId))
                    || (r.Kind == "end-turn" && r.DestinationStreetId is not null)
                    || !events.Any(e => e.Revision == r.AcceptedRevision
                        && e.ActorId == r.ActorId && (
                            r.Kind == "free-move"
                                ? e.Kind == "free-move" && e.ToStreetId == r.DestinationStreetId
                                : e.Kind is "turn-ended" or "round-settlement-pending")))
                || receipts.Select(r => (r.ActorId, r.Key)).Distinct().Count() != receipts.Length
                // The store appends at most ONE receipt per successfully
                // committed revision. Omitted receipts are legal (no UUID,
                // capped retention), but two UUIDs for the same event or a
                // reordered receipt list can never be emitted by TryExecute.
                // Reject an ambiguous restart before any seat is published.
                || receipts.Zip(receipts.Skip(1), (previous, current) =>
                    previous.AcceptedRevision >= current.AcceptedRevision).Any(invalid => invalid))
                return false;

            entry = _matches.GetOrAdd(matchId, _ => new Entry(match, hashes, receipts));
            return true;
        }
        catch (Exception ex) when (ex is InvalidDataException or ArgumentException
            or InvalidOperationException or FormatException)
        {
            return false;
        }
    }


    /// <summary>
    /// Replace only the authenticated actor's Development capability.
    /// The disk checkpoint is committed before the old digest is revoked.
    /// This is NOT an identity/session provider for Production.
    /// </summary>
    public bool TryRotateSeatToken(
        Guid matchId, string? token, out DevSeatCredential? replacement)
    {
        replacement = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actor = entry.ResolveActor(token);
            if (actor is null) return false;

            byte[] secret;
            byte[] digest;
            do
            {
                secret = RandomNumberGenerator.GetBytes(32);
                digest = SHA256.HashData(secret);
            }
            while (entry.TokenDigests.Values.Any(candidate =>
                CryptographicOperations.FixedTimeEquals(candidate, digest)));

            var newToken = Convert.ToHexString(secret);
            CryptographicOperations.ZeroMemory(secret);
            var nextDigests = new Dictionary<string, byte[]>(entry.TokenDigests,
                StringComparer.Ordinal)
            {
                [actor] = digest
            };
            // Never change the live actor digest on failed encryption or I/O.
            _checkpointFiles?.Save(entry.Match.CaptureCheckpoint(), nextDigests,
                entry.CommandReceipts);
            entry.TokenDigests[actor] = digest;
            // Rotation is a capability change, not a gameplay event.
            // The seat is inactive until the new bearer pings again; other
            // seats retain their independent presence.
            entry.LastPresenceByActor.Remove(actor);
            // A revocation changes no public revision, but old subscribers
            // must wake and reauthenticate instead of waiting for gameplay.
            entry.NotifySubscribers();
            replacement = new DevSeatCredential(actor, newToken);
            return true;
        }
    }

    /// <summary>
    /// Fast authorization-only gate used before ASP.NET Core Minimal API
    /// deserializes a command body. The command store authenticates AGAIN
    /// under this same lock when it applies an action, so rotation cannot
    /// race past the final authorization check. No snapshot, hand, presence
    /// or gameplay event is created by this preflight.
    /// </summary>
    public bool HasSeatAccess(Guid matchId, string? token)
    {
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
            return entry.ResolveActor(token) is not null;
    }

    public bool TryRead(Guid matchId, string? token, out MatchSnapshot? snapshot)
    {
        snapshot = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            snapshot = entry.Match.Snapshot();
            return true;
        }
    }

    /// <summary>
    /// Await a later public revision without holding the match lock. Waiters
    /// are registered atomically with the initial revision check, so neither
    /// moves nor rotations can be missed between the check and subscription.
    /// Each wake/timeout revalidates the bearer before returning even 304.
    /// </summary>
    public async Task<DevRevisionWaitResult> WaitForRevisionAsync(
        Guid matchId, string? token, long knownRevision, TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetEntry(matchId, out var entry)) return new(false, null);
        var signal = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        RevisionWaiter? subscription = null;
        lock (entry.Gate)
        {
            // Always authorize BEFORE capacity checks: a forged/revoked token
            // must not enumerate the number of subscribers or get an ETag.
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return new(false, null);
            var snapshot = entry.Match.Snapshot();
            if (snapshot.Revision != knownRevision) return new(true, snapshot);
            if (entry.RevisionWaiters.Count >= MaxPendingWaitsPerMatch
                || entry.RevisionWaiters.Count(x => x.ActorId == actorId)
                    >= MaxPendingWaitsPerActor)
                return new(true, null, Saturated: true);

            subscription = new RevisionWaiter(actorId, signal);
            entry.RevisionWaiters.Add(subscription);
        }

        try
        {
            try
            {
                // No match lock held while waiting and no busy loop.
                await signal.Task.WaitAsync(timeout, cancellationToken);
            }
            catch (TimeoutException)
            {
                // No change: return the current revision for HTTP 304.
            }
        }
        finally
        {
            lock (entry.Gate)
                entry.RevisionWaiters.Remove(subscription!);
        }

        cancellationToken.ThrowIfCancellationRequested();
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return new(false, null);
            return new(true, entry.Match.Snapshot());
        }
    }

    /// <summary>
    /// Atomic, actor-bound read for a browser joining a Development match.
    /// Revocation, commands and checkpoint replacement share the same lock.
    /// The public snapshot, private hand and legal options are one instant,
    /// not independent HTTP reads that could straddle a revision change.
    /// </summary>
    public bool TryBootstrapSeat(Guid matchId, string? token, out DevSeatBootstrap? bootstrap)
    {
        bootstrap = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            var hand = entry.Match.PrivateHandForActor(actorId);
            var options = entry.Match.TurnOptionsForActor(actorId);
            if (hand is null || options is null) return false;
            var state = entry.Match.Snapshot();
            if (options.Revision != state.Revision
                || options.MatchId != matchId || hand.MatchId != matchId
                || hand.PlayerId != actorId || options.PlayerId != actorId)
                throw new InvalidOperationException("Development seat projections diverged.");
            bootstrap = new DevSeatBootstrap(matchId, actorId, state, hand, options);
            return true;
        }
    }

    /// <summary>
    /// Current seat's read-only street graph routes to public unowned cards.
    /// Authorization and the Domain-verified projection share the match lock.
    /// </summary>
    public bool TryReadUncontrolledRoutes(Guid matchId, string? token,
        out MatchUncontrolledRoutes? routes)
    {
        routes = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            routes = entry.Match.VerifiedUncontrolledRoutesForActor(actorId);
            return routes is not null;
        }
    }

    /// <summary>
    /// Server-audited public proximity to the other seats. Resolve the
    /// requesting player from the bearer under the same match mutation lock;
    /// never read hands, factions or expose a token in the projection.
    /// </summary>
    public bool TryReadOtherPlayerRoutes(Guid matchId, string? token,
        out MatchOtherPlayerRoutes? routes)
    {
        routes = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actor = entry.ResolveActor(token);
            if (actor is null) return false;
            routes = entry.Match.VerifiedOtherPlayerRoutesForActor(actor);
            return routes is not null;
        }
    }

    /// <summary>
    /// Server-verified, read-only public first-round turn progression. A
    /// forged/revoked token must never learn who already ended a turn.
    /// </summary>
    public bool TryReadFirstRoundTurnProgress(Guid matchId, string? token,
        out MatchFirstRoundTurnProgress? progress)
    {
        progress = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            progress = entry.Match.VerifiedFirstRoundTurnProgress();
            return true;
        }
    }

    /// <summary>
    /// The bearer is checked under the match lock BEFORE reporting whether
    /// settlement is pending; no private hand, token or deck in the preview.
    /// Returning true with null means authenticated but not yet pending.
    /// </summary>
    public bool TryReadPendingSettlementPreview(Guid matchId, string? token,
        out MatchPendingSettlementPreview? preview)
    {
        preview = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            preview = entry.Match.PendingSettlementPreview();
            return true;
        }
    }

    /// <summary>Read-only actor-scoped commands, under the same lock as mutations.</summary>
    public bool TryReadTurnOptions(
        Guid matchId, string? token, out MatchTurnOptions? options)
    {
        options = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            options = entry.Match.TurnOptionsForActor(actorId);
            return options is not null;
        }
    }

    /// <summary>Authenticated, read-only Development audit check; no private cards.</summary>
    public bool TryReadAudit(
        Guid matchId, string? token, out MatchAuditReplayResult? verification)
    {
        verification = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            verification = entry.Match.VerifyPublicAudit();
            return true;
        }
    }

    /// <summary>
    /// A bearer-authorized history from the same locked, canonical Domain
    /// audit replay. Reject verification failure without partial frames.
    /// </summary>
    public bool TryReadHistory(
        Guid matchId, string? token, out DevPublicHistory? history)
    {
        history = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            var verification = entry.Match.VerifyPublicAudit();
            if (!verification.IsValid || verification.Frames.Count == 0
                || verification.Frames.Count != entry.Match.Revision + 1)
                return false;
            history = new DevPublicHistory(
                matchId, verification.VerifiedRevision, verification.Frames);
            return true;
        }
    }

    /// <summary>
    /// Development-only presence. GET must not manufacture an online signal;
    /// POST changes exactly the bearer-derived actor. Neither operation
    /// touches canonical match state, audit, encryption files or revision
    /// notifications. All observations are made under the match lock.
    /// </summary>
    public bool TryReadPresence(
        Guid matchId, string? token, out DevMatchPresence? presence) =>
        TryPresence(matchId, token, heartbeat: false, out presence);

    public bool TryHeartbeat(
        Guid matchId, string? token, out DevMatchPresence? presence) =>
        TryPresence(matchId, token, heartbeat: true, out presence);

    private bool TryPresence(
        Guid matchId, string? token, bool heartbeat, out DevMatchPresence? presence)
    {
        presence = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actor = entry.ResolveActor(token);
            if (actor is null) return false;

            var now = _clock.GetUtcNow();
            if (heartbeat) entry.LastPresenceByActor[actor] = now;
            // Compute the current status for every canonical seat. The public
            // response excludes lastSeen, bearer and any private player state.
            var seats = entry.Match.Snapshot().Players.Select(player =>
            {
                var active = entry.LastPresenceByActor.TryGetValue(
                    player.PlayerId, out var last)
                    && now >= last && now - last < PresenceTtl;
                return new DevSeatPresence(player.PlayerId, active);
            }).ToArray();
            presence = new DevMatchPresence(matchId, Array.AsReadOnly(seats));
            return true;
        }
    }

    public bool TryReadHand(
        Guid matchId, string? token, out MatchPrivateHandSnapshot? hand)
    {
        hand = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            hand = entry.Match.PrivateHandForActor(actorId);
            return hand is not null;
        }
    }

    /// <summary>
    /// Optional per-actor UUID makes an accepted command safe to retry after
    /// a lost HTTP response. Replays are identified before Domain execution;
    /// the receipt is persisted with the new match checkpoint atomically.
    /// </summary>
    public bool TryFreeMove(
        Guid matchId, string? token, string destinationStreetId, long expectedRevision,
        out MatchCommandResult? outcome, string? idempotencyKey = null) =>
        TryExecute(matchId, token, "free-move", destinationStreetId, expectedRevision,
            (match, actor) => match.TryFreeMove(actor, destinationStreetId, expectedRevision),
            out outcome, idempotencyKey);

    public bool TryEndTurn(
        Guid matchId, string? token, long expectedRevision,
        out MatchCommandResult? outcome, string? idempotencyKey = null) =>
        TryExecute(matchId, token, "end-turn", null, expectedRevision,
            (match, actor) => match.TryEndTurn(actor, expectedRevision),
            out outcome, idempotencyKey);

    private bool TryExecute(
        Guid matchId,
        string? token,
        string kind,
        string? destinationStreetId,
        long expectedRevision,
        Func<GameMatch, string, MatchCommandResult> action,
        out MatchCommandResult? outcome,
        string? idempotencyKey)
    {
        outcome = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;

            string? normalizedKey = null;
            if (idempotencyKey is not null)
            {
                if (!Guid.TryParseExact(idempotencyKey, "D", out var parsed)
                    || parsed == Guid.Empty)
                {
                    outcome = new MatchCommandResult(
                        false, "invalid_idempotency_key", entry.Match.Snapshot());
                    return true;
                }
                normalizedKey = parsed.ToString("D");
                var previous = entry.CommandReceipts.FindLast(r =>
                    r.ActorId == actorId && r.Key == normalizedKey);
                if (previous is not null)
                {
                    var identical = previous.Kind == kind
                        && previous.DestinationStreetId == destinationStreetId
                        && previous.ExpectedRevision == expectedRevision;
                    outcome = new MatchCommandResult(identical,
                        identical ? "idempotent_replay" : "idempotency_key_reused",
                        entry.Match.Snapshot());
                    return true;
                }
            }

            // A durable command is copy-on-write. Persist the new checkpoint
            // AND the accepted receipt before publishing either. If encryption
            // or disk fails, neither the mutation nor receipt becomes visible.
            var target = _checkpointFiles is null
                ? entry.Match
                : GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(),
                    entry.Match.CaptureCheckpoint());
            outcome = action(target, actorId);
            if (outcome.Accepted)
            {
                var next = entry.CommandReceipts.ToList();
                if (normalizedKey is not null)
                {
                    next.Add(new DevCommandReceipt(
                        actorId, normalizedKey, kind, destinationStreetId,
                        expectedRevision, outcome.State.Revision));
                    if (next.Count > MaxRetainedReceipts) next.RemoveAt(0);
                }

                if (_checkpointFiles is not null)
                {
                    _checkpointFiles.Save(target.CaptureCheckpoint(), entry.TokenDigests, next);
                    entry.Match = target;
                }
                if (normalizedKey is not null)
                {
                    entry.CommandReceipts.Clear();
                    entry.CommandReceipts.AddRange(next);
                }
                // An idempotent replay never advances state or wakes long polls.
                entry.NotifySubscribers();
            }
            return true;
        }
    }
}
