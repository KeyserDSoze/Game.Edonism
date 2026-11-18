namespace Edonism.Domain.Matches;

/// <summary>
/// Own-seat private inspection only. Never contains the special card's raw
/// physical ID, another player's cards, an undealt pile or a voting action.
/// A null ownHandIndex is NOT proof of absence when classificationAvailable
/// is false (older v1 private checkpoints).
/// </summary>
public sealed record MatchOwnElectionDayInspection(
    Guid MatchId, string PlayerId, long VerifiedRevision,
    bool ClassificationAvailable, int? OwnHandIndex);

public sealed partial class GameMatch
{
    /// <summary>
    /// First-round, actor-bound projection of a typed card in the requesting
    /// actor's own four-card hand ONLY. The Development store must resolve
    /// actorId from the authenticated bearer before calling this method.
    /// </summary>
    public MatchOwnElectionDayInspection? InspectOwnElectionDayForActor(string actorId)
    {
        if (!MatchParticipantId.IsValid(actorId) || _initialActionDeal is null)
            return null;
        var hand = _initialActionDeal.Hands.FirstOrDefault(
            h => string.Equals(h.PlayerId, actorId, StringComparison.Ordinal));
        if (hand is null) return null;
        var verified = MatchAuditReplay.Verify(_board, Snapshot());
        if (!verified.IsValid)
            throw new InvalidOperationException("Cannot inspect an unverified match.");

        var marker = _initialActionDeal.ElectionDayCardId;
        // Null marker is only legitimate for checkpoint v1, whose original
        // 59 opaque IDs cannot reveal the printed type after the fact.
        if (marker is null)
            return new MatchOwnElectionDayInspection(
                MatchId, actorId, verified.VerifiedRevision, false, null);

        // Trust the typed ID solely as recorded at setup and authenticated
        // during checkpoint restore. Never send the ID (or a global position)
        // to clients. An owner may inspect only their own card's 0..3 index.
        var index = -1;
        for (var i = 0; i < hand.CardIds.Count; i++)
            if (string.Equals(hand.CardIds[i], marker, StringComparison.Ordinal))
            {
                index = i;
                break;
            }
        return new MatchOwnElectionDayInspection(
            MatchId, actorId, verified.VerifiedRevision, true,
            index < 0 ? null : index);
    }
}
