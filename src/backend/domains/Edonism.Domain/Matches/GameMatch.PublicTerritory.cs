using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>Public per-seat controlled-lot posture counts on a printed road.</summary>
public sealed record MatchPublicTerritoryOwner(
    string PlayerId, int ControlledLots, int Standing, int Fallen);

/// <summary>
/// All 2–8 owners including zero are preserved in server seat order.
/// "Shared" is NOT a combat, purchase, movement or victory permission.
/// </summary>
public sealed record MatchPublicTerritoryStreet(
    string StreetId, string StreetName, int TotalSlots, int FreeLots,
    int ControlledLots, int Standing, int Fallen, int DistinctOwnerCount,
    bool IsShared, IReadOnlyList<MatchPublicTerritoryOwner> Owners);

/// <summary>First-round, audited public-only territory for one authenticated actor.</summary>
public sealed record MatchPublicTerritoryReport(
    Guid MatchId, string PlayerId, int Round, long VerifiedRevision,
    int TotalSlots, int FreeLots, int ControlledLots, int SharedStreetCount,
    IReadOnlyList<MatchPublicTerritoryStreet> Streets);

public sealed partial class GameMatch
{
    /// <summary>
    /// null for unknown actor or authenticated partial/legacy board, never an
    /// apparently authoritative zero-lot full board. Store authenticates the
    /// bearer before exposing even the distinction between 404 and 409.
    /// </summary>
    public MatchPublicTerritoryReport? VerifiedPublicTerritoryForActor(string actorId)
    {
        var state = Snapshot();
        if (!state.Players.Any(player => player.PlayerId == actorId))
            return null;

        var audit = MatchAuditReplay.Verify(_board, state);
        if (!audit.IsValid || audit.VerifiedRevision != state.Revision || state.Round != 1)
            throw new InvalidOperationException("Cannot report unverified public territory.");
        if (state.BoardActivities.Count != BoardDefinition.PrintedActivitySlotCount)
            return null;

        var printedSlots = _board.Slots.ToDictionary(s => s.Id, s => s.StreetId,
            StringComparer.Ordinal);
        if (state.BoardActivities.Any(card => card is null
                || !printedSlots.ContainsKey(card.SlotId)
                || string.IsNullOrWhiteSpace(card.CardId)
                || string.IsNullOrWhiteSpace(card.Category))
            || state.BoardActivities.Select(card => card.SlotId)
                .Distinct(StringComparer.Ordinal).Count() != printedSlots.Count
            || state.BoardActivities.Select(card => card.CardId)
                .Distinct(StringComparer.Ordinal).Count() != printedSlots.Count
            || ActivityPlacement.PrintedCategoryQuotas.Any(quota =>
                state.BoardActivities.Count(card => card.Category == quota.Key) != quota.Value))
            throw new InvalidOperationException("Malformed complete public activity board.");

        var playerIds = state.Players.Select(player => player.PlayerId)
            .ToHashSet(StringComparer.Ordinal);
        if (state.ControlledActivities.Any(control => control is null
                || !printedSlots.ContainsKey(control.SlotId)
                || !playerIds.Contains(control.OwnerPlayerId)
                || !Enum.IsDefined(control.Posture))
            || state.ControlledActivities.Select(control => control.SlotId)
                .Distinct(StringComparer.Ordinal).Count() != state.ControlledActivities.Count)
            throw new InvalidOperationException("Malformed public controlled-lot ownership.");

        var streets = _board.Streets.Select(street =>
        {
            var totalSlots = _board.Slots.Count(slot => slot.StreetId == street.Id);
            var held = state.ControlledActivities.Where(lot =>
                printedSlots[lot.SlotId] == street.Id).ToArray();
            var standing = held.Count(lot => lot.Posture == HenchmanPosture.Standing);
            var fallen = held.Count(lot => lot.Posture == HenchmanPosture.Fallen);
            var owners = state.Players.Select(player =>
            {
                var own = held.Where(lot => lot.OwnerPlayerId == player.PlayerId).ToArray();
                return new MatchPublicTerritoryOwner(
                    player.PlayerId, own.Length,
                    own.Count(lot => lot.Posture == HenchmanPosture.Standing),
                    own.Count(lot => lot.Posture == HenchmanPosture.Fallen));
            }).ToArray();
            var distinct = owners.Count(owner => owner.ControlledLots > 0);
            if (standing + fallen != held.Length
                || owners.Sum(owner => owner.ControlledLots) != held.Length
                || owners.Any(owner => owner.Standing + owner.Fallen != owner.ControlledLots)
                || held.Length > totalSlots)
                throw new InvalidOperationException("Public street territory checksum failed.");

            return new MatchPublicTerritoryStreet(
                street.Id, street.Name, totalSlots, totalSlots - held.Length,
                held.Length, standing, fallen, distinct, distinct >= 2,
                Array.AsReadOnly(owners));
        }).ToArray();

        if (streets.Length != BoardDefinition.PrintedStreetCount
            || streets.Sum(street => street.TotalSlots) != BoardDefinition.PrintedActivitySlotCount
            || streets.Sum(street => street.ControlledLots) != state.ControlledActivities.Count
            || streets.Sum(street => street.FreeLots) + state.ControlledActivities.Count
                != BoardDefinition.PrintedActivitySlotCount)
            throw new InvalidOperationException("Public territory board totals disagree.");

        return new MatchPublicTerritoryReport(
            state.MatchId, actorId, state.Round, audit.VerifiedRevision,
            BoardDefinition.PrintedActivitySlotCount,
            streets.Sum(street => street.FreeLots), state.ControlledActivities.Count,
            streets.Count(street => street.IsShared), Array.AsReadOnly(streets));
    }
}
