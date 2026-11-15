/**
 * #118: Development first-round private hand response integrity.
 *
 * The current trusted full-deck fixture deals exactly four unique card IDs
 * per actor, without replacement. This is intentionally NOT a general
 * Production/card-play hand-size rule.
 *
 * Tokens and the draw pile must never be inspected, logged or persisted here.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const InitialDevelopmentHandSize = 4;

export function hasValidDevelopmentFirstRoundHand(
  value: unknown,
  expectedMatchId: string,
  expectedActorId: string,
): boolean {
  if (!isRecord(value)
    || typeof expectedMatchId !== "string" || !expectedMatchId.trim()
    || typeof expectedActorId !== "string" || !expectedActorId.trim()
    || value.matchId !== expectedMatchId
    || value.playerId !== expectedActorId
    || !Array.isArray(value.cardIds)
    || value.cardIds.length !== InitialDevelopmentHandSize)
    return false;

  const seen = new Set<string>();
  for (const id of value.cardIds) {
    if (typeof id !== "string" || !id.trim() || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
