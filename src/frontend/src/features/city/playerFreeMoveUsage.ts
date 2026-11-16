import { cityBoard } from "./board";

/**
 * #136: Read-only display of the server's public first-round `freeMoveUsed`
 * bit. A false value means NOT USED, never "available": actor turn/phase and
 * legal options are decided by .NET, not reconstructed by this projection.
 *
 * Fail closed for ALL status rows when any public roster identity, position
 * or flag is malformed; do not show a trustworthy-looking partial list.
 * The same printed board supplies the canonical street identities.
 */
const canonicalStreetIds = new Set(cityBoard.streets.map(street => street.id));

export function verifiedPublicFreeMoveUsage(value: unknown): ReadonlyMap<string, boolean> {
  const empty = () => new Map<string, boolean>();
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return empty();

  const usage = new Map<string, boolean>();
  for (const valueSeat of value) {
    if (!valueSeat || typeof valueSeat !== "object" || Array.isArray(valueSeat))
      return empty();
    const seat = valueSeat as Record<string, unknown>;
    if (typeof seat.playerId !== "string" || !seat.playerId.trim()
      || seat.playerId === "system" || usage.has(seat.playerId)
      || typeof seat.streetId !== "string" || !canonicalStreetIds.has(seat.streetId)
      || typeof seat.freeMoveUsed !== "boolean")
      return empty();
    usage.set(seat.playerId, seat.freeMoveUsed);
  }
  return usage;
}
