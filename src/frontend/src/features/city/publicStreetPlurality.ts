import { cityBoard } from "./board";
import {
  verifiedPublicStreetControlMatrix,
  type PublicStreetOwnerControl,
} from "./publicStreetControlMatrix";

/**
 * #167: Tactical, read-only comparison of PUBLIC owned lots for each road.
 * A largest count is not political or legal street control, attack range,
 * a mayor election, a purchase permission or a victory score.
 */
export type PublicStreetPlurality = Readonly<{
  streetId: string;
  streetName: string;
  freeLots: number;
  controlledLots: number;
  maxControlled: number;
  leaders: readonly PublicStreetOwnerControl[];
}>;

/**
 * All seven printed streets are required, even those with no controlled lots.
 * [] means UNVERIFIED entire public board, not an authentic zero-leader city.
 * A genuine empty street has maxControlled=0, leaders=[]; positive ties keep
 * ALL joint leaders in the immutable order supplied by .NET's public roster.
 */
export function verifiedPublicStreetPlurality(
  snapshot: unknown,
): readonly PublicStreetPlurality[] {
  const streets = verifiedPublicStreetControlMatrix(snapshot);
  if (streets.length !== cityBoard.streets.length) return [];
  const playerIds = streets[0].owners.map(owner => owner.playerId);
  if (playerIds.length < 2 || playerIds.length > 8
    || new Set(playerIds).size !== playerIds.length) return [];

  const result: PublicStreetPlurality[] = [];
  for (let i = 0; i < streets.length; i++) {
    const street = streets[i];
    if (street.streetId !== cityBoard.streets[i].id
      || street.owners.length !== playerIds.length
      || street.owners.some((owner, j) => owner.playerId !== playerIds[j]))
      return [];
    const maximum = Math.max(0, ...street.owners.map(owner => owner.controlled));
    if (!Number.isSafeInteger(maximum) || maximum < 0
      || maximum > street.controlledLots
      || street.freeLots + street.controlledLots !== street.totalSlots)
      return [];
    const leaders = maximum === 0 ? []
      : street.owners.filter(owner => owner.controlled === maximum);
    if (leaders.length === 0 && street.controlledLots > 0)
      return [];
    result.push({
      streetId: street.streetId,
      streetName: street.streetName,
      freeLots: street.freeLots,
      controlledLots: street.controlledLots,
      maxControlled: maximum,
      leaders,
    });
  }
  return result;
}
