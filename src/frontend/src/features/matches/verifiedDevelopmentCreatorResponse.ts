import { hasValidDevelopmentPublicEnvelope } from "./verifiedDevelopmentPublicEnvelope";
import { hasValidDevelopmentPublicAuditChronology } from "./verifiedDevelopmentPublicAuditChronology";

/**
 * #114: The Development creator response must bind one UNIQUE, typed 64-hex
 * bearer to each declared synthetic seat before touching actor/session state.
 * This is not Production authentication and never stores or logs tokens.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const hexBearer = /^[0-9a-f]{64}$/i;
const matchIdFormat = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function hasValidDevelopmentCreatorResponse(
  value: unknown, requestedSeatIds: readonly string[],
): boolean {
  if (!isRecord(value) || typeof value.matchId !== "string"
    || !matchIdFormat.test(value.matchId)
    || !Array.isArray(requestedSeatIds)
    || requestedSeatIds.length < 2 || requestedSeatIds.length > 8
    || !Array.isArray(value.credentials)
    || value.credentials.length !== requestedSeatIds.length) return false;

  const requested = new Set<string>();
  for (const id of requestedSeatIds) {
    if (typeof id !== "string" || !id.trim() || requested.has(id))
      return false;
    requested.add(id);
  }
  const state = value.state;
  if (!hasValidDevelopmentPublicEnvelope(state, value.matchId)
    // A forged creator 201 must not bind credentials to a fake audit revision.
    || !hasValidDevelopmentPublicAuditChronology(state, value.matchId)
    || state.players.length !== requested.size
    || state.players.some(player => !requested.has(player.playerId))) return false;

  const seenSeats = new Set<string>();
  const seenTokens = new Set<string>();
  for (const raw of value.credentials) {
    if (!isRecord(raw) || typeof raw.playerId !== "string"
      || !requested.has(raw.playerId) || seenSeats.has(raw.playerId)
      || typeof raw.token !== "string" || !hexBearer.test(raw.token))
      return false;
    const tokenId = raw.token.toLowerCase();
    if (seenTokens.has(tokenId)) return false;
    seenSeats.add(raw.playerId);
    seenTokens.add(tokenId);
  }
  return seenSeats.size === requested.size;
}
