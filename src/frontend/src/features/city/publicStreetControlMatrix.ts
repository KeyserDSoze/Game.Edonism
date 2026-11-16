import { cityBoard } from "./board";
import { controlledLotMarkers, verifiedPublicBoardCardCount, type PublicMatchSceneState } from "./activityMarkers";
import { verifiedPublicUncontrolledBoardActivities } from "./publicUncontrolledBoardActivities";

/**
 * #152: public street ownership and henchman posture only.
 * Zero counts remain explicit for every canonical public seat and road.
 * NO faction/attack/purchase authority is encoded in this projection.
 */
export type PublicStreetOwnerControl = Readonly<{
  playerId: string;
  controlled: number;
  standing: number;
  fallen: number;
}>;

export type PublicStreetControl = Readonly<{
  streetId: string;
  streetName: string;
  totalSlots: number;
  freeLots: number;
  controlledLots: number;
  standing: number;
  fallen: number;
  owners: readonly PublicStreetOwnerControl[];
}>;

/**
 * All-or-nothing 30-card public territory projection. Reuse the existing
 * complete-board and CONTROLLED-owner checks rather than trusting a filtered
 * list or synthesizing ownership from a currently selected street.
 */
export function verifiedPublicStreetControlMatrix(
  snapshot: unknown,
): readonly PublicStreetControl[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return [];
  const state = snapshot as PublicMatchSceneState;
  if (!Array.isArray(state.players)
    || !Array.isArray(state.boardActivities)
    || !Array.isArray(state.controlledActivities)
    || verifiedPublicBoardCardCount(state) !== cityBoard.slots.length)
    return [];

  // #149 checks the FULL 2–8 player roster, every board card, every control,
  // unique canonical slots/categories and real owners. No subset is valid.
  const free = verifiedPublicUncontrolledBoardActivities(state);
  if (free.length < cityBoard.slots.length - state.players.length
    || free.length === 0) return [];
  const controlled = controlledLotMarkers(state);
  if (controlled.length !== state.controlledActivities.length
    || free.length + controlled.length !== cityBoard.slots.length)
    return [];

  const printedSlots = new Set(cityBoard.slots.map(slot => slot.id));
  const allSlots = [...free.map(card => card.slotId), ...controlled.map(lot => lot.slotId)];
  if (allSlots.length !== printedSlots.size
    || new Set(allSlots).size !== printedSlots.size
    || allSlots.some(id => !printedSlots.has(id))) return [];

  const rows: PublicStreetControl[] = cityBoard.streets.map(street => {
    const totalSlots = cityBoard.slots.filter(slot => slot.streetId === street.id).length;
    const freeLots = free.filter(card => card.streetId === street.id).length;
    const held = controlled.filter(card => card.streetId === street.id);
    const standing = held.filter(card => card.posture === "standing").length;
    const fallen = held.filter(card => card.posture === "fallen").length;
    const owners = state.players.map(player => {
      const own = held.filter(card => card.ownerPlayerId === player.playerId);
      return {
        playerId: player.playerId,
        controlled: own.length,
        standing: own.filter(card => card.posture === "standing").length,
        fallen: own.filter(card => card.posture === "fallen").length,
      };
    });
    return {
      streetId: street.id,
      streetName: street.name,
      totalSlots,
      freeLots,
      controlledLots: held.length,
      standing,
      fallen,
      owners,
    };
  });

  if (rows.some(row => row.freeLots + row.controlledLots !== row.totalSlots
    || row.standing + row.fallen !== row.controlledLots
    || row.owners.some(owner => owner.standing + owner.fallen !== owner.controlled)
    || row.owners.reduce((sum, owner) => sum + owner.controlled, 0) !== row.controlledLots))
    return [];
  return rows.reduce((sum, row) => sum + row.totalSlots, 0) === cityBoard.slots.length
    ? rows : [];
}
