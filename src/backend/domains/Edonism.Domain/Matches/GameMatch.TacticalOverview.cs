namespace Edonism.Domain.Matches;

/// <summary>
/// One actor's three EXISTING first-round PUBLIC tactical projections, captured
/// at a single validated revision. Never grants move, purchase or attack rights.
/// No private card, bearer, wallet, faction or raw checkpoint fields are copied.
/// </summary>
public sealed record MatchTacticalOverview(
    Guid MatchId, string PlayerId, int Round, long VerifiedRevision,
    string FromStreetId,
    MatchUncontrolledRoutes Uncontrolled,
    MatchOtherPlayerRoutes OtherPlayers,
    MatchOpponentControlledLotRoutes OpponentControlledLots);

public sealed partial class GameMatch
{
    /// <summary>
    /// A typed, immutable, read-only composition of #49/#51/#84 projections.
    /// Caller MUST hold the same match lock as mutations (#87). The individual
    /// projections independently verify the first-round audit before returning.
    /// </summary>
    public MatchTacticalOverview? VerifiedTacticalOverviewForActor(string actorId)
    {
        var state = Snapshot();
        var actor = state.Players.FirstOrDefault(p => p.PlayerId == actorId);
        if (actor is null) return null;

        var uncontrolled = VerifiedUncontrolledRoutesForActor(actorId);
        var otherPlayers = VerifiedOtherPlayerRoutesForActor(actorId);
        var opponentLots = VerifiedOpponentControlledLotsForActor(actorId);
        if (uncontrolled is null || otherPlayers is null || opponentLots is null)
            throw new InvalidOperationException("Tactical projection missing an authenticated actor.");

        bool SameScope(Guid id, string playerId, int round, long revision, string street) =>
            id == state.MatchId && playerId == actorId && round == state.Round
            && revision == state.Revision && street == actor.StreetId;

        if (!SameScope(uncontrolled.MatchId, uncontrolled.PlayerId, uncontrolled.Round,
                uncontrolled.VerifiedRevision, uncontrolled.FromStreetId)
            || !SameScope(otherPlayers.MatchId, otherPlayers.PlayerId, otherPlayers.Round,
                otherPlayers.VerifiedRevision, otherPlayers.FromStreetId)
            || !SameScope(opponentLots.MatchId, opponentLots.PlayerId, opponentLots.Round,
                opponentLots.VerifiedRevision, opponentLots.FromStreetId))
            throw new InvalidOperationException("Tactical public projections disagree on actor or revision.");

        return new MatchTacticalOverview(
            state.MatchId, actorId, state.Round, state.Revision, actor.StreetId,
            uncontrolled, otherPlayers, opponentLots);
    }
}
