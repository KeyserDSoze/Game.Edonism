import { cityBoard } from "./board";
import { isValidDevelopmentTechnicalPlayerId } from "../matches/verifiedDevelopmentTechnicalPlayerId";

/**
 * #137: Character hearts are the public, server-provided printed initial
 * value in Development character/full-deck setup (1–5). A legacy match
 * deliberately has null hearts: DO NOT invent a value.
 *
 * This is read-only DISPLAY; it is not a current-health/damage model.
 * Fail closed for the whole roster on malformed or mixed known/unknown data.
 * Preserve exact technical IDs and streets from the one canonical board.
 */
const canonicalStreets = new Set(cityBoard.streets.map(street => street.id));

export function verifiedPublicCharacterHearts(value: unknown): ReadonlyMap<string, number> {
  const empty = () => new Map<string, number>();
  if (!Array.isArray(value) || value.length < 2 || value.length > 8)
    return empty();

  const seen = new Set<string>();
  const hearts = new Map<string, number>();
  let legacyUnknown = false;
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return empty();
    const seat = entry as Record<string, unknown>;
    if (!isValidDevelopmentTechnicalPlayerId(seat.playerId)
      || seen.has(seat.playerId)
      || typeof seat.streetId !== "string" || !canonicalStreets.has(seat.streetId))
      return empty();
    seen.add(seat.playerId);
    if (seat.hearts === null) {
      legacyUnknown = true;
    } else if (typeof seat.hearts === "number"
      && Number.isSafeInteger(seat.hearts) && seat.hearts >= 1 && seat.hearts <= 5) {
      hearts.set(seat.playerId, seat.hearts);
    } else {
      return empty();
    }
  }
  // The authoritative first-round setup is either all character-backed or
  // all legacy null. Never show a misleading subset of a forged mixed roster.
  return legacyUnknown ? empty() : hearts;
}
