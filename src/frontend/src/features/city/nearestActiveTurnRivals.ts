import {
  verifiedActiveTurnRivalProximity,
  type PublicTurnRivalProximity,
} from "./activeTurnRivalProximity";

/**
 * #148: All PUBLIC opponents tied at the lowest verified street-hop count
 * from the server-declared turn owner. Never cap the results; a full eight-
 * seat match may have seven rivals sharing the same street.
 *
 * This is a read-only city scouting shortcut, NOT an attack range, a move
 * permission, faction inference, or an authenticated player capability.
 */
export type NearestActiveTurnRival = PublicTurnRivalProximity & Readonly<{
  playerId: string;
}>;

export function verifiedNearestActiveTurnRivals(
  snapshot: unknown,
): readonly NearestActiveTurnRival[] {
  // Reuse the whole-roster fail-closed #147 validator, not an independently
  // filtered subset that might silently ignore a fake player/street.
  const all = verifiedActiveTurnRivalProximity(snapshot);
  if (all.size === 0) return [];

  let minimum = Number.POSITIVE_INFINITY;
  for (const route of all.values()) {
    if (!Number.isSafeInteger(route.streetSteps) || route.streetSteps < 0)
      return [];
    minimum = Math.min(minimum, route.streetSteps);
  }
  return [...all.entries()]
    .filter(([, route]) => route.streetSteps === minimum)
    .map(([playerId, route]) => ({ playerId, ...route }))
    // Technical player IDs are ordinal, not case-folded or localized.
    .sort((a, b) => a.playerId < b.playerId ? -1
      : a.playerId > b.playerId ? 1 : 0);
}
