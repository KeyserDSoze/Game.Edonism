namespace Edonism.Domain.Matches;

/// <summary>
/// Internal server-side hand; never include card IDs in a public MatchSnapshot.
/// It is a starting hand, not a playable action/effect resolver.
/// </summary>
public sealed record InitialActionHand(string PlayerId, IReadOnlyList<string> CardIds);

/// <summary>
/// Full Development-only shuffle result. RemainingDrawPile is secret server data.
/// Election Day is a distinct physical card inside the same shuffled 59-card deck.
/// </summary>
public sealed record InitialActionDeal(
    string AlgorithmVersion,
    int Seed,
    IReadOnlyList<InitialActionHand> Hands,
    IReadOnlyList<string> RemainingDrawPile);

/// <summary>Private actor-scoped read model. Not part of MatchSnapshot.</summary>
public sealed record MatchPrivateHandSnapshot(
    Guid MatchId,
    string PlayerId,
    IReadOnlyList<string> CardIds);

/// <summary>
/// Printed rulebook2 pp.3-4: 58 action cards plus one Election Day card
/// are shuffled together and four are dealt to each participant.
/// Election Day can occur in the initial hand: we do NOT change this
/// distribution to implement an unapproved election trigger (#4/R-09).
/// </summary>
public static class InitialActionDeckComposer
{
    public const int PrintedActionCardCount = 58;
    public const int PrintedElectionDayCardCount = 1;
    public const int CardsPerPlayer = 4;
    public const string AlgorithmVersion = "initial-actions-v1-xorshift32";

    public static InitialActionDeal Deal(
        IReadOnlyCollection<string> actionCardIds,
        string electionDayCardId,
        IReadOnlyList<string> playerIds,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(actionCardIds);
        ArgumentNullException.ThrowIfNull(playerIds);

        if (playerIds.Count is < 2 or > 8 ||
            playerIds.Any(string.IsNullOrWhiteSpace) ||
            playerIds.Distinct(StringComparer.Ordinal).Count() != playerIds.Count)
            throw new ArgumentException("Expected 2-8 unique valid Development participants.", nameof(playerIds));

        if (actionCardIds.Count != PrintedActionCardCount ||
            actionCardIds.Any(string.IsNullOrWhiteSpace) ||
            actionCardIds.Distinct(StringComparer.Ordinal).Count() != actionCardIds.Count ||
            string.IsNullOrWhiteSpace(electionDayCardId) ||
            actionCardIds.Contains(electionDayCardId, StringComparer.Ordinal))
        {
            throw new ArgumentException(
                "Require exactly 58 unique action IDs and one separate Election Day card.",
                nameof(actionCardIds));
        }

        var shuffled = actionCardIds.Append(electionDayCardId)
            .OrderBy(id => id, StringComparer.Ordinal).ToArray();
        var rng = new SeededDraw(unchecked((uint)seed) ^ 0xA341316Cu);
        for (var i = shuffled.Length - 1; i > 0; i--)
        {
            var j = rng.NextIndex(i + 1);
            (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
        }

        var hands = playerIds.Select((playerId, index) => new InitialActionHand(
            playerId,
            Array.AsReadOnly(shuffled.Skip(index * CardsPerPlayer)
                .Take(CardsPerPlayer).ToArray()))).ToArray();
        var remaining = shuffled.Skip(playerIds.Count * CardsPerPlayer).ToArray();
        return new InitialActionDeal(
            AlgorithmVersion,
            seed,
            Array.AsReadOnly(hands),
            Array.AsReadOnly(remaining));
    }

    private sealed class SeededDraw(uint seed)
    {
        private uint _state = seed == 0 ? 0x9E3779B9u : seed;

        public int NextIndex(int maxExclusive)
        {
            _state ^= _state << 13;
            _state ^= _state >> 17;
            _state ^= _state << 5;
            return (int)(_state % (uint)maxExclusive);
        }
    }
}
