namespace Edonism.Domain.Tests;

/// <summary>Opaque synthetic IDs; official action-card images/rules not present.</summary>
internal static class ActionDeckFixture
{
    public const string ElectionDayId = "test:election-day";

    public static string[] ActionIds() =>
        Enumerable.Range(1, 58)
            .Select(i => $"test:action:{i:D2}")
            .ToArray();
}
