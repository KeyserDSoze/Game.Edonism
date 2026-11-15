import { hasValidDevelopmentPublicEnvelope } from "./verifiedDevelopmentPublicEnvelope";
import canonicalBoard from "../../../../shared/board/edonism-board.v1.json";

/**
 * #117: Narrow, read-only consistency check for untrusted Development
 * actor-scoped options against the same public snapshot revision.
 * .NET remains the only authority to grant or execute PvP commands.
 * We intentionally DO NOT derive allowable adjacent streets here.
 */
// #124: Check destination membership in the same shared printed board;
// never compute adjacency, grant permissions or trust a client-generated route.
const canonicalStreetIds = new Set(canonicalBoard.streets.map(street => street.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasValidDevelopmentTurnOptions(
  value: unknown, actorId: string, publicState: unknown,
): boolean {
  if (!isRecord(publicState) || typeof publicState.matchId !== "string"
    || !hasValidDevelopmentPublicEnvelope(publicState, publicState.matchId)
    || typeof actorId !== "string" || !actorId.trim() || !isRecord(value)
    || value.matchId !== publicState.matchId || value.playerId !== actorId
    || value.revision !== publicState.revision
    || typeof value.canEndTurn !== "boolean"
    || !Array.isArray(value.freeMoveStreetIds)) return false;

  const seat = publicState.players.find(player => player.playerId === actorId);
  if (!seat) return false;

  const actorHasTurn = publicState.phase === 0 && publicState.activePlayerId === actorId;
  if (value.canEndTurn !== actorHasTurn) return false;
  // Not an actor turn, or free move already consumed: the server cannot
  // advertise any further free-move destinations in the present rules.
  if (!actorHasTurn || seat.freeMoveUsed)
    return value.freeMoveStreetIds.length === 0;

  const seen = new Set<string>();
  for (const destination of value.freeMoveStreetIds) {
    if (typeof destination !== "string" || !destination.trim()
      || !canonicalStreetIds.has(destination)
      || destination === seat.streetId || seen.has(destination))
      return false;
    seen.add(destination);
  }
  return true;
}
