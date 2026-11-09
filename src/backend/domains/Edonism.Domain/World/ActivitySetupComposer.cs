namespace Edonism.Domain.World;

/// <summary>Public face-up card placement in an activity lot (not a hidden hand/deck).</summary>
public sealed record PlacedActivityCard(string SlotId, string CardId, string Category);

/// <summary>
/// Deterministic development setup plan. "v1" fixes the sampling/shuffling algorithm;
/// a rule change requires a new version and regression vectors.
/// </summary>
public sealed record ActivityBoardSetup(
    string AlgorithmVersion,
    int Seed,
    IReadOnlyList<PlacedActivityCard> Activities);

/// <summary>
/// Rulebook2 pages 3-4: choose 30 cards from 46 available, preserve each
/// character's mandatory associated card and match eight printed category quotas.
/// The rulebook's overflow remediation remains ambiguous (#4/R-03), so an
/// over-quota mandatory group is REJECTED rather than silently reinterpreted.
/// No card content, faction, initial character draw or hidden hand is inferred.
/// </summary>
public static class ActivitySetupComposer
{
    public const string AlgorithmVersion = "activity-setup-v1-xorshift32";
    public const int PrintedCatalogSize = 46;

    public static ActivityBoardSetup Compose(
        BoardDefinition board,
        IReadOnlyCollection<ActivityCardId> catalog,
        IReadOnlyCollection<string> mandatoryCardIds,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(mandatoryCardIds);
        board.Validate();

        if (catalog.Count != PrintedCatalogSize ||
            catalog.Any(c => c is null ||
                string.IsNullOrWhiteSpace(c.Id) ||
                string.IsNullOrWhiteSpace(c.Category) ||
                !ActivityPlacement.PrintedCategoryQuotas.ContainsKey(c.Category)))
        {
            throw new ArgumentException(
                "The preview catalog must contain 46 valid cards in printed categories.", nameof(catalog));
        }

        var byId = new Dictionary<string, ActivityCardId>(StringComparer.Ordinal);
        foreach (var card in catalog)
        {
            if (!byId.TryAdd(card.Id, card))
                throw new ArgumentException("Duplicate card ID in catalog.", nameof(catalog));
        }

        if (mandatoryCardIds.Count is < 1 or > 8 ||
            mandatoryCardIds.Any(id => string.IsNullOrWhiteSpace(id)) ||
            mandatoryCardIds.Distinct(StringComparer.Ordinal).Count() != mandatoryCardIds.Count ||
            mandatoryCardIds.Any(id => !byId.ContainsKey(id)))
        {
            throw new ArgumentException(
                "Mandatory character activities must be distinct and present in the catalog.",
                nameof(mandatoryCardIds));
        }

        var mandatory = mandatoryCardIds.ToHashSet(StringComparer.Ordinal);
        var rng = new SeededSampler(unchecked((uint)seed));
        var selected = new List<ActivityCardId>(board.Slots.Count);
        foreach (var category in ActivityPlacement.PrintedCategoryQuotas.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var fixedCards = catalog
                .Where(c => c.Category == category.Key && mandatory.Contains(c.Id))
                .OrderBy(c => c.Id, StringComparer.Ordinal)
                .ToArray();

            if (fixedCards.Length > category.Value)
            {
                // p.4 cannot be applied without overriding a character's required
                // card. No speculative spill/compensation across other categories.
                throw new ArgumentException(
                    $"Mandatory activities exceed the printed quota for {category.Key}.",
                    nameof(mandatoryCardIds));
            }

            var needed = category.Value - fixedCards.Length;
            var optional = catalog
                .Where(c => c.Category == category.Key && !mandatory.Contains(c.Id))
                .OrderBy(c => c.Id, StringComparer.Ordinal)
                .ToArray();

            if (optional.Length < needed)
                throw new ArgumentException(
                    $"Not enough cards in the printed category {category.Key}.", nameof(catalog));

            // Fisher-Yates over a sorted pool: supplied catalog order is irrelevant.
            for (var i = optional.Length - 1; i > 0; i--)
            {
                var index = rng.NextIndex(i + 1);
                (optional[i], optional[index]) = (optional[index], optional[i]);
            }

            selected.AddRange(fixedCards);
            selected.AddRange(optional.Take(needed));
        }

        // Different deterministic stream for spatial assignment than for drawing.
        var boardSeed = seed ^ unchecked((int)0x6D2B79F5);
        var assignments = ActivityPlacement.Assign(board, selected, boardSeed);
        var selectedById = selected.ToDictionary(c => c.Id, StringComparer.Ordinal);
        var placed = assignments.Select(a => new PlacedActivityCard(
            a.SlotId, a.CardId, selectedById[a.CardId].Category)).ToArray();

        return new ActivityBoardSetup(
            AlgorithmVersion, seed, Array.AsReadOnly(placed));
    }

    private sealed class SeededSampler(uint seed)
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
