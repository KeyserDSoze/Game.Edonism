namespace Edonism.Domain.Matches;

/// <summary>
/// A PUBLIC lot controlled by another seat. Street edges do not encode combat,
/// purchases, travel time or future permission to target the owner.
/// </summary>
public sealed record MatchOpponentControlledLotRoute(
    string SlotId, string OwnerPlayerId, HenchmanPosture Posture,
    string StreetId, int StreetSteps, IReadOnlyList<string> StreetPath);

/// <summary>Actor-bound, audited public first-round property proximity.</summary>
public sealed record MatchOpponentControlledLotRoutes(
    Guid MatchId, string PlayerId, int Round, long VerifiedRevision,
    string FromStreetId, IReadOnlyList<MatchOpponentControlledLotRoute> Routes);

public sealed partial class GameMatch
{
    public MatchOpponentControlledLotRoutes? VerifiedOpponentControlledLotsForActor(
        string actorId)
    {
        var state = Snapshot();
        var player = state.Players.FirstOrDefault(p => p.PlayerId == actorId);
        if (player is null) return null;

        var audit = MatchAuditReplay.Verify(_board, state);
        if (!audit.IsValid || audit.VerifiedRevision != state.Revision || state.Round != 1)
            throw new InvalidOperationException(
                "Cannot derive opponent-controlled lots from unverified state.");

        var streetBySlot = _board.Slots.ToDictionary(s => s.Id, s => s.StreetId,
            StringComparer.Ordinal);
        var routes = new List<MatchOpponentControlledLotRoute>();
        foreach (var control in state.ControlledActivities)
        {
            if (control.OwnerPlayerId == actorId) continue;
            if (!streetBySlot.TryGetValue(control.SlotId, out var street)
                || _board.ShortestStreetPath(player.StreetId, street) is not { } path)
                throw new InvalidOperationException(
                    "Controlled lot has no canonical public street route.");

            routes.Add(new MatchOpponentControlledLotRoute(
                control.SlotId, control.OwnerPlayerId, control.Posture, street,
                path.Count - 1, path));
        }
        return new MatchOpponentControlledLotRoutes(
            MatchId, actorId, state.Round, audit.VerifiedRevision, player.StreetId,
            Array.AsReadOnly(routes.OrderBy(x => x.StreetSteps)
                .ThenBy(x => x.OwnerPlayerId, StringComparer.Ordinal)
                .ThenBy(x => x.SlotId, StringComparer.Ordinal).ToArray()));
    }
}
