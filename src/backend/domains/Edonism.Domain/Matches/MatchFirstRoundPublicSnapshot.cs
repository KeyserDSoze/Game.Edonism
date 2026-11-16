using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>
/// Pure public-only verification of the setup facts which CANNOT change
/// during the currently implemented first-round free-move/end-turn commands.
/// This is not a verifier for private hands, taxes, votes, damage, or powers.
/// </summary>
internal static class MatchFirstRoundPublicSnapshot
{
    private const int InitialAtoms = 4;
    private const int InitialDiplomacyTokens = 2;
    private const int PrintedHenchmen = 16;

    /// <returns>Null when the whole public first-round setup is valid; an
    /// opaque audit code otherwise. Never returns a partial projection.</returns>
    public static string? Validate(BoardDefinition board, MatchSnapshot snapshot)
    {
        // A caller may construct a forged MatchSnapshot with null collections
        // despite the non-nullable C# record signature (e.g. untrusted JSON).
        if (snapshot.Players is null || snapshot.ControlledActivities is null
            || snapshot.BoardActivities is null || snapshot.AssignedCharacters is null
            || snapshot.GrossSalaryQuotes is null || snapshot.TurnOrder is null
            || snapshot.Players.Count is < 2 or > 8)
            return "invalid_public_setup";

        // The ONLY implemented first-round mutations are free movement and
        // finishing a turn. No atoms, political tokens, hearts or henchmen are
        // spent, received, lost or deployed by those two commands.
        if (snapshot.Players.Any(player => player is null
                || !MatchParticipantId.IsValid(player.PlayerId)
                || player.Atoms != InitialAtoms
                || player.DiplomacyTokens != InitialDiplomacyTokens
                || player.HenchmenTotal != PrintedHenchmen
                || player.HenchmenAvailable != PrintedHenchmen - 1))
            return "invalid_public_resources";

        var byPlayer = snapshot.Players.ToDictionary(player => player.PlayerId,
            StringComparer.Ordinal);
        var printedSlots = board.Slots.Select(slot => slot.Id)
            .ToHashSet(StringComparer.Ordinal);

        // Exactly one initial standing occupied lot per player; in this
        // first-round command subset, ownership/posture never changes.
        if (snapshot.ControlledActivities.Count != snapshot.Players.Count
            || snapshot.ControlledActivities.Any(lot => lot is null
                || !printedSlots.Contains(lot.SlotId)
                || !byPlayer.TryGetValue(lot.OwnerPlayerId, out var player)
                || player.StartingSlotId != lot.SlotId
                || lot.Posture != HenchmanPosture.Standing)
            || snapshot.ControlledActivities.Select(lot => lot.SlotId)
                .Distinct(StringComparer.Ordinal).Count() != snapshot.Players.Count
            || snapshot.ControlledActivities.Select(lot => lot.OwnerPlayerId)
                .Distinct(StringComparer.Ordinal).Count() != snapshot.Players.Count)
            return "invalid_public_controls";

        // The genuine Development setups either have NO activity cards (the
        // legacy movement fixture) or exactly 30 face-up physical cards.
        // A partial, fake or quota-shifted board cannot be audit-verified.
        var activities = snapshot.BoardActivities;
        if (activities.Count is not (0 or BoardDefinition.PrintedActivitySlotCount)
            || activities.Any(card => card is null
                || !printedSlots.Contains(card.SlotId)
                || string.IsNullOrWhiteSpace(card.CardId)
                || !ActivityPlacement.PrintedCategoryQuotas.ContainsKey(card.Category))
            || activities.Select(card => card.SlotId)
                .Distinct(StringComparer.Ordinal).Count() != activities.Count
            || activities.Select(card => card.CardId)
                .Distinct(StringComparer.Ordinal).Count() != activities.Count)
            return "invalid_public_placement";

        if (activities.Count != 0
            && ActivityPlacement.PrintedCategoryQuotas.Any(quota =>
                activities.Count(card => card.Category == quota.Key) != quota.Value))
            return "invalid_public_placement";

        // Character IDs, hearts and linked starting activity are public, not
        // the secret action deck. 0 characters is valid only with null hearts.
        var assigned = snapshot.AssignedCharacters;
        if (assigned.Count == 0)
        {
            if (snapshot.Players.Any(player => player.Hearts is not null))
                return "invalid_public_characters";
        }
        else
        {
            if (assigned.Count != snapshot.Players.Count
                || activities.Count != BoardDefinition.PrintedActivitySlotCount
                || assigned.Any(character => character is null
                    || !byPlayer.TryGetValue(character.PlayerId, out var player)
                    || string.IsNullOrWhiteSpace(character.CharacterId)
                    || character.PrintedInitialHearts is < 1 or > 5
                    || player.Hearts != character.PrintedInitialHearts
                    || !activities.Any(card => card.SlotId == player.StartingSlotId
                        && card.CardId == character.StartingActivityCardId))
                || assigned.Select(character => character.PlayerId)
                    .Distinct(StringComparer.Ordinal).Count() != snapshot.Players.Count
                || assigned.Select(character => character.CharacterId)
                    .Distinct(StringComparer.Ordinal).Count() != snapshot.Players.Count)
                return "invalid_public_characters";
        }

        // Validate and reconstruct independently rather than trusting a
        // client-supplied GrossAtoms number. The quote is NOT a payment.
        IReadOnlyList<MatchGrossSalaryQuote> expected;
        try
        {
            expected = GrossSalaryRules.Quote(
                board, snapshot.Players, snapshot.ControlledActivities);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return "invalid_public_salary";
        }
        if (!expected.SequenceEqual(snapshot.GrossSalaryQuotes))
            return "invalid_public_salary";

        return null;
    }
}
