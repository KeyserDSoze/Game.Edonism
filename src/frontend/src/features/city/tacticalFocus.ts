import { shortestStreetPath, slotById } from "./board";
import type { PublicMatchSceneState } from "./activityMarkers";

/**
 * Purely PUBLIC UI exploration. A tactical focus is neither a move nor
 * permission to attack or buy: no secrets, bearer or private cards.
 * Scope is revision-bound so a remote movement invalidates the old route.
 */
export type TacticalFocus = Readonly<{
  kind: "player" | "activity" | "opponent-lot";
  matchId: string;
  revision: number;
  actorId: string;
  targetId: string;
  streetPath: readonly string[];
}>;

/** Fail closed against the current public snapshot and versioned street graph. */
export function verifiedTacticalFocus(
  state: PublicMatchSceneState | null,
  focus: TacticalFocus | null,
): TacticalFocus | null {
  if (!state || !focus || focus.matchId !== state.matchId
    || !Number.isInteger(focus.revision) || focus.revision !== state.revision
    || !Array.isArray(focus.streetPath)) return null;

  const actor = state.players.filter(p => p.playerId === focus.actorId);
  if (actor.length !== 1) return null;

  let targetStreet: string | undefined;
  if (focus.kind === "player") {
    if (focus.targetId === focus.actorId) return null;
    const other = state.players.filter(p => p.playerId === focus.targetId);
    if (other.length !== 1) return null;
    targetStreet = other[0].streetId;
  } else if (focus.kind === "opponent-lot") {
    const owned = state.controlledActivities.filter(lot =>
      lot.slotId === focus.targetId && lot.ownerPlayerId !== focus.actorId);
    if (owned.length !== 1) return null;
    targetStreet = slotById(focus.targetId)?.streetId;
  } else if (focus.kind === "activity") {
    const card = state.boardActivities.filter(a => a.slotId === focus.targetId);
    if (card.length !== 1 || state.controlledActivities.some(
      a => a.slotId === focus.targetId)) return null;
    targetStreet = slotById(focus.targetId)?.streetId;
  } else {
    return null;
  }

  if (!targetStreet) return null;
  const canonical = shortestStreetPath(actor[0].streetId, targetStreet);
  if (!canonical || canonical.length !== focus.streetPath.length
    || focus.streetPath.some((id, index) => id !== canonical[index])) return null;

  return { ...focus, streetPath: Object.freeze([...canonical]) };
}
