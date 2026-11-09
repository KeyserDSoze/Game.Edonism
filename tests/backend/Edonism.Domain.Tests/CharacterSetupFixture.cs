using Edonism.Domain.Matches;
using Edonism.Domain.World;

namespace Edonism.Domain.Tests;

/// <summary>
/// Synthetic fixture for tests ONLY. No IDs, hearts, or activity associations
/// here claim to correspond to the printed characters.
/// </summary>
internal static class CharacterSetupFixture
{
    public static CharacterCardDefinition[] Catalog()
    {
        var activities = ActivitySetupFixture.Catalog()
            .OrderBy(c => c.Id, StringComparer.Ordinal).ToArray();
        return Enumerable.Range(0, CharacterSetupComposer.PrintedCharacterCount)
            .Select(i => new CharacterCardDefinition(
                $"synthetic-character:{i + 1:D2}",
                activities[i].Id,
                1 + (i % 5)))
            .ToArray();
    }
}
