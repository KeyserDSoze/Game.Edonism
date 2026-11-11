import { isAdjacentStreet, streetById } from "@/features/city/board";
import type { PublicMatchEvent } from "./publicAudit";

/** Only the already-public first-round movement/turn subset. No private hands. */
export type PublicHistoryPlayer = Readonly<{
  playerId: string;
  streetId: string;
  freeMoveUsed: boolean;
}>;
export type PublicHistoryFrame = Readonly<{
  revision: number;
  kind: string;
  actorId: string;
  phase: number;
  activePlayerId: string | null;
  players: readonly PublicHistoryPlayer[];
}>;
export type PublicHistory = Readonly<{
  matchId: string;
  verifiedRevision: number;
  frames: readonly PublicHistoryFrame[];
}>;
export type PublicHistoryMatch = Readonly<{
  matchId: string;
  revision: number;
  round: number;
  phase: number;
  activePlayerId: string | null;
  turnOrder: readonly string[];
  players: readonly PublicHistoryPlayer[];
  events: readonly PublicMatchEvent[];
}>;

/**
 * Defense in depth for the read-only Development replay (#55).
 * Reconstructs genesis BACKWARDS from authoritative public live positions,
 * then plays every public event forwards while comparing EVERY history frame.
 * This does not authorize a move, replace the .NET verifier or expose secrets.
 * Unknown future event types fail closed until a versioned contract exists.
 */
export function verifiedPublicHistory(
  state: PublicHistoryMatch,
  history: PublicHistory | null,
): PublicHistory | null {
  if (!state || !history || history.matchId !== state.matchId
    || state.round !== 1 || !Number.isSafeInteger(state.revision)
    || state.revision < 0 || history.verifiedRevision !== state.revision
    || !Array.isArray(state.players) || !Array.isArray(state.turnOrder)
    || !Array.isArray(state.events) || !Array.isArray(history.frames)
    || state.players.length < 2 || state.players.length > 8
    || state.turnOrder.length !== state.players.length
    || state.events.length !== state.revision + 1
    || history.frames.length !== state.events.length) return null;

  const ordered = state.turnOrder;
  const ids = new Set(ordered);
  if (ids.size !== ordered.length || ordered.some(id => typeof id !== "string" || !id)
    || new Set(state.players.map(p => p?.playerId)).size !== ordered.length) return null;

  const positions = new Map<string, string>();
  const moved = new Map<string, boolean>();
  for (const player of state.players) {
    if (!player || !ids.has(player.playerId)
      || typeof player.streetId !== "string" || !streetById(player.streetId)
      || typeof player.freeMoveUsed !== "boolean") return null;
    positions.set(player.playerId, player.streetId);
    moved.set(player.playerId, player.freeMoveUsed);
  }
  if (positions.size !== ordered.length) return null;

  // Reverse current public events to a unique genesis. This also catches
  // forged current positions, unknown edges and repeated free moves.
  for (let index = state.events.length - 1; index >= 1; index--) {
    const event = state.events[index];
    if (!event || event.revision !== index || event.round !== 1
      || !ids.has(event.actorId)) return null;
    if (event.kind === "free-move") {
      if (!event.fromStreetId || !event.toStreetId
        || !isAdjacentStreet(event.fromStreetId, event.toStreetId)
        || positions.get(event.actorId) !== event.toStreetId
        || moved.get(event.actorId) !== true) return null;
      positions.set(event.actorId, event.fromStreetId);
      moved.set(event.actorId, false);
    } else if (event.kind === "turn-ended" || event.kind === "round-settlement-pending") {
      if (event.fromStreetId !== null || event.toStreetId !== null) return null;
    } else {
      return null;
    }
  }
  if (ordered.some(id => moved.get(id) !== false)) return null;

  const genesis = state.events[0];
  if (!genesis || genesis.revision !== 0 || genesis.round !== 1
    || genesis.kind !== "match-created" || genesis.actorId !== "system"
    || genesis.fromStreetId !== null || genesis.toStreetId !== null) return null;

  let turnIndex = 0;
  let phase = 0;
  const matchesFrame = (index: number): boolean => {
    const frame = history.frames[index];
    const event = state.events[index];
    return Boolean(frame && event && frame.revision === index
      && frame.kind === event.kind && frame.actorId === event.actorId
      && frame.phase === phase
      && frame.activePlayerId === (phase === 0 ? ordered[turnIndex] : null)
      && Array.isArray(frame.players) && frame.players.length === ordered.length
      && frame.players.every((p, i) => p && p.playerId === ordered[i]
        && p.streetId === positions.get(ordered[i])
        && p.freeMoveUsed === moved.get(ordered[i])));
  };

  if (!matchesFrame(0)) return null;
  for (let index = 1; index < state.events.length; index++) {
    const event = state.events[index];
    if (phase !== 0 || event.actorId !== ordered[turnIndex]) return null;
    if (event.kind === "free-move") {
      if (moved.get(event.actorId) || positions.get(event.actorId) !== event.fromStreetId
        || !event.fromStreetId || !event.toStreetId
        || !isAdjacentStreet(event.fromStreetId, event.toStreetId)) return null;
      positions.set(event.actorId, event.toStreetId);
      moved.set(event.actorId, true);
    } else if (event.kind === "turn-ended") {
      if (turnIndex === ordered.length - 1) return null;
      turnIndex++;
    } else if (event.kind === "round-settlement-pending") {
      if (turnIndex !== ordered.length - 1) return null;
      phase = 1;
    } else {
      return null;
    }
    if (!matchesFrame(index)) return null;
  }

  if (state.phase !== phase
    || state.activePlayerId !== (phase === 0 ? ordered[turnIndex] : null)
    || state.players.some(p => p.streetId !== positions.get(p.playerId)
      || p.freeMoveUsed !== moved.get(p.playerId))) return null;

  // The caller only publishes this all-or-nothing result for the current
  // match/seat/token/revision. Never synthesize game state or authorization.
  return history;
}
