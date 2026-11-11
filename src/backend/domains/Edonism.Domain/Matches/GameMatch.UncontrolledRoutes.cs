namespace Edonism.Domain.Matches;

/// <summary>
/// A public activity not currently controlled by any player, with only a
/// shortest *street graph edge count*. Never a purchase permission or price.
/// </summary>
public sealed record MatchUncontrolledRoute(
    string SlotId, string CardId, string Category, string StreetId, int StreetSteps);

/// <summary>
/// Actor-scoped, read-only movement-planning projection for the verified
/// first round. Does not include hidden hands, any wallet or credentials.
/// </summary>
public sealed record MatchUncontrolledRoutes(
    Guid MatchId, string PlayerId, int Round, long VerifiedRevision,
    string FromStreetId, IReadOnlyList<MatchUncontrolledRoute> Routes);

public sealed partial class GameMatch
{
    /// <summary>
    /// List uncontrolled PUBLIC card placements, ordered by shortest street
    /// graph steps from the authenticated actor's current server position.
    /// A step is an edge in the versioned board graph, not a turn estimate.
    /// Ownership, match state, permissions and money are not changed.
    /// </summary>
    public MatchUncontrolledRoutes? VerifiedUncontrolledRoutesForActor(string actorId)
    {
        var player = _players.FirstOrDefault(p => p.PlayerId == actorId);
        if (player is null) return null;

        var state = Snapshot();
        var verified = MatchAuditReplay.Verify(_board, state);
        if (!verified.IsValid || verified.VerifiedRevision != state.Revision
            || state.Round != 1)
            throw new InvalidOperationException("Unverified first-round movement planning state.");

        var occupied = _controlledActivities
            .Select(c => c.SlotId).ToHashSet(StringComparer.Ordinal);
        var streetsBySlot = _board.Slots
            .ToDictionary(slot => slot.Id, slot => slot.StreetId, StringComparer.Ordinal);
        var routes = new List<MatchUncontrolledRoute>();
        foreach (var activity in _boardActivities)
        {
            if (occupied.Contains(activity.SlotId)) continue;
            if (!streetsBySlot.TryGetValue(activity.SlotId, out var streetId)
                || _board.ShortestStreetDistance(player.StreetId, streetId) is not int steps)
                throw new InvalidOperationException("Activity route not present in canonical board.");

            routes.Add(new MatchUncontrolledRoute(
                activity.SlotId, activity.CardId, activity.Category, streetId, steps));
        }

        return new MatchUncontrolledRoutes(
            MatchId, actorId, Round, verified.VerifiedRevision, player.StreetId,
            Array.AsReadOnly(routes.OrderBy(r => r.StreetSteps)
                .ThenBy(r => r.SlotId, StringComparer.Ordinal).ToArray()));
    }
}
