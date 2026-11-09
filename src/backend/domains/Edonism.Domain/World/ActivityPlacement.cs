namespace Edonism.Domain.World;

public sealed record ActivityCardId(string Id, string Category);
public sealed record SlotAssignment(string SlotId, string CardId);

/// <summary>
/// Deterministically places a *preselected* set of 30 real card IDs in the board's 30 printed slots.
/// This does not select the deck or enforce mandatory character starting activities (issue #6).
/// </summary>
public static class ActivityPlacement
{
    // Rulebook2 page 4. These are printed setup quotas, not 3D appearance categories.
    public static readonly IReadOnlyDictionary<string, int> PrintedCategoryQuotas =
        new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["public-financing"] = 5,
            ["private-financing"] = 5,
            ["black-market"] = 4,
            ["corruption"] = 4,
            ["culture"] = 4,
            ["sport"] = 2,
            ["transport"] = 3,
            ["bishopric"] = 3
        };

    public static IReadOnlyList<SlotAssignment> Assign(
        BoardDefinition board,
        IReadOnlyCollection<ActivityCardId> selectedCards,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(selectedCards);
        board.Validate();
        if (selectedCards.Count != board.Slots.Count
            || selectedCards.Any(c => string.IsNullOrWhiteSpace(c.Id) || string.IsNullOrWhiteSpace(c.Category))
            || selectedCards.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count() != selectedCards.Count)
        {
            throw new ArgumentException("Exactly 30 unique, valid card IDs are required.", nameof(selectedCards));
        }

        // This API is deliberately strict: exceptions to quotas from mandatory start cards
        // require an explicit rule-specific composition step in issue #6.
        foreach (var quota in PrintedCategoryQuotas)
        {
            if (selectedCards.Count(c => c.Category == quota.Key) != quota.Value)
            {
                throw new ArgumentException($"Incorrect number of cards for {quota.Key}.", nameof(selectedCards));
            }
        }

        if (selectedCards.Any(c => !PrintedCategoryQuotas.ContainsKey(c.Category)))
        {
            throw new ArgumentException("Unknown printed activity category.", nameof(selectedCards));
        }

        var shuffled = selectedCards.OrderBy(c => c.Id, StringComparer.Ordinal).ToArray();
        var rng = new SeededGenerator(unchecked((uint)seed));
        for (var i = shuffled.Length - 1; i > 0; i--)
        {
            var j = rng.NextIndex(i + 1);
            (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
        }

        var slots = board.Slots.OrderBy(s => s.Id, StringComparer.Ordinal).ToArray();
        return slots.Select((slot, index) => new SlotAssignment(slot.Id, shuffled[index].Id)).ToArray();
    }

    /// <summary>Fixed xorshift32 algorithm, independent of .NET Random implementation.</summary>
    private sealed class SeededGenerator(uint seed)
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
