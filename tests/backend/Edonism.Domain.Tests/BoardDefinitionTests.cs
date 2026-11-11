using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class BoardDefinitionTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();

    [Fact]
    public void PrintedBoardContainsThirtyUniqueSlotsOnSevenStreets()
    {
        Board.Validate();
        Assert.Equal("edonism-streets-v1", Board.Version);
        Assert.Equal(7, Board.Streets.Count);
        Assert.Equal(30, Board.Slots.Count);
        Assert.Equal(30, Board.Slots.Select(s => s.Id).Distinct().Count());
        Assert.Equal(8, Board.Slots.Count(s => s.StreetId == "gauss"));
        Assert.Equal(8, Board.Slots.Count(s => s.StreetId == "einstein"));
        Assert.Equal(4, Board.Slots.Count(s => s.StreetId == "boson"));
        Assert.Equal(4, Board.Slots.Count(s => s.StreetId == "meson"));
        Assert.Equal(3, Board.Slots.Count(s => s.StreetId == "newton"));
        Assert.Equal(3, Board.Slots.Count(s => s.StreetId == "planck"));
        Assert.DoesNotContain(Board.Slots, s => s.StreetId == "main-square");
    }

    [Theory]
    [InlineData("planck", "gauss")]
    [InlineData("planck", "einstein")]
    [InlineData("planck", "meson")]
    [InlineData("einstein", "newton")]
    [InlineData("einstein", "main-square")]
    [InlineData("newton", "boson")]
    [InlineData("boson", "main-square")]
    [InlineData("meson", "main-square")]
    [InlineData("gauss", "main-square")]
    public void AdjacentRoadsAllowExactlyOneMoveInBothDirections(string from, string to)
    {
        Assert.True(Board.CanMoveOneStreet(from, to));
        Assert.True(Board.CanMoveOneStreet(to, from));
        Assert.Equal(1, Board.ShortestStreetDistance(from, to));
    }

    [Theory]
    [InlineData("boson", "meson", 2)]
    [InlineData("planck", "newton", 2)]
    [InlineData("boson", "einstein", 2)]
    [InlineData("meson", "gauss", 2)]
    public void NonAdjacentRoadsRequireMultipleMoves(string from, string to, int distance)
    {
        Assert.False(Board.CanMoveOneStreet(from, to));
        Assert.Equal(distance, Board.ShortestStreetDistance(from, to));
    }

    [Theory]
    [InlineData("unknown", "planck")]
    [InlineData("planck", "unknown")]
    public void UnknownStreetsNeverPermitMovement(string from, string to)
    {
        Assert.False(Board.CanMoveOneStreet(from, to));
        Assert.Null(Board.ShortestStreetDistance(from, to));
    }

    [Fact]
    public void EveryStreetIsReachableAndThereAreNoSelfEdges()
    {
        foreach (var from in Board.Streets)
        foreach (var to in Board.Streets)
        {
            Assert.NotNull(Board.ShortestStreetDistance(from.Id, to.Id));
            Assert.False(Board.CanMoveOneStreet(from.Id, from.Id));
        }
    }

    [Fact]
    public void RejectsNonReciprocalConnections()
    {
        var streets = Board.Streets
            .Select(s => s.Id == "planck" ? s with { Neighbors = ["gauss"] } : s)
            .ToArray();
        Assert.Throws<InvalidOperationException>(() => (Board with { Streets = streets }).Validate());
    }

    [Fact]
    public void RejectsDuplicateSlots()
    {
        var slots = Board.Slots.ToArray();
        slots[1] = slots[0];
        Assert.Throws<InvalidOperationException>(() => (Board with { Slots = slots }).Validate());
    }
    [Fact]
    public void CanonicalShortestStreetPathUsesOrdinalTiesAndCannotBeMutated()
    {
        Assert.Equal(new[] { "gauss", "main-square", "einstein" },
            Board.ShortestStreetPath("gauss", "einstein"));
        Assert.Equal(new[] { "einstein", "main-square", "gauss" },
            Board.ShortestStreetPath("einstein", "gauss"));
        Assert.Equal(new[] { "planck" }, Board.ShortestStreetPath("planck", "planck"));
        Assert.Null(Board.ShortestStreetPath("unknown", "gauss"));
        Assert.Null(Board.ShortestStreetPath("gauss", "unknown"));
        var path = Board.ShortestStreetPath("gauss", "einstein")!;
        Assert.Throws<NotSupportedException>(() => ((IList<string>)path)[1] = "forged");
    }

    [Fact]
    public void AllFortyNineStreetPairsFollowContiguousMinimumPaths()
    {
        foreach (var from in Board.Streets)
        foreach (var to in Board.Streets)
        {
            var path = Board.ShortestStreetPath(from.Id, to.Id)!;
            Assert.Equal(from.Id, path[0]);
            Assert.Equal(to.Id, path[^1]);
            Assert.Equal(Board.ShortestStreetDistance(from.Id, to.Id), path.Count - 1);
            Assert.All(Enumerable.Range(0, path.Count - 1), i =>
                Assert.True(Board.CanMoveOneStreet(path[i], path[i + 1])));
        }
    }

}
