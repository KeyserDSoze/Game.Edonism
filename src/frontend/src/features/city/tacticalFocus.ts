import { shortestStreetPath, slotById, streetById } from "./board";
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

/**
 * #110: TypeScript does not validate network JSON. Before a root React
 * overlay is shown, check every public seat and visible card/control record.
 * Never guess a target from an ambiguous or malformed public snapshot.
 */
export function verifiedTacticalFocus(
  state: PublicMatchSceneState | null,
  focus: TacticalFocus | null,
): TacticalFocus | null {
  if (!state || typeof state.matchId !== "string"
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Array.isArray(state.players)
    || !Array.isArray(state.boardActivities)
    || !Array.isArray(state.controlledActivities)
    || !focus || typeof focus !== "object"
    || typeof focus.matchId !== "string"
    || focus.matchId !== state.matchId
    || !Number.isSafeInteger(focus.revision) || focus.revision !== state.revision
    || typeof focus.actorId !== "string" || !focus.actorId.trim()
    || typeof focus.targetId !== "string" || !focus.targetId.trim()
    || !Array.isArray(focus.streetPath)) return null;

  const players = new Map<string, string>();
  for (const player of state.players) {
    if (!player || typeof player.playerId !== "string"
      || !player.playerId.trim() || players.has(player.playerId)
      || typeof player.streetId !== "string" || !streetById(player.streetId))
      return null;
    players.set(player.playerId, player.streetId);
  }
  const origin = players.get(focus.actorId);
  if (!origin) return null;

  const cards = new Map<string, number>();
  for (const card of state.boardActivities) {
    if (!card || typeof card.slotId !== "string" || !slotById(card.slotId)
      || typeof card.cardId !== "string" || !card.cardId.trim()
      || typeof card.category !== "string" || !card.category.trim())
      return null;
    cards.set(card.slotId, (cards.get(card.slotId) ?? 0) + 1);
    if (cards.get(card.slotId) !== 1) return null;
  }

  const controls = new Map<string, { ownerPlayerId: string; posture: number }>();
  for (const control of state.controlledActivities) {
    if (!control || typeof control.slotId !== "string" || !slotById(control.slotId)
      || controls.has(control.slotId) || cards.get(control.slotId) !== 1
      || typeof control.ownerPlayerId !== "string"
      || !players.has(control.ownerPlayerId)
      || (control.posture !== 0 && control.posture !== 1)) return null;
    controls.set(control.slotId, control);
  }

  let targetStreet: string | undefined;
  if (focus.kind === "player") {
    if (focus.targetId === focus.actorId) return null;
    targetStreet = players.get(focus.targetId);
  } else if (focus.kind === "opponent-lot") {
    const owned = controls.get(focus.targetId);
    if (!owned || owned.ownerPlayerId === focus.actorId) return null;
    targetStreet = slotById(focus.targetId)?.streetId;
  } else if (focus.kind === "activity") {
    if (cards.get(focus.targetId) !== 1 || controls.has(focus.targetId)) return null;
    targetStreet = slotById(focus.targetId)?.streetId;
  } else return null;

  if (!targetStreet) return null;
  const canonical = shortestStreetPath(origin, targetStreet);
  if (!canonical || canonical.length !== focus.streetPath.length
    || focus.streetPath.some((id, index) => id !== canonical[index])) return null;

  return { ...focus, streetPath: Object.freeze([...canonical]) };
}
