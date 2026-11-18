import { isValidDevelopmentTechnicalPlayerId } from "./verifiedDevelopmentTechnicalPlayerId";

/**
 * #171: Development bearer-scoped, read-only 15-second activity hint.
 * Match/seat identity comes from an independently verified public snapshot.
 * Do not treat active/inactive as connection identity, permission to end an
 * opponent's turn, a timer, or a disconnect policy.
 */
export type VerifiedDevelopmentSeatPresence = Readonly<{
  matchId: string;
  seats: readonly Readonly<{ playerId: string; isActive: boolean }>[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const exactPresenceKeys = "matchId|seats";
const exactSeatKeys = "isActive|playerId";

/**
 * The .NET DevMatchPresence DTO has exactly matchId/seats; every
 * DevSeatPresence has exactly playerId/isActive. Reject all unknown
 * properties, including optional metadata; this raw JSON is retained in
 * a React presence lease. Canonical seat order is .NET match turn order.
 *
 * This checks transport integrity only, never heartbeat truth or gameplay.
 */
export function hasValidDevelopmentSeatPresence(
  value: unknown, expectedMatchId: string,
  expectedPlayerIds: readonly string[],
): value is VerifiedDevelopmentSeatPresence {
  if (!isRecord(value)
    || Object.keys(value).sort().join("|") !== exactPresenceKeys
    || typeof expectedMatchId !== "string" || !expectedMatchId.trim()
    || value.matchId !== expectedMatchId
    || !Array.isArray(expectedPlayerIds)
    || expectedPlayerIds.length < 2 || expectedPlayerIds.length > 8
    || expectedPlayerIds.some(id => !isValidDevelopmentTechnicalPlayerId(id))
    || new Set(expectedPlayerIds).size !== expectedPlayerIds.length
    || !Array.isArray(value.seats)
    || value.seats.length !== expectedPlayerIds.length)
    return false;

  for (let index = 0; index < expectedPlayerIds.length; index++) {
    const row: unknown = value.seats[index];
    if (!isRecord(row)
      || Object.keys(row).sort().join("|") !== exactSeatKeys
      || row.playerId !== expectedPlayerIds[index]
      || typeof row.isActive !== "boolean")
      return false;
  }
  return true;
}
