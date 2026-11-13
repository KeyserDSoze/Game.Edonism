/**
 * #100: pure all-or-nothing scope guard for PUBLIC tactical overview payloads.
 *
 * Call only after the current browser bearer, actor and revision race guards.
 * This is not authorization and never checks private cards, movement or combat.
 * Deep #49/#51/#84 route/owner/path validations remain mandatory in the caller.
 */
export type PublicTacticalScope = Readonly<{
  matchId: string;
  playerId: string;
  round: number;
  verifiedRevision: number;
  fromStreetId: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A single missing, forged, cross-actor or stale nested scope invalidates the
 * *entire* atomic public view, before any scouting widget can be rendered.
 * No throws for null, array, primitive or malformed server JSON values.
 */
export function hasAtomicPublicTacticalScope(
  response: unknown,
  expected: PublicTacticalScope,
): boolean {
  const matches = (value: unknown): value is Record<string, unknown> =>
    isRecord(value)
    && value.matchId === expected.matchId
    && value.playerId === expected.playerId
    && value.round === expected.round
    && value.verifiedRevision === expected.verifiedRevision
    && value.fromStreetId === expected.fromStreetId;

  return matches(response)
    && matches(response.uncontrolled)
    && matches(response.otherPlayers)
    && matches(response.opponentControlledLots);
}
