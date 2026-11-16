import { controlledLotMarkers, publicGrossSalaryQuotes, type PublicMatchSceneState } from "./activityMarkers";
import { playerMarkerPlacements } from "./playerMarkers";
import { isValidDevelopmentTechnicalPlayerId } from "../matches/verifiedDevelopmentTechnicalPlayerId";

/** #138: public city scouting only: NOT a payout, wallet, tax or combat action. */
export type PublicSeatEconomy = Readonly<{
  controlledLots: number;
  standing: number;
  fallen: number;
  grossAtoms: number;
}>;

/**
 * Reuse the EXACT already verified public gross quote projection (#105/#107).
 * It validates all public cards, controls, owners, standing counts, the 2-atom
 * printed base and the quote for EVERY seat. Never recalculate a salary or
 * trust a partial list that could make a rival's public strength look lower.
 */
export function verifiedPublicSeatEconomy(value: unknown): ReadonlyMap<string, PublicSeatEconomy> {
  const empty = () => new Map<string, PublicSeatEconomy>();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return empty();
  const state = value as PublicMatchSceneState;
  if (!Array.isArray(state.players) || state.players.length < 2
    || state.players.length > 8
    || !Array.isArray(state.controlledActivities)
    || !Array.isArray(state.boardActivities)
    || !Array.isArray(state.grossSalaryQuotes)
    || state.players.some(p => !p || !isValidDevelopmentTechnicalPlayerId(p.playerId)))
    return empty();

  // Every player must have a genuine unique, canonical public street marker.
  // A malformed pawn may not be omitted while showing seemingly whole quotas.
  const placed = playerMarkerPlacements(state.players, state.activePlayerId);
  if (placed.length !== state.players.length) return empty();
  const quotes = publicGrossSalaryQuotes(state);
  if (quotes.length !== state.players.length) return empty();
  const controls = controlledLotMarkers(state);
  if (controls.length !== state.controlledActivities.length) return empty();

  const result = new Map<string, PublicSeatEconomy>();
  for (const quote of quotes) {
    const owned = controls.filter(lot => lot.ownerPlayerId === quote.playerId);
    const standing = owned.filter(lot => lot.posture === "standing").length;
    if (standing !== quote.standingActivityAtoms) return empty();
    result.set(quote.playerId, {
      controlledLots: owned.length,
      standing,
      fallen: owned.length - standing,
      // Only copy the .NET quote after all independent public checks.
      grossAtoms: quote.grossAtoms,
    });
  }
  return result.size === state.players.length ? result : empty();
}
