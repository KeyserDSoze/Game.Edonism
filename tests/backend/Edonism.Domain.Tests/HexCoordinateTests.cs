using Edonism.Domain.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class HexCoordinateTests
{
    [Theory]
    [InlineData(0, 0, 0, 0, 0)]
    [InlineData(0, 0, 1, 0, 1)]
    [InlineData(0, 0, -1, 1, 1)]
    [InlineData(2, -1, -1, 1, 3)]
    [InlineData(-2, 3, 1, -1, 4)]
    public void DistanceIsHexGridDistance(int q1, int r1, int q2, int r2, int expected)
    {
        var from = new HexCoordinate(q1, r1);
        var to = new HexCoordinate(q2, r2);

        Assert.Equal(expected, from.DistanceTo(to));
        Assert.Equal(expected, to.DistanceTo(from));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-4, 7)]
    [InlineData(12, -9)]
    public void SixNeighborsAreUniqueAndExactlyOneStepAway(int q, int r)
    {
        var origin = new HexCoordinate(q, r);
        var neighbors = origin.Neighbors();

        Assert.Equal(6, neighbors.Count);
        Assert.Equal(6, neighbors.Distinct().Count());
        Assert.All(neighbors, neighbor => Assert.Equal(1, origin.DistanceTo(neighbor)));
    }
}
