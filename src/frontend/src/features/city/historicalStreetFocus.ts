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
  if (!state || !requested || requested.matchId !== state.matchId
    || !Number.isSafeInteger(requested.sourceRevision)
    || requested.sourceRevision !== state.revision
    || !Number.isSafeInteger(requested.historyRevision)
    || requested.historyRevision < 0
    || requested.historyRevision > requested.sourceRevision
    || state.players.filter(p => p.playerId === requested.playerId).length !== 1
    || !streetById(requested.streetId)) return null;

  return Object.freeze({ ...requested });
}
