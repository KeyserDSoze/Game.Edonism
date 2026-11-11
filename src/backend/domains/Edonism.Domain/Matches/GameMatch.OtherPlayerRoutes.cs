namespace Edonism.Domain.Matches;

/// <summary>
/// One OTHER public player at the current verified revision. Street hops do
/// not represent turns, attacks, diplomacy, alliances or permissions.
/// </summary>
public sealed record MatchOtherPlayerRoute(
    string OtherPlayerId, string StreetId, int StreetSteps,
    IReadOnlyList<string> StreetPath, int ControlledActivities, int StandingHenchmen);

/// <summary>
/// Bearer-derived actor view of public positions and controlled-lot posture.
/// Contains no hidden hand, deck, faction, bearer token or player identity.
/// </summary>
public sealed record MatchOtherPlayerRoutes(
    Guid MatchId, string PlayerId, int Round, long VerifiedRevision,
    string FromStreetId, IReadOnlyList<MatchOtherPlayerRoute> Others);

public sealed partial class GameMatch
{
    /// <summary>
    /// Informational first-round proximity to all OTHER seats. Distances and
    /// paths use the deterministic public board BFS. The audited snapshot is
    /// authoritative; calculations cannot mutate the match.
    /// </summary>
    public MatchOtherPlayerRoutes? VerifiedOtherPlayerRoutesForActor(string actorId)
    {
        var state = Snapshot();
        var actor = state.Players.FirstOrDefault(p => p.PlayerId == actorId);
        if (actor is null) return null;

        var replay = MatchAuditReplay.Verify(_board, state);
        if (!replay.IsValid || replay.VerifiedRevision != state.Revision || state.Round != 1)
            throw new InvalidOperationException("Cannot project unverified first-round PvP proximity.");

        var others = new List<MatchOtherPlayerRoute>();
        foreach (var player in state.Players)
        {
            if (player.PlayerId == actorId) continue;
            var path = _board.ShortestStreetPath(actor.StreetId, player.StreetId)
                ?? throw new InvalidOperationException("A public player street is unreachable.");
            var controls = state.ControlledActivities
                .Where(c => c.OwnerPlayerId == player.PlayerId).ToArray();
            others.Add(new MatchOtherPlayerRoute(
                player.PlayerId, player.StreetId, path.Count - 1, path,
                controls.Length, controls.Count(c => c.Posture == HenchmanPosture.Standing)));
        }

        return new MatchOtherPlayerRoutes(MatchId, actorId, state.Round,
            replay.VerifiedRevision, actor.StreetId,
            Array.AsReadOnly(others.OrderBy(o => o.StreetSteps)
                .ThenBy(o => o.OtherPlayerId, StringComparer.Ordinal).ToArray()));
    }
}
