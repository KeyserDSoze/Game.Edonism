import { isValidDevelopmentTechnicalPlayerId } from "./verifiedDevelopmentTechnicalPlayerId";

/**
 * #174: The authenticated, atomic .NET DevSeatBootstrap HTTP 200 has
 * EXACTLY five own JSON properties. The nested public state, private hand,
 * and actor turn-options are verified by their independent existing guards.
 * This envelope check is never a permission grant or a persistence policy.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const bootstrapKeys = "hand|matchId|playerId|state|turnOptions";

export function hasValidDevelopmentSeatBootstrapEnvelope(
  value: unknown, expectedMatchId: string,
): boolean {
  if (!isRecord(value)
    || Object.keys(value).sort().join("|") !== bootstrapKeys
    || typeof expectedMatchId !== "string"
    || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expectedMatchId)
    || typeof value.matchId !== "string"
    || value.matchId.toLowerCase() !== expectedMatchId.toLowerCase()
    || !isValidDevelopmentTechnicalPlayerId(value.playerId)
    || !isRecord(value.state) || !isRecord(value.hand)
    || !isRecord(value.turnOptions)) return false;
  return true;
}
