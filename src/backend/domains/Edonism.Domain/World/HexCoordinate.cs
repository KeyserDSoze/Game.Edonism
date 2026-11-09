namespace Edonism.Domain.World;

/// <summary>Axial coordinates of a pointy-top hexagonal grid. Geometry only, not gameplay rules.</summary>
public readonly record struct HexCoordinate(int Q, int R)
{
    public int S => -Q - R;

    public int DistanceTo(HexCoordinate other)
    {
        return (Math.Abs(Q - other.Q) + Math.Abs(R - other.R) + Math.Abs(S - other.S)) / 2;
    }

    public IReadOnlyList<HexCoordinate> Neighbors() =>
    [
        new(Q + 1, R),
        new(Q + 1, R - 1),
        new(Q, R - 1),
        new(Q - 1, R),
        new(Q - 1, R + 1),
        new(Q, R + 1)
    ];
}
