using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>
/// Public character card metadata, transcribed from a source catalog.
/// The official 23 character records have not yet been imported (#7/#9).
/// </summary>
public sealed record CharacterCardDefinition(
    string Id, string StartingActivityCardId, int PrintedInitialHearts);

/// <summary>Face-up character drawn by a player. Factions and action hands are not included.</summary>
public sealed record DrawnCharacter(
    string PlayerId, string CharacterId, string StartingActivityCardId, int PrintedInitialHearts);

public sealed record CharacterDrawPlan(
    string AlgorithmVersion, int Seed, IReadOnlyList<DrawnCharacter> Characters);

/// <summary>
/// Rulebook2 pp.3-4: shuffle the 23 public character cards; deal one to
/// each player, retaining the card's associated starting activity and health.
/// No faction, powers or card art is invented. Seed is a Development protocol.
/// </summary>
public static class CharacterSetupComposer
{
    public const int PrintedCharacterCount = 23;
    public const string AlgorithmVersion = "character-draw-v1-xorshift32";

    public static CharacterDrawPlan Draw(
        IReadOnlyCollection<CharacterCardDefinition> characters,
        IReadOnlyCollection<ActivityCardId> activities,
        IReadOnlyList<string> playerIds,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(characters);
        ArgumentNullException.ThrowIfNull(activities);
        ArgumentNullException.ThrowIfNull(playerIds);

        // Two to eight is a Development fixture bound, NOT a decision about the
        // final minimum player count. The box contains eight colored pawn sets.
        if (playerIds.Count is < 2 or > 8 ||
            playerIds.Any(string.IsNullOrWhiteSpace) ||
            playerIds.Distinct(StringComparer.Ordinal).Count() != playerIds.Count)
            throw new ArgumentException("Expected 2-8 distinct valid Development players.", nameof(playerIds));

        if (activities.Count != ActivitySetupComposer.PrintedCatalogSize ||
            activities.Any(c => c is null || string.IsNullOrWhiteSpace(c.Id) ||
                string.IsNullOrWhiteSpace(c.Category) ||
                !ActivityPlacement.PrintedCategoryQuotas.ContainsKey(c.Category)) ||
            activities.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count() != activities.Count)
            throw new ArgumentException("A valid 46-card activity catalog is required.", nameof(activities));

        var availableActivities = activities.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        if (characters.Count != PrintedCharacterCount ||
            characters.Any(c => c is null ||
                string.IsNullOrWhiteSpace(c.Id) ||
                string.IsNullOrWhiteSpace(c.StartingActivityCardId) ||
                !availableActivities.Contains(c.StartingActivityCardId) ||
                c.PrintedInitialHearts is < 1 or > 5) ||
            characters.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count() != characters.Count)
        {
            throw new ArgumentException(
                "A valid unique 23-card character catalog with known associated activities and 1-5 hearts is required.",
                nameof(characters));
        }

        var deck = characters.OrderBy(c => c.Id, StringComparer.Ordinal).ToArray();
        var rng = new SeededDraw(unchecked((uint)seed) ^ 0xC2B2AE35u);
        for (var i = deck.Length - 1; i > 0; i--)
        {
            var j = rng.NextIndex(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }

        var drawn = playerIds.Select((id, index) => new DrawnCharacter(
            id, deck[index].Id, deck[index].StartingActivityCardId, deck[index].PrintedInitialHearts))
            .ToArray();

        // If two drawn characters require the same single physical activity
        // card, do not silently allocate a duplicate; the rulebook does not
        // define such a case. A match attempt then fails without state changes.
        if (drawn.Select(c => c.StartingActivityCardId)
                .Distinct(StringComparer.Ordinal).Count() != drawn.Length)
        {
            throw new ArgumentException(
                "Drawn characters require the same starting activity card.", nameof(characters));
        }

        return new CharacterDrawPlan(AlgorithmVersion, seed, Array.AsReadOnly(drawn));
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
