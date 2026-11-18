import { isValidDevelopmentTechnicalPlayerId } from "./verifiedDevelopmentTechnicalPlayerId";

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
// #166: This is the entire current .NET private-hand wire contract.
// A forged 200 containing opponent hands, deck, capabilities or unknown
// metadata must never enter React state, even if four own cards look valid.
const ExpectedPrivateHandKeys = ["cardIds", "matchId", "playerId"].join("|");

export function hasValidDevelopmentFirstRoundHand(
  value: unknown,
  expectedMatchId: string,
  expectedActorId: string,
): boolean {
  if (!isRecord(value)
    || typeof expectedMatchId !== "string" || !expectedMatchId.trim()
    || !isValidDevelopmentTechnicalPlayerId(expectedActorId)
    || value.matchId !== expectedMatchId
    || value.playerId !== expectedActorId
    || Object.keys(value).sort().join("|") !== ExpectedPrivateHandKeys
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
