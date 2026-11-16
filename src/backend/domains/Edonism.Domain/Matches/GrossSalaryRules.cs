using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>The board henchman is either standing or fallen (e.g. from Pizzo).
/// This enum records state; it does not implement a Pizzo action.</summary>
public enum HenchmanPosture
{
    Standing,
    Fallen
}

/// <summary>
/// A controlled lot with one deployed henchman. Does not assign an activity card,
/// corruption status, money or faction; those belong to later game-design issues.
/// </summary>
public sealed record MatchControlledActivitySnapshot(
    string SlotId,
    string OwnerPlayerId,
    HenchmanPosture Posture);

/// <summary>A gross pre-tax quote, NOT a wallet credit or turn settlement.</summary>
public sealed record MatchGrossSalaryQuote(
    string PlayerId,
    int BaseAtoms,
    int StandingActivityAtoms,
    int GrossAtoms);

/// <summary>
/// Rulebook2 p.5: gross salary is two atoms plus one for each controlled activity
/// with an upright henchman. Fallen henchmen do not produce salary.
/// Taxes, Innovate, corruption interactions and credits are NOT decided here.
/// </summary>
public static class GrossSalaryRules
{
    public const int PrintedBaseAtoms = 2;
    // Rulebook2 pp.3–4: printed player colors and per-seat reserve.
    private const int MaxPrintedSeats = 8;
    private const int PrintedHenchmenPerSeat = 16;
    private const int MaxPrintedInitialHearts = 5;

    public static IReadOnlyList<MatchGrossSalaryQuote> Quote(
        BoardDefinition board,
        IReadOnlyList<MatchPlayerSnapshot> players,
        IReadOnlyList<MatchControlledActivitySnapshot> controlledActivities)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(players);
        ArgumentNullException.ThrowIfNull(controlledActivities);
        board.Validate();

        // #160: this is a PUBLIC Domain quote, not an economic right
        // to pay the salary. Never present an apparently authoritative
        // amount for an impossible player roster supplied by an internal
        // caller or future checkpoint. The actor ID policy is shared with
        // the match commands and the first-round audit verifier.
        var streetIds = board.Streets.Select(street => street.Id)
            .ToHashSet(StringComparer.Ordinal);
        var boardSlots = board.Slots.Select(slot => slot.Id)
            .ToHashSet(StringComparer.Ordinal);
        if (players.Count is < 2 or > MaxPrintedSeats || players.Any(p =>
                p is null || !MatchParticipantId.IsValid(p.PlayerId)
                || !boardSlots.Contains(p.StartingSlotId)
                || !streetIds.Contains(p.StreetId)
                || p.Atoms < 0 || p.DiplomacyTokens < 0
                || p.HenchmenTotal != PrintedHenchmenPerSeat
                || p.HenchmenAvailable is < 0 or > PrintedHenchmenPerSeat
                || p.Hearts is < 1 or > MaxPrintedInitialHearts))
            throw new ArgumentException(
                "Salary requires 2–8 canonical players with valid public resources.",
                nameof(players));

        var playerIds = players.Select(p => p.PlayerId).ToHashSet(StringComparer.Ordinal);
        if (playerIds.Count != players.Count
            || players.Select(p => p.StartingSlotId)
                .Distinct(StringComparer.Ordinal).Count() != players.Count)
            throw new ArgumentException(
                "Salary requires distinct player IDs and printed starting slots.",
                nameof(players));

        var occupiedSlots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var activity in controlledActivities)
        {
            if (activity is null || string.IsNullOrWhiteSpace(activity.OwnerPlayerId) ||
                string.IsNullOrWhiteSpace(activity.SlotId) ||
                !Enum.IsDefined(activity.Posture) ||
                !boardSlots.Contains(activity.SlotId) ||
                !playerIds.Contains(activity.OwnerPlayerId) ||
                !occupiedSlots.Add(activity.SlotId))
            {
                throw new ArgumentException(
                    "Each controlled activity requires a unique valid lot, owner and posture.",
                    nameof(controlledActivities));
            }
        }

        var quotes = new List<MatchGrossSalaryQuote>(players.Count);
        foreach (var player in players)
        {
            var deployed = controlledActivities.Count(c => c.OwnerPlayerId == player.PlayerId);
            if (deployed > player.HenchmenTotal ||
                player.HenchmenAvailable != player.HenchmenTotal - deployed)
            {
                throw new InvalidOperationException(
                    "A player cannot deploy more henchmen than owned or have an inconsistent reserve.");
            }

            var standing = controlledActivities.Count(c =>
                c.OwnerPlayerId == player.PlayerId && c.Posture == HenchmanPosture.Standing);

            quotes.Add(new MatchGrossSalaryQuote(
                player.PlayerId,
                PrintedBaseAtoms,
                standing,
                checked(PrintedBaseAtoms + standing)));
        }

        return Array.AsReadOnly(quotes.ToArray());
    }
}
