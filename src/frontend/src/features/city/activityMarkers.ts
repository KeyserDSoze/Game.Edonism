import { cityBoard, slotById, toScene } from "./board";
import { playerMarkerPlacements, type PublicPlayerPositions } from "./playerMarkers";

/** Serialized .NET public MatchSnapshot fields. No secret hands or access tokens. */
export type PublicBoardActivity = Readonly<{
  slotId: string;
  cardId: string;
  category: string;
}>;

export type PublicControlledActivity = Readonly<{
  slotId: string;
  ownerPlayerId: string;
  posture: number; // .NET HenchmanPosture: 0 Standing, 1 Fallen
}>;

export type PublicGrossSalaryQuote = Readonly<{
  playerId: string;
  baseAtoms: number;
  standingActivityAtoms: number;
  grossAtoms: number;
}>;

/** #141: public server-assigned character facts, NOT a private hand. */
export type PublicAssignedCharacter = Readonly<{
  playerId: string;
  characterId: string;
  startingActivityCardId: string;
  printedInitialHearts: number;
}>;

export type PublicMatchSceneState = PublicPlayerPositions & Readonly<{
  matchId: string;
  revision: number;
  boardActivities: readonly PublicBoardActivity[];
  controlledActivities: readonly PublicControlledActivity[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
  // Optional for unrelated city-only fixtures; the #141 character-heart
  // verifier requires the complete public assignments before showing badges.
  assignedCharacters?: readonly PublicAssignedCharacter[];
}>;

export type ControlledLotMarker = Readonly<{
  slotId: string;
  streetId: string;
  cardId: string;
  category: string;
  ownerPlayerId: string;
  posture: "standing" | "fallen";
  color: string;
  x: number;
  z: number;
}>;

/**
 * Renders a controlled lot only if the public board has ONE card in an
 * existing printed slot, ONE valid control for that slot and a known owner.
 * Unknown/ambiguous data is not painted as a genuine game state.
 *
 * x/z are geometry ONLY and never sent to .NET as game coordinates.
 */
export function controlledLotMarkers(state: PublicMatchSceneState): ControlledLotMarker[] {
  // #108: a malformed public container or unlocatable record must not
  // escape as a React render-time exception or a genuine controlled lot.
  if (!state || !Array.isArray(state.players)
    || !Array.isArray(state.boardActivities)
    || !Array.isArray(state.controlledActivities)) return [];
  const owners = new Map(
    playerMarkerPlacements(state.players, state.activePlayerId)
      .map((player) => [player.playerId, player.color] as const),
  );
  const groupedCards = new Map<string, PublicBoardActivity[]>();
  const groupedControls = new Map<string, PublicControlledActivity[]>();

  for (const card of state.boardActivities) {
    if (!card || typeof card !== "object"
      || typeof card.slotId !== "string" || !card.slotId.trim()) return [];
    const group = groupedCards.get(card.slotId) ?? [];
    group.push(card);
    groupedCards.set(card.slotId, group);
  }
  for (const control of state.controlledActivities) {
    if (!control || typeof control !== "object"
      || typeof control.slotId !== "string" || !control.slotId.trim()) return [];
    const group = groupedControls.get(control.slotId) ?? [];
    group.push(control);
    groupedControls.set(control.slotId, group);
  }

  return cityBoard.slots.flatMap((slot) => {
    const cards = groupedCards.get(slot.id) ?? [];
    const controls = groupedControls.get(slot.id) ?? [];
    if (cards.length !== 1 || controls.length !== 1) return [];

    const [card] = cards;
    const [control] = controls;
    const color = typeof control.ownerPlayerId === "string"
      ? owners.get(control.ownerPlayerId) : undefined;
    if (!color || typeof card.cardId !== "string" || !card.cardId.trim()
      || typeof card.category !== "string" || !card.category.trim()
      || (control.posture !== 0 && control.posture !== 1)) return [];

    const [x, z] = toScene(slot.center);
    return [{
      slotId: slot.id,
      streetId: slot.streetId,
      cardId: card.cardId,
      category: card.category,
      ownerPlayerId: control.ownerPlayerId,
      posture: control.posture === 0 ? "standing" as const : "fallen" as const,
      color,
      x,
      z,
    }];
  });
}


/**
 * #111 — A board card count is trustworthy only for a complete, well-shaped
 * PUBLIC card list with unique canonical printed slots. This is display-only:
 * never synthesize a card count, game action, or payout from a malformed
 * server snapshot. `null` means "unverified" (hide the badge), NOT zero.
 */
export function verifiedPublicBoardCardCount(
  state: Pick<PublicMatchSceneState, "boardActivities"> | null,
): number | null {
  if (!state || !Array.isArray(state.boardActivities)) return null;
  const occupiedSlots = new Set<string>();
  for (const card of state.boardActivities) {
    if (!card || typeof card !== "object" || Array.isArray(card)
      || typeof card.slotId !== "string" || !slotById(card.slotId)
      || occupiedSlots.has(card.slotId)
      || typeof card.cardId !== "string" || !card.cardId.trim()
      || typeof card.category !== "string" || !card.category.trim())
      return null;
    occupiedSlots.add(card.slotId);
  }
  return occupiedSlots.size;
}

/**
 * #105: Read-only gross salary rows are displayed only if every quote agrees
 * with the SAME public snapshot's validated lots and standing henchmen.
 * Never calculate or award game currency: .NET GrossSalaryRules remains the
 * sole authority; malformed/forged input hides ALL quotes, not a partial list.
 */
export function publicGrossSalaryQuotes(state: PublicMatchSceneState): PublicGrossSalaryQuote[] {
  try {
    if (!state || !Array.isArray(state.players)
      || !Array.isArray(state.boardActivities)
      || !Array.isArray(state.controlledActivities)
      || !Array.isArray(state.grossSalaryQuotes)) return [];

    // #140: check ALL printed board-card slots, including unowned lots.
    // controlledLotMarkers only inspects cards linked to occupied controls,
    // so a duplicate/foreign/malformed UNCONTROLLED card could otherwise
    // leave apparently verified salary, economy and resources visible while
    // the separate #111 board count rightly disappeared. Reuse the SAME
    // entire-board transport validator, without implementing game rules.
    if (verifiedPublicBoardCardCount(state) === null) return [];

    const knownOwners = new Set<string>();
    for (const player of state.players) {
      if (!player || typeof player.playerId !== "string"
        || !player.playerId.trim() || knownOwners.has(player.playerId)) return [];
      knownOwners.add(player.playerId);
    }

    // A forged omission must not look like a complete server quote set.
    // Every public seat has one gross quote, including zero-standing seats.
    if (state.grossSalaryQuotes.length !== knownOwners.size) return [];

    // This is the existing public renderer's fully checked slot/card/owner/
    // posture projection. If any controlled lot is unrenderable or duplicated,
    // its supposedly authoritative standing count cannot be trusted.
    const confirmed = controlledLotMarkers(state);
    if (confirmed.length !== state.controlledActivities.length) return [];
    const standing = new Map<string, number>();
    for (const lot of confirmed) {
      if (lot.posture === "standing")
        standing.set(lot.ownerPlayerId, (standing.get(lot.ownerPlayerId) ?? 0) + 1);
    }

    const seenQuotes = new Set<string>();
    for (const quote of state.grossSalaryQuotes) {
      if (!quote || typeof quote.playerId !== "string"
        || !knownOwners.has(quote.playerId) || seenQuotes.has(quote.playerId)
        || !Number.isSafeInteger(quote.baseAtoms) || quote.baseAtoms !== 2
        || !Number.isSafeInteger(quote.standingActivityAtoms)
        || quote.standingActivityAtoms < 0
        || !Number.isSafeInteger(quote.grossAtoms) || quote.grossAtoms < 0
        || quote.standingActivityAtoms !== (standing.get(quote.playerId) ?? 0)
        || !Number.isSafeInteger(quote.baseAtoms + quote.standingActivityAtoms)
        || quote.grossAtoms !== quote.baseAtoms + quote.standingActivityAtoms)
        return [];
      seenQuotes.add(quote.playerId);
    }
    return [...state.grossSalaryQuotes];
  } catch {
    // Network JSON is untrusted at runtime, regardless of TypeScript types.
    return [];
  }
}
