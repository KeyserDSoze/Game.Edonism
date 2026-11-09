using Edonism.Domain.World;

namespace Edonism.Domain.Tests;

/// <summary>Only synthetic test IDs; not a catalog of official Edonism cards.</summary>
internal static class ActivitySetupFixture
{
    public static ActivityCardId[] Catalog()
    {
        var extras = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["public-financing"] = 2,
            ["private-financing"] = 2,
            ["black-market"] = 2,
            ["corruption"] = 2,
            ["culture"] = 2,
            ["sport"] = 1,
            ["transport"] = 2,
            ["bishopric"] = 3
        };
        return ActivityPlacement.PrintedCategoryQuotas
            .OrderBy(x => x.Key, StringComparer.Ordinal)
            .SelectMany(q => Enumerable.Range(1, q.Value + extras[q.Key])
                .Select(i => new ActivityCardId($"{q.Key}:{i:D2}", q.Key)))
            .ToArray();
    }
}
