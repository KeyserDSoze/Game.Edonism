import { cityBoard, slotById } from "./board";
import {
  controlledLotMarkers,
  verifiedPublicBoardCardCount,
  type PublicMatchSceneState,
} from "./activityMarkers";
import { playerMarkerPlacements } from "./playerMarkers";
import { isValidDevelopmentTechnicalPlayerId } from "../matches/verifiedDevelopmentTechnicalPlayerId";

/**
 * #149: One genuinely face-up, publicly placed UNCONTROLLED activity card.
 * This is not a purchase option, an attack target or a power definition.
 */
export type PublicUncontrolledBoardActivity = Readonly<{
  slotId: string;
  streetId: string;
  cardId: string;
  category: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Full 30-card board only. Reuse the #140–#143 whole-board validation and
 * the existing controlled-lot verifier, so a malformed owner/slot cannot
 * accidentally be shown as "uncontrolled". Partial Development fixtures
 * continue to work elsewhere in the app but are NOT a genuine full board.
 */
export function verifiedPublicUncontrolledBoardActivities(
  value: unknown,
): readonly PublicUncontrolledBoardActivity[] {
  if (!isRecord(value) || !Array.isArray(value.players)
    || value.players.length < 2 || value.players.length > 8
    || !Array.isArray(value.boardActivities)
    || !Array.isArray(value.controlledActivities))
    return [];

  const seenPlayers = new Set<string>();
  for (const p of value.players) {
    if (!isRecord(p)
      || !isValidDevelopmentTechnicalPlayerId(p.playerId)
      || seenPlayers.has(p.playerId)) return [];
    seenPlayers.add(p.playerId);
  }

  const state = value as unknown as PublicMatchSceneState;
  if (playerMarkerPlacements(state.players, state.activePlayerId).length
      !== state.players.length
    || verifiedPublicBoardCardCount(state) !== cityBoard.slots.length)
    return [];

  // A foreign slot, duplicate control, unknown owner or invalid standing
  // state must NEVER convert an occupied slot into a "free" card.
  const controls = controlledLotMarkers(state);
  if (controls.length !== state.controlledActivities.length) return [];

  const occupied = new Set(controls.map(control => control.slotId));
  const cards = new Map(state.boardActivities.map(card => [card.slotId, card]));
  if (cards.size !== cityBoard.slots.length) return [];

  const result: PublicUncontrolledBoardActivity[] = [];
  for (const lot of cityBoard.slots) {
    if (occupied.has(lot.id)) continue;
    const card = cards.get(lot.id);
    const street = slotById(lot.id)?.streetId;
    if (!card || !street) return [];
    result.push({
      slotId: lot.id,
      streetId: street,
      cardId: card.cardId,
      category: card.category,
    });
  }
  return result.length === cityBoard.slots.length - controls.length
    ? result : [];
}
