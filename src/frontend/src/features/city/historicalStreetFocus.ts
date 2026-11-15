import { streetById } from "./board";
import type { PublicMatchSceneState } from "./activityMarkers";

/** Display-only location from an actor-scoped public replay, never a command. */
export type HistoricalStreetFocus = Readonly<{
  matchId: string;
  sourceRevision: number;
  historyRevision: number;
  playerId: string;
  streetId: string;
}>;

/**
 * Fail closed against the live public match. The lab separately verifies
 * player/street against the selected history frame and seat-token lease.
 * Only .NET MatchAuditReplay is authoritative for historical transitions.
 */
export function verifiedHistoricalStreetFocus(
  state: PublicMatchSceneState | null,
  requested: HistoricalStreetFocus | null,
): HistoricalStreetFocus | null {
  // #110: the root React component may receive malformed public JSON while
  // a focus is active. Never dereference unvalidated array entries.
  if (!state || !requested || typeof requested !== "object"
    || typeof state.matchId !== "string"
    || requested.matchId !== state.matchId
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(requested.sourceRevision)
    || requested.sourceRevision !== state.revision
    || !Number.isSafeInteger(requested.historyRevision)
    || requested.historyRevision < 0
    || requested.historyRevision > requested.sourceRevision
    || typeof requested.playerId !== "string" || !requested.playerId.trim()
    || typeof requested.streetId !== "string" || !streetById(requested.streetId)
    || !Array.isArray(state.players)) return null;

  const ids = new Set<string>();
  for (const player of state.players) {
    if (!player || typeof player.playerId !== "string"
      || !player.playerId.trim() || ids.has(player.playerId)
      || typeof player.streetId !== "string" || !streetById(player.streetId))
      return null;
    ids.add(player.playerId);
  }
  if (!ids.has(requested.playerId)) return null;
  return Object.freeze({ ...requested });
}
