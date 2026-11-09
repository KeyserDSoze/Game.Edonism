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
    private sealed class Entry(GameMatch match, Dictionary<string, byte[]> secrets)
    {
        public readonly object Gate = new();
        public GameMatch Match { get; } = match;

        public string? ResolveActor(string? token)
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length != 64) return null;
            byte[] supplied;
            try { supplied = Convert.FromHexString(token); }
            catch (FormatException) { return null; }

            foreach (var (playerId, candidate) in secrets)
            {
                if (CryptographicOperations.FixedTimeEquals(candidate, supplied)) return playerId;
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

    private DevMatchCreated Register(GameMatch match)
    {
        var secrets = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var credentials = new List<DevSeatCredential>();
        foreach (var player in match.Snapshot().Players)
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            secrets.Add(player.PlayerId, bytes);
            credentials.Add(new DevSeatCredential(player.PlayerId, Convert.ToHexString(bytes)));
        }

        if (!_matches.TryAdd(match.MatchId, new Entry(match, secrets)))
            throw new InvalidOperationException("Unexpected match ID collision.");

        return new DevMatchCreated(match.MatchId, match.Snapshot(), credentials.AsReadOnly());
    }

    public bool TryRead(Guid matchId, string? token, out MatchSnapshot? snapshot)
    {
        snapshot = null;
        if (!_matches.TryGetValue(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            if (entry.ResolveActor(token) is null) return false;
            snapshot = entry.Match.Snapshot();
            return true;
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
        if (!_matches.TryGetValue(matchId, out var entry)) return false;
        lock (entry.Gate)
        {
            var actorId = entry.ResolveActor(token);
            if (actorId is null) return false;
            // The lock protects revision check + state mutation atomically.
            outcome = action(entry.Match, actorId);
            return true;
        }
    }
}
