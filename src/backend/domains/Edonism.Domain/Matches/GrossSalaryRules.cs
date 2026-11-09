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

    public static IReadOnlyList<MatchGrossSalaryQuote> Quote(
        BoardDefinition board,
        IReadOnlyList<MatchPlayerSnapshot> players,
        IReadOnlyList<MatchControlledActivitySnapshot> controlledActivities)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(players);
        ArgumentNullException.ThrowIfNull(controlledActivities);
        board.Validate();

        if (players.Count == 0 || players.Any(p => p is null ||
            string.IsNullOrWhiteSpace(p.PlayerId) ||
            p.HenchmenTotal < 0 || p.HenchmenAvailable < 0))
        {
            throw new ArgumentException("Salary requires valid players and nonnegative henchmen.", nameof(players));
        }

        var playerIds = players.Select(p => p.PlayerId).ToHashSet(StringComparer.Ordinal);
        if (playerIds.Count != players.Count)
        {
            throw new ArgumentException("Player IDs must be distinct.", nameof(players));
        }

        var boardSlots = board.Slots.Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
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
