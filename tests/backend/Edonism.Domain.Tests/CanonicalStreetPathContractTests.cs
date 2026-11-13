using System.Text.Json;
using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// A pinned public board graph contract consumed independently by .NET and
/// TypeScript. This freezes only the Development v1 topology; five source
/// image-derived edges still need game-designer approval (#4).
/// </summary>
public sealed class CanonicalStreetPathContractTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();
    private static readonly string FixturePath = Path.Combine(
        AppContext.BaseDirectory, "canonical-street-paths.v1.json");

    public static IEnumerable<object[]> PathCases()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(FixturePath));
        foreach (var item in document.RootElement.GetProperty("paths").EnumerateArray())
            yield return
            [
                item.GetProperty("from").GetString()!,
                item.GetProperty("to").GetString()!,
                item.GetProperty("path").EnumerateArray()
                    .Select(node => node.GetString()!).ToArray()
            ];
    }

    [Fact]
    public void GoldenContractExactlyCoversAllSevenBySevenOrderedPairs()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(FixturePath));
        var root = document.RootElement;
        Assert.Equal("edonism-canonical-street-paths-v1",
            root.GetProperty("format").GetString());
        Assert.Equal(Board.Version, root.GetProperty("boardVersion").GetString());
        var paths = root.GetProperty("paths").EnumerateArray().ToArray();
        Assert.Equal(49, paths.Length);
        Assert.Equal(49, paths.Select(p => (
            p.GetProperty("from").GetString(), p.GetProperty("to").GetString()))
            .Distinct().Count());
        var allPairs = Board.Streets.SelectMany(from =>
            Board.Streets.Select(to => (from.Id, to.Id))).ToHashSet();
        var pinnedPairs = paths.Select(p => (
            p.GetProperty("from").GetString()!, p.GetProperty("to").GetString()!))
            .ToHashSet();
        Assert.True(allPairs.SetEquals(pinnedPairs));
        Assert.Equal(new[] { "gauss", "main-square", "einstein" },
            Board.ShortestStreetPath("gauss", "einstein"));
        Assert.Equal(new[] { "newton", "einstein", "planck" },
            Board.ShortestStreetPath("newton", "planck"));
        Assert.Null(Board.ShortestStreetPath("unknown", "gauss"));
        Assert.Null(Board.ShortestStreetPath("gauss", "unknown"));
    }

    [Theory]
    [MemberData(nameof(PathCases))]
    public void PinnedCanonicalRouteIsContiguousMinimalAndIndependentOfInputOrder(
        string from, string to, string[] expected)
    {
        var actual = Board.ShortestStreetPath(from, to);
        Assert.NotNull(actual);
        Assert.Equal(expected, actual);
        Assert.Equal(from, actual[0]);
        Assert.Equal(to, actual[^1]);
        Assert.Equal(expected.Length - 1, Board.ShortestStreetDistance(from, to));
        Assert.Equal(expected.Length, expected.Distinct(StringComparer.Ordinal).Count());
        for (var edge = 1; edge < expected.Length; edge++)
            Assert.True(Board.CanMoveOneStreet(expected[edge - 1], expected[edge]));

        // Sorting order of input JSON/street edges cannot alter tie-breaks.
        var permuted = Board with
        {
            Streets = Board.Streets.Reverse().Select(street =>
                street with { Neighbors = street.Neighbors.Reverse().ToArray() }).ToArray()
        };
        Assert.Equal(expected, permuted.ShortestStreetPath(from, to));
    }
}
