import { cityBoard, toScene } from "./board";
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

export type PublicMatchSceneState = PublicPlayerPositions & Readonly<{
  matchId: string;
  revision: number;
  boardActivities: readonly PublicBoardActivity[];
  controlledActivities: readonly PublicControlledActivity[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
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
  const owners = new Map(
    playerMarkerPlacements(state.players, state.activePlayerId)
      .map((player) => [player.playerId, player.color] as const),
  );
  const groupedCards = new Map<string, PublicBoardActivity[]>();
  const groupedControls = new Map<string, PublicControlledActivity[]>();

  for (const card of state.boardActivities) {
    const group = groupedCards.get(card.slotId) ?? [];
    group.push(card);
    groupedCards.set(card.slotId, group);
  }
  for (const control of state.controlledActivities) {
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
    const color = owners.get(control.ownerPlayerId);
    if (!color || !card.cardId?.trim() || !card.category?.trim()
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

/** Only server-quoted GROSS values; never interpret them as wallet credits. */
export function publicGrossSalaryQuotes(state: PublicMatchSceneState): PublicGrossSalaryQuote[] {
  const knownOwners = new Set(state.players.map((player) => player.playerId));
  const duplicateCheck = new Set<string>();
  return state.grossSalaryQuotes.filter((quote) => {
    if (!knownOwners.has(quote.playerId) || duplicateCheck.has(quote.playerId)
      || !Number.isInteger(quote.baseAtoms) || quote.baseAtoms < 0
      || !Number.isInteger(quote.standingActivityAtoms) || quote.standingActivityAtoms < 0
      || !Number.isInteger(quote.grossAtoms) || quote.grossAtoms < 0) return false;
    duplicateCheck.add(quote.playerId);
    return true;
  });
}
