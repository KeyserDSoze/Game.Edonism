import { cityBoard } from "./board";
import { isValidDevelopmentTechnicalPlayerId } from "../matches/verifiedDevelopmentTechnicalPlayerId";

/**
 * #141: The .NET first-round snapshot exposes BOTH printed initial hearts
 * on each public player and the public assigned-character card list.
 * A display-only verifier must check these agree before rendering any
 * PvP rival's badge. This is NOT HP/damage or client combat authority.
 *
 * Legacy trusted setup has hearts=null for every player and NO assigned
 * cards: no fabricated badges. Future card artwork/IDs remain noncanonical
 * until the original files are provided (#19).
 */
const canonicalStreets = new Set(cityBoard.streets.map(street => street.id));
// #145: the full 30-card board has immutable printed starting slots. This is
// provenance for public badges ONLY, not a card-play or ownership rule.
const printedActivitySlots = new Set(cityBoard.slots.map(slot => slot.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function verifiedPublicCharacterHearts(value: unknown): ReadonlyMap<string, number> {
  const empty = () => new Map<string, number>();
  if (!isRecord(value) || !Array.isArray(value.players)
    || value.players.length < 2 || value.players.length > 8
    || !Array.isArray(value.assignedCharacters)
    // Full first-round character setup: exactly one public card per seat.
    // An empty assignment list with null hearts is the LEGACY fixture,
    // deliberately represented by no public hearts.
    || value.assignedCharacters.length !== value.players.length)
    return empty();

  // #145: In a real fully placed 30-card match, assignment IDs must resolve
  // to the player's own printed starting slot. Partial synthetic/legacy
  // Development fixtures retain the previous #141 behavior.
  const fullBoardCards = Array.isArray(value.boardActivities)
    && value.boardActivities.length === cityBoard.slots.length
      ? value.boardActivities : null;
  const startingSlots = new Map<string, string>();
  const publicHearts = new Map<string, number>();
  for (const raw of value.players) {
    if (!isRecord(raw)
      || !isValidDevelopmentTechnicalPlayerId(raw.playerId)
      || publicHearts.has(raw.playerId)
      || typeof raw.streetId !== "string"
      || !canonicalStreets.has(raw.streetId)
      || (fullBoardCards !== null
        && (typeof raw.startingSlotId !== "string"
          || !printedActivitySlots.has(raw.startingSlotId)))
      || !Number.isSafeInteger(raw.hearts)
      || (raw.hearts as number) < 1 || (raw.hearts as number) > 5)
      return empty();
    publicHearts.set(raw.playerId, raw.hearts as number);
    if (fullBoardCards !== null)
      startingSlots.set(raw.playerId, raw.startingSlotId as string);
  }

  const seenSeats = new Set<string>();
  const seenCharacters = new Set<string>();
  const seenActivities = new Set<string>();
  for (const raw of value.assignedCharacters) {
    if (!isRecord(raw)
      || !isValidDevelopmentTechnicalPlayerId(raw.playerId)
      || !publicHearts.has(raw.playerId) || seenSeats.has(raw.playerId)
      || typeof raw.characterId !== "string" || !raw.characterId.trim()
      || seenCharacters.has(raw.characterId)
      || typeof raw.startingActivityCardId !== "string"
      || !raw.startingActivityCardId.trim()
      || seenActivities.has(raw.startingActivityCardId)
      || !Number.isSafeInteger(raw.printedInitialHearts)
      || raw.printedInitialHearts !== publicHearts.get(raw.playerId))
      return empty();

    if (fullBoardCards !== null) {
      // Never accept a matching card ID in a rival's lot, a duplicate ID,
      // or two cards occupying this seat's printed origin. Ignore unrelated
      // cards' attributes: independently validated board/economy views remain
      // separate from a character's genuine origin proof.
      const byCard = fullBoardCards.filter(card => isRecord(card)
        && card.cardId === raw.startingActivityCardId);
      const bySlot = fullBoardCards.filter(card => isRecord(card)
        && card.slotId === startingSlots.get(raw.playerId));
      if (byCard.length !== 1 || bySlot.length !== 1 || byCard[0] !== bySlot[0])
        return empty();
    }

    seenSeats.add(raw.playerId);
    seenCharacters.add(raw.characterId);
    seenActivities.add(raw.startingActivityCardId);
  }
  // All seats and assigned character cards must match. Never show
  // a partial list that misrepresents a rival's publicly printed hearts.
  return seenSeats.size === publicHearts.size ? publicHearts : empty();
}
