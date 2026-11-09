using System.Collections.Concurrent;
using System.Security.Cryptography;
using Edonism.Domain.Matches;
using Edonism.Domain.World;
using Edonism.Infrastructure.World;

namespace Edonism.Api.Development;

/// <summary>Ephemeral, single-process fixture for local API integration. Never register public match routes.</summary>
public sealed record DevSeatCredential(string PlayerId, string Token);
public sealed record DevMatchCreated(Guid MatchId, MatchSnapshot State, IReadOnlyList<DevSeatCredential> Credentials);

public sealed class DevelopmentMatchStore
{
    private readonly DevelopmentMatchCheckpointFiles? _checkpointFiles;

    public DevelopmentMatchStore(DevelopmentMatchCheckpointFiles? checkpointFiles = null)
    {
        _checkpointFiles = checkpointFiles;
    }

    private sealed class Entry
    {
        public Entry(GameMatch match, Dictionary<string, byte[]> tokenDigests)
        {
            Match = match;
            TokenDigests = tokenDigests;
        }

        public readonly object Gate = new();
        public GameMatch Match { get; set; }
        public Dictionary<string, byte[]> TokenDigests { get; }

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
        var secrets = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var credentials = new List<DevSeatCredential>();
        foreach (var player in match.Snapshot().Players)
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            secrets.Add(player.PlayerId, SHA256.HashData(bytes));
            credentials.Add(new DevSeatCredential(player.PlayerId, Convert.ToHexString(bytes)));
        }

        // Save BEFORE publishing the created match. Failed disk writes cannot
        // create a partially visible in-memory session.
        _checkpointFiles?.Save(match.CaptureCheckpoint(), secrets);
        if (!_matches.TryAdd(match.MatchId, new Entry(match, secrets)))
            throw new InvalidOperationException("Unexpected match ID collision.");

        return new DevMatchCreated(match.MatchId, match.Snapshot(), credentials.AsReadOnly());
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
            foreach (var (id, hex) in data.TokenDigests)
            {
                if (hex.Length != 64) return false;
                var digest = Convert.FromHexString(hex);
                if (digest.Length != 32) return false;
                hashes.Add(id, digest);
            }
            entry = _matches.GetOrAdd(matchId, _ => new Entry(match, hashes));
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
            _checkpointFiles?.Save(entry.Match.CaptureCheckpoint(), nextDigests);
            entry.TokenDigests[actor] = digest;
            replacement = new DevSeatCredential(actor, newToken);
            return true;
        }
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

    public bool TryFreeMove(
        Guid matchId, string? token, string destinationStreetId, long expectedRevision,
        out MatchCommandResult? outcome) =>
        TryExecute(matchId, token,
            (match, actor) => match.TryFreeMove(actor, destinationStreetId, expectedRevision),
            out outcome);

    public bool TryEndTurn(
        Guid matchId, string? token, long expectedRevision, out MatchCommandResult? outcome) =>
        TryExecute(matchId, token,
            (match, actor) => match.TryEndTurn(actor, expectedRevision),
            out outcome);

    private bool TryExecute(
        Guid matchId,
        string? token,
        Func<GameMatch, string, MatchCommandResult> action,
        out MatchCommandResult? outcome)
    {
        outcome = null;
        if (!TryGetEntry(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            // A durable command is copy-on-write: persist the new checkpoint
            // BEFORE publishing the mutated match. Failed saves are not visible.
            var target = _checkpointFiles is null
                ? entry.Match
                : GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(),
                    entry.Match.CaptureCheckpoint());
            outcome = action(target, actorId);
            if (outcome.Accepted && _checkpointFiles is not null)
            {
                _checkpointFiles.Save(target.CaptureCheckpoint(), entry.TokenDigests);
                entry.Match = target;
            }
            return true;
        }
    }
}
