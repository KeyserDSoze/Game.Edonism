using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>Pure PUBLIC owner counts, not an audited match or a victory score.</summary>
public sealed record MatchPublicTerritoryFootprintTotals(
    string PlayerId, int ControlledLots, int Standing, int Fallen, int OccupiedStreets);

/// <summary>Lot-only comparison, with competition positions on shared counts.</summary>
public sealed record MatchPublicTerritoryFootprint(
    string PlayerId, int Place, int ControlledLots, int Standing,
    int Fallen, int OccupiedStreets);

/// <summary>
/// Deterministic pure value ordering, NOT an authorization or audit boundary.
/// The authenticated Domain report passes only reconciled, verified road rows.
/// </summary>
public static class PublicTerritoryFootprintOrdering
{
    public static IReadOnlyList<MatchPublicTerritoryFootprint> Rank(
        IReadOnlyList<MatchPublicTerritoryFootprintTotals> totals)
    {
        ArgumentNullException.ThrowIfNull(totals);
        if (totals.Count is < 2 or > 8 || totals.Any(item =>
                item is null || !MatchParticipantId.IsValid(item.PlayerId)
                || item.ControlledLots is < 0 or > BoardDefinition.PrintedActivitySlotCount
                || item.Standing < 0 || item.Fallen < 0
                || item.Standing + item.Fallen != item.ControlledLots
                || item.OccupiedStreets < 0
                || item.OccupiedStreets > BoardDefinition.PrintedStreetCount
                || item.OccupiedStreets > item.ControlledLots
                || (item.ControlledLots > 0 && item.OccupiedStreets == 0))
            || totals.Select(item => item.PlayerId)
                .Distinct(StringComparer.Ordinal).Count() != totals.Count
            || totals.Sum(item => item.ControlledLots) > BoardDefinition.PrintedActivitySlotCount)
            throw new ArgumentException("Invalid public territory footprint totals.", nameof(totals));

        // Only CONTROLLED LOTS determine comparison position. Other public
        // values never break a tie and never imply combat/victory rights.
        var ordered = totals.OrderByDescending(item => item.ControlledLots)
            .ThenBy(item => item.PlayerId, StringComparer.Ordinal).ToArray();
        var result = new MatchPublicTerritoryFootprint[ordered.Length];
        var place = 0;
        for (var index = 0; index < ordered.Length; index++)
        {
            if (index == 0 || ordered[index].ControlledLots != ordered[index - 1].ControlledLots)
                place = index + 1;
            var item = ordered[index];
            result[index] = new MatchPublicTerritoryFootprint(
                item.PlayerId, place, item.ControlledLots, item.Standing,
                item.Fallen, item.OccupiedStreets);
        }
        return Array.AsReadOnly(result);
    }
}
