namespace Edonism.Domain.World;

/// <summary>Positions are approximate coordinates in a 1504x998 design viewbox scaled from the 2048x1371 source image, not movement coordinates. Rulebook2 pages 4, 7-8.</summary>
public sealed record BoardPoint(double X, double Y);
public sealed record StreetDefinition(string Id, string Name, IReadOnlyList<string> Neighbors, BoardPoint Label);
public sealed record ActivitySlot(string Id, string StreetId, BoardPoint Center);
public sealed record RoadArea(string StreetId, BoardPoint Center, double Width, double Height);

/// <summary>Versioned street graph and the 30 printed grey activity spaces. No player positions/ownership.</summary>
public sealed record BoardDefinition(
    string Version,
    string Source,
    double Width,
    double Height,
    BoardPoint CityHall,
    IReadOnlyList<StreetDefinition> Streets,
    IReadOnlyList<ActivitySlot> Slots,
    IReadOnlyList<RoadArea> Roads)
{
    public const int PrintedActivitySlotCount = 30;
    public const int PrintedStreetCount = 7;

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Version) || Width <= 0 || Height <= 0
            || Streets is null || Slots is null || Roads is null
            || Streets.Count != PrintedStreetCount || Slots.Count != PrintedActivitySlotCount)
        {
            throw new InvalidOperationException("Board metadata/cardinality does not match the printed board.");
        }

        if (!WithinBounds(CityHall))
        {
            throw new InvalidOperationException("City Hall must be within the board.");
        }

        var streetMap = Streets.ToDictionary(s => s.Id, StringComparer.Ordinal);
        if (streetMap.Count != PrintedStreetCount
            || Streets.Any(s => string.IsNullOrWhiteSpace(s.Name) || !WithinBounds(s.Label)))
        {
            throw new InvalidOperationException("Street identifiers/labels must be unique and valid.");
        }

        foreach (var street in Streets)
        {
            if (street.Neighbors.Count != street.Neighbors.Distinct(StringComparer.Ordinal).Count()
                || street.Neighbors.Contains(street.Id, StringComparer.Ordinal))
            {
                throw new InvalidOperationException($"Street {street.Id} has duplicate/self adjacency.");
            }

            foreach (var neighbor in street.Neighbors)
            {
                if (!streetMap.TryGetValue(neighbor, out var reverse)
                    || !reverse.Neighbors.Contains(street.Id, StringComparer.Ordinal))
                {
                    throw new InvalidOperationException($"Non-reciprocal street connection: {street.Id} -> {neighbor}.");
                }
            }
        }

        if (Streets.Select(s => s.Id).Any(id => ShortestStreetDistance(Streets[0].Id, id) is null))
        {
            throw new InvalidOperationException("Street graph must be connected.");
        }

        if (Slots.Select(s => s.Id).Distinct(StringComparer.Ordinal).Count() != Slots.Count
            || Slots.Any(s => !streetMap.ContainsKey(s.StreetId) || !WithinBounds(s.Center)))
        {
            throw new InvalidOperationException("Activity slots must have unique IDs, valid streets and positions.");
        }

        if (Slots.Any(s => s.StreetId == "main-square"))
        {
            throw new InvalidOperationException("Main Square contains City Hall, not an activity slot.");
        }

        if (Roads.Count == 0 || Roads.Any(r => !streetMap.ContainsKey(r.StreetId)
            || !WithinBounds(r.Center) || r.Width <= 0 || r.Height <= 0))
        {
            throw new InvalidOperationException("Road geometry must be positive, labeled and within the board.");
        }
    }

    /// <summary>Single street-to-street move only, independent of pixels, rendering or hex distances.</summary>
    public bool CanMoveOneStreet(string fromStreet, string toStreet) =>
        Streets.FirstOrDefault(s => s.Id == fromStreet)?.Neighbors.Contains(toStreet, StringComparer.Ordinal) ?? false;

    /// <summary>
    /// Canonical inclusive shortest street path (start and destination).
    /// Ties use ordinal street IDs, not renderer geometry, label order or
    /// mutable input neighbor order. Returns null for unknown streets.
    /// </summary>
    public IReadOnlyList<string>? ShortestStreetPath(string fromStreet, string toStreet)
    {
        var streetMap = Streets.ToDictionary(s => s.Id, StringComparer.Ordinal);
        if (!streetMap.ContainsKey(fromStreet) || !streetMap.ContainsKey(toStreet))
            return null;

        var previous = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            [fromStreet] = null
        };
        var queue = new Queue<string>();
        queue.Enqueue(fromStreet);
        while (queue.TryDequeue(out var current))
        {
            if (current == toStreet)
            {
                var reversed = new List<string>();
                for (string? street = current; street is not null; street = previous[street])
                    reversed.Add(street);
                reversed.Reverse();
                return Array.AsReadOnly(reversed.ToArray());
            }

            foreach (var neighbor in streetMap[current].Neighbors.Order(StringComparer.Ordinal))
            {
                if (!streetMap.ContainsKey(neighbor) || previous.ContainsKey(neighbor))
                    continue;
                previous.Add(neighbor, current);
                queue.Enqueue(neighbor);
            }
        }

        return null;
    }

    /// <summary>Shortest count of street edges; derived from the same canonical route.</summary>
    public int? ShortestStreetDistance(string fromStreet, string toStreet)
    {
        var path = ShortestStreetPath(fromStreet, toStreet);
        return path is null ? null : path.Count - 1;
    }

    private bool WithinBounds(BoardPoint point) =>
        point is not null && double.IsFinite(point.X) && double.IsFinite(point.Y)
        && point.X >= 0 && point.Y >= 0 && point.X <= Width && point.Y <= Height;
}
