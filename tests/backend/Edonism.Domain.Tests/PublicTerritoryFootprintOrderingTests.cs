using Edonism.Domain.Matches;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #159: Pure ordering edge cases unavailable in initial-only full-deck
/// fixtures, without inventing game powers or changing public ownership.
/// </summary>
public sealed class PublicTerritoryFootprintOrderingTests
{
    [Fact]
    public void TiesStayOneOneThreeEvenWithFallenAndZeroLotOwners()
    {
        var input = new[]
        {
            new MatchPublicTerritoryFootprintTotals("diana", 0, 0, 0, 0),
            new MatchPublicTerritoryFootprintTotals("charlie", 1, 1, 0, 1),
            new MatchPublicTerritoryFootprintTotals("bob", 3, 1, 2, 2),
            new MatchPublicTerritoryFootprintTotals("eve", 0, 0, 0, 0),
            new MatchPublicTerritoryFootprintTotals("alice", 3, 3, 0, 1)
        };
        var original = input.ToArray();
        var ranked = PublicTerritoryFootprintOrdering.Rank(input);
        Assert.Equal(new[] { "alice", "bob", "charlie", "diana", "eve" },
            ranked.Select(row => row.PlayerId));
        Assert.Equal(new[] { 1, 1, 3, 4, 4 }, ranked.Select(row => row.Place));
        Assert.Equal(new[] { 3, 3, 1, 0, 0 }, ranked.Select(row => row.ControlledLots));
        Assert.Equal(new[] { 1, 2, 1, 0, 0 }, ranked.Select(row => row.OccupiedStreets));
        Assert.Equal(7, ranked.Sum(row => row.ControlledLots));
        Assert.Equal(original, input);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchPublicTerritoryFootprint>)ranked).Clear());
        Assert.Equal(ranked, PublicTerritoryFootprintOrdering.Rank(input.Reverse().ToArray()));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EveryRealisticStartingLotTieIsFirstEvenWithDifferentPostures(int count)
    {
        var input = Enumerable.Range(0, count).Select(i =>
            new MatchPublicTerritoryFootprintTotals(
                $"player-{i}", 1, i % 2, 1 - i % 2, 1)).ToArray();
        var ranked = PublicTerritoryFootprintOrdering.Rank(input);
        Assert.Equal(count, ranked.Count);
        Assert.All(ranked, item => Assert.Equal(1, item.Place));
        Assert.Equal(input.Select(item => item.PlayerId), ranked.Select(item => item.PlayerId));
        var zero = input.Select(item => item with
        {
            ControlledLots = 0, Standing = 0, Fallen = 0, OccupiedStreets = 0
        }).ToArray();
        var zeroRanked = PublicTerritoryFootprintOrdering.Rank(zero);
        Assert.All(zeroRanked, item =>
        {
            Assert.Equal(1, item.Place);
            Assert.Equal(0, item.OccupiedStreets);
        });
        Assert.Equal(count, zeroRanked.Count);
    }

    [Fact]
    public void MalformedOrUntrustedTotalsFailBeforeReturningAnyComparison()
    {
        var alice = new MatchPublicTerritoryFootprintTotals("alice", 1, 1, 0, 1);
        var bob = new MatchPublicTerritoryFootprintTotals("bob", 0, 0, 0, 0);
        Assert.Throws<ArgumentNullException>(() =>
            PublicTerritoryFootprintOrdering.Rank(null!));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice, alice]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice, bob with { PlayerId = "system" }]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice, bob with { PlayerId = "out\u202Esider" }]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice, bob with { ControlledLots = -1 }]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice, bob with { OccupiedStreets = 1 }]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice with { OccupiedStreets = 0 }, bob]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice with { Standing = 2 }, bob]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([alice with { Fallen = -1 }, bob]));
        Assert.Throws<ArgumentException>(() =>
            PublicTerritoryFootprintOrdering.Rank([
                alice with { ControlledLots = 30, Standing = 30 },
                bob with { ControlledLots = 1, Standing = 1, OccupiedStreets = 1 }
            ]));
    }
}
