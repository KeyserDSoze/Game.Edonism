using Edonism.Domain.World;

namespace Edonism.Domain.Matches;

/// <summary>
/// INTERNAL secret aggregate checkpoint. Never serialize this as an HTTP response.
/// Format v1 covers ONLY the existing first round movement and initial private deck.
/// </summary>
public sealed record GameMatchCheckpoint(int FormatVersion, MatchSnapshot State, InitialActionDeal? PrivateDeal);

public sealed partial class GameMatch
{
    public const int CheckpointVersion = 1;

    /// <summary>Deep copy including PRIVATE hands and remaining pile; for trusted storage only.</summary>
    public GameMatchCheckpoint CaptureCheckpoint()
    {
        var deal = _initialActionDeal is null ? null : CopyDeal(_initialActionDeal);
        return new GameMatchCheckpoint(CheckpointVersion, Snapshot(), deal);
    }

    private static InitialActionDeal CopyDeal(InitialActionDeal deal) => new(
        deal.AlgorithmVersion, deal.Seed,
        Array.AsReadOnly(deal.Hands.Select(h => new InitialActionHand(
            h.PlayerId, Array.AsReadOnly(h.CardIds.ToArray()))).ToArray()),
        Array.AsReadOnly(deal.RemainingDrawPile.ToArray()));

    /// <summary>
    /// Restore is a TRUST BOUNDARY: reject incomplete, old, inconsistent or
    /// altered data before creating a usable aggregate. The public audit is
    /// checked independently against the canonical board and initial slots.
    /// </summary>
    public static GameMatch RestoreFromCheckpoint(BoardDefinition board, GameMatchCheckpoint checkpoint)
    {
        ArgumentNullException.ThrowIfNull(board);
        ArgumentNullException.ThrowIfNull(checkpoint);
        board.Validate();
        var s = checkpoint.State;
        if (checkpoint.FormatVersion != CheckpointVersion || s is null
            || s.MatchId == Guid.Empty || s.BoardVersion != board.Version
            || !Enum.IsDefined(s.Phase)
            || s.Round != 1 || s.TurnOrder is null || s.Players is null
            || s.Events is null || s.ControlledActivities is null
            || s.BoardActivities is null || s.AssignedCharacters is null
            || s.GrossSalaryQuotes is null
            || s.Players.Count is < 2 or > MaxPrintedPlayers)
            throw new InvalidDataException("Unsupported or incomplete match checkpoint.");

        var replay = MatchAuditReplay.Verify(board, s);
        if (!replay.IsValid)
            throw new InvalidDataException($"Checkpoint audit rejected: {replay.Code}.");

        var participants = s.Players;
        var slotIds = board.Slots.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        var playerIds = participants.Select(p => p.PlayerId).ToHashSet(StringComparer.Ordinal);
        if (playerIds.Count != participants.Count
            || participants.Select(p => p.StartingSlotId).Distinct(StringComparer.Ordinal).Count() != participants.Count
            || participants.Any(p => p.Atoms != InitialAtoms || p.DiplomacyTokens != InitialDiplomacyTokens
                || p.HenchmenTotal != TotalHenchmen || p.HenchmenAvailable != TotalHenchmen - 1
                || !slotIds.Contains(p.StartingSlotId)))
            throw new InvalidDataException("Checkpoint participant resources or positions invalid.");

        if (s.ControlledActivities.Count != participants.Count
            || s.ControlledActivities.Any(c => c is null || c.Posture != HenchmanPosture.Standing
                || !playerIds.Contains(c.OwnerPlayerId)
                || !participants.Any(p => p.PlayerId == c.OwnerPlayerId && p.StartingSlotId == c.SlotId))
            || s.ControlledActivities.Select(c => c.OwnerPlayerId).Distinct(StringComparer.Ordinal).Count() != participants.Count)
            throw new InvalidDataException("Checkpoint control/henchman count inconsistent.");

        if (s.BoardActivities.Count != 0 && s.BoardActivities.Count != BoardDefinition.PrintedActivitySlotCount)
            throw new InvalidDataException("Checkpoint has an incomplete activity board.");
        if (s.BoardActivities.Any(c => c is null || string.IsNullOrWhiteSpace(c.CardId)
            || string.IsNullOrWhiteSpace(c.Category) || !slotIds.Contains(c.SlotId))
            || s.BoardActivities.Select(c => c.SlotId).Distinct(StringComparer.Ordinal).Count() != s.BoardActivities.Count
            || s.BoardActivities.Select(c => c.CardId).Distinct(StringComparer.Ordinal).Count() != s.BoardActivities.Count)
            throw new InvalidDataException("Checkpoint public activity placement invalid.");

        // The trusted v1 composers already enforce the eight printed category
        // quotas. Restore must not accept an otherwise complete 30-slot board
        // with invented categories or shifted counts. A 0-card legacy fixture
        // is a separate Development-only setup and remains supported.
        if (s.BoardActivities.Count != 0
            && (s.BoardActivities.Any(c =>
                    !ActivityPlacement.PrintedCategoryQuotas.ContainsKey(c.Category))
                || ActivityPlacement.PrintedCategoryQuotas.Any(quota =>
                    s.BoardActivities.Count(c => c.Category == quota.Key) != quota.Value)))
            throw new InvalidDataException("Checkpoint activity category quotas invalid.");
        if (s.AssignedCharacters.Count != 0 && s.AssignedCharacters.Count != participants.Count)
            throw new InvalidDataException("Checkpoint character assignments incomplete.");
        // Legacy slot/card-only Development fixtures have no character hearts.
        // Each drawn character is one physical card, with 1-5 printed hearts.
        if ((s.AssignedCharacters.Count == 0 && participants.Any(p => p.Hearts is not null))
            || s.AssignedCharacters.Any(a => a is null)
            || s.AssignedCharacters.Select(a => a.CharacterId)
                .Distinct(StringComparer.Ordinal).Count() != s.AssignedCharacters.Count)
            throw new InvalidDataException("Checkpoint character assignment mismatch.");
        if (s.AssignedCharacters.Any(a => a is null
            || !playerIds.Contains(a.PlayerId)
            || string.IsNullOrWhiteSpace(a.CharacterId)
            || string.IsNullOrWhiteSpace(a.StartingActivityCardId)
            || a.PrintedInitialHearts is < 1 or > 5
            || !s.BoardActivities.Any(c => c.CardId == a.StartingActivityCardId
                && participants.Any(p => p.PlayerId == a.PlayerId && p.StartingSlotId == c.SlotId))
            || participants.All(p => p.PlayerId != a.PlayerId || p.Hearts != a.PrintedInitialHearts))
            || s.AssignedCharacters.Select(a => a.PlayerId).Distinct(StringComparer.Ordinal).Count() != s.AssignedCharacters.Count)
            throw new InvalidDataException("Checkpoint character assignment mismatch.");

        // The unplayed 59-card deck is PRIVATE and must be complete and disjoint.
        var privateDeal = checkpoint.PrivateDeal;
        if (privateDeal is not null)
        {
            if (privateDeal.AlgorithmVersion != InitialActionDeckComposer.AlgorithmVersion
                || s.AssignedCharacters.Count != participants.Count
                || privateDeal.Hands is null || privateDeal.RemainingDrawPile is null
                || privateDeal.Hands.Count != participants.Count
                || privateDeal.Hands.Any(h => h is null || !playerIds.Contains(h.PlayerId)
                    || h.CardIds is null || h.CardIds.Count != InitialActionDeckComposer.CardsPerPlayer
                    || h.CardIds.Any(string.IsNullOrWhiteSpace))
                || privateDeal.Hands.Select(h => h.PlayerId).Distinct(StringComparer.Ordinal).Count() != participants.Count
                || privateDeal.RemainingDrawPile.Any(string.IsNullOrWhiteSpace))
                throw new InvalidDataException("Checkpoint private hands invalid.");

            var cards = privateDeal.Hands.SelectMany(h => h.CardIds)
                .Concat(privateDeal.RemainingDrawPile).ToArray();
            if (cards.Length != InitialActionDeckComposer.PrintedActionCardCount + 1
                || cards.Distinct(StringComparer.Ordinal).Count() != cards.Length)
                throw new InvalidDataException("Checkpoint private deck incomplete or duplicated.");

            // A structurally complete 59-card checkpoint can still silently
            // swap hands or reorder the hidden draw pile. Reconstruct the
            // exact original permutation for the recorded seed and seat order
            // before granting any restored actor access to private cards.
            if (!InitialActionDeckComposer.MatchesRecordedShuffle(privateDeal, s.TurnOrder))
                throw new InvalidDataException("Checkpoint private deal does not match its recorded shuffle.");
        }

        var expectedQuotes = GrossSalaryRules.Quote(board, participants, s.ControlledActivities);
        if (!expectedQuotes.SequenceEqual(s.GrossSalaryQuotes))
            throw new InvalidDataException("Checkpoint salary quote differs from the Domain.");

        // The constructor does not trust any publicly computed player coordinates.
        // The audit above validates each position against the first-round events.
        var restored = new GameMatch(s.MatchId, board,
            participants.ToList(), s.ControlledActivities.ToList(),
            s.BoardActivities.ToArray(), s.AssignedCharacters.ToArray(),
            privateDeal is null ? null : CopyDeal(privateDeal));
        restored._events.Clear();
        restored._events.AddRange(s.Events);
        restored.Revision = s.Revision;
        restored.Phase = s.Phase;
        restored._turnIndex = s.Phase == MatchPhase.AwaitingRoundSettlement
            ? s.TurnOrder.Count - 1
            : s.TurnOrder.ToList().IndexOf(s.ActivePlayerId!);

        if (restored._turnIndex < 0 || !restored.VerifyPublicAudit().IsValid)
            throw new InvalidDataException("Checkpoint restoration did not match the public audit.");
        return restored;
    }
}
