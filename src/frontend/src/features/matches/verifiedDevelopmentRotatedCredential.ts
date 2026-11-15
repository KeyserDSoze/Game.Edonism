/** #115: Pure Development-only fail-closed validation before accepting a rotated
 * local seat capability. Real seat authentication remains authoritative in .NET.
 * No token is logged, displayed or persisted by this helper.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const hexBearer = /^[0-9a-f]{64}$/i;

export function hasValidDevelopmentRotatedCredential(
  value: unknown,
  seatId: string,
  previousToken: string,
  heldCredentials: readonly unknown[],
): boolean {
  if (!isRecord(value)
    || typeof seatId !== "string" || !seatId.trim()
    || typeof previousToken !== "string" || !hexBearer.test(previousToken)
    || value.playerId !== seatId
    || typeof value.token !== "string" || !hexBearer.test(value.token)
    || !Array.isArray(heldCredentials)
    || heldCredentials.length < 1 || heldCredentials.length > 8)
    return false;

  const replacement = value.token.toLowerCase();
  const previous = previousToken.toLowerCase();
  if (replacement === previous) return false;

  const seenSeatIds = new Set<string>();
  const seenTokens = new Set<string>();
  let heldActorFound = false;
  for (const credential of heldCredentials) {
    if (!isRecord(credential)
      || typeof credential.playerId !== "string" || !credential.playerId.trim()
      || seenSeatIds.has(credential.playerId)
      || typeof credential.token !== "string" || !hexBearer.test(credential.token))
      return false;

    const heldToken = credential.token.toLowerCase();
    if (seenTokens.has(heldToken) || heldToken === replacement) return false;
    seenSeatIds.add(credential.playerId);
    seenTokens.add(heldToken);
    if (credential.playerId === seatId) {
      if (heldToken !== previous) return false;
      heldActorFound = true;
    }
  }
  return heldActorFound;
}
