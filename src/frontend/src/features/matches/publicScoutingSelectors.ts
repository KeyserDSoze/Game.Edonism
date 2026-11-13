/**
 * #99 — pure READ-ONLY client display selectors for verified public PvP scouting.
 *
 * The caller MUST first validate the complete actor/token/match/round/revision
 * scoped #88 tactical overview. No auth/validation/network/geometry/state lives
 * here. These functions never grant movement, purchases, attacks or PvP rights.
 */
export type PublicScoutingLot = Readonly<{
  slotId: string;
  ownerPlayerId: string;
  posture: number;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
}>;

export type PublicScoutingOther = Readonly<{ otherPlayerId: string }>;
export type PublicScoutingStreet = Readonly<{ id: string; name: string }>;

export type PublicScoutingFilters = Readonly<{
  ownerId: string;
  streetId: string;
  nearbyOnly: boolean;
  posture: "all" | "standing" | "fallen";
}>;

export function selectPublicScoutingView<
  TOther extends PublicScoutingOther,
  TLot extends PublicScoutingLot,
>(
  verifiedOtherSeats: readonly TOther[],
  verifiedOpponentLots: readonly TLot[],
  canonicalStreets: readonly PublicScoutingStreet[],
  filters: PublicScoutingFilters,
) {
  // Prefer public verified seat IDs and immutable canonical board street IDs.
  // Invalid local preferences fall back to "all", never a guessed principal.
  const selectedOpponentOwner = verifiedOtherSeats.some(seat =>
    seat.otherPlayerId === filters.ownerId) ? filters.ownerId : "";
  const selectedOpponentStreet = canonicalStreets.some(street =>
    street.id === filters.streetId) ? filters.streetId : "";

  // Server route order is already canonical: do not sort, alter paths or
  // infer an action permission from display distance or posture.
  const visibleOpponentLots = verifiedOpponentLots.filter(route =>
    (!selectedOpponentOwner || route.ownerPlayerId === selectedOpponentOwner)
    && (!selectedOpponentStreet || route.streetId === selectedOpponentStreet)
    && (!filters.nearbyOnly || route.streetSteps <= 1)
    && (filters.posture === "all"
      || route.posture === (filters.posture === "standing" ? 0 : 1)));

  // Always aggregate the COMPLETE verified public route set, not the filtered
  // list; street order and owner order follow public board/roster respectively.
  const rivalLotStreetDistribution = canonicalStreets.map(street => {
    const onStreet = verifiedOpponentLots.filter(route =>
      route.streetId === street.id);
    return {
      streetId: street.id,
      name: street.name,
      total: onStreet.length,
      standing: onStreet.filter(route => route.posture === 0).length,
      fallen: onStreet.filter(route => route.posture === 1).length,
      owners: verifiedOtherSeats.map(seat => {
        const held = onStreet.filter(route =>
          route.ownerPlayerId === seat.otherPlayerId);
        return {
          ownerId: seat.otherPlayerId,
          total: held.length,
          standing: held.filter(route => route.posture === 0).length,
          fallen: held.filter(route => route.posture === 1).length,
        };
      }).filter(owner => owner.total > 0),
    };
  });

  // Keep every verified other seat, including those with no visible lots.
  // The first matching route is already the server-verified nearest one.
  const nearestVisibleLotByRival = verifiedOtherSeats.map(other => ({
    otherPlayerId: other.otherPlayerId,
    playerRoute: other,
    route: visibleOpponentLots.find(route =>
      route.ownerPlayerId === other.otherPlayerId) ?? null,
  }));

  return {
    selectedOpponentOwner,
    selectedOpponentStreet,
    visibleOpponentLots,
    rivalLotStreetDistribution,
    nearestVisibleLotByRival,
  };
}
