import { cityBoard } from "@/features/city/board";
import { verifiedPublicStreetControlMatrix } from "@/features/city/publicStreetControlMatrix";
import {
  verifiedPublicTerritoryFootprints,
  type PublicTerritoryFootprint,
} from "@/features/city/publicTerritoryFootprints";
import type { PublicTerritorySourceSnapshot } from "./verifiedDevelopmentPublicTerritory";

/**
 * #180: own public lots vs a rival's public lots and roads on which BOTH own
 * at least one. NOT a combat target, attack range, faction, victory claim or
 * permission to control an unowned space. Only a #179-verified report's
 * public copies may reach this function in the actual Development UI.
 */
export type VerifiedPublicRivalTerritory = Readonly<{
  rivalPlayerId: string;
  rivalPlace: number;
  myControlledLots: number;
  rivalControlledLots: number;
  myLotAdvantage: number;
  sharedStreetIds: readonly string[];
}>;

const footprintKeys = [
  "playerId", "place", "controlledLots", "standing", "fallen", "occupiedStreets",
] as const;

function isExactFootprint(value: unknown): value is PublicTerritoryFootprint {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === footprintKeys.length
    && footprintKeys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Deterministic public-only scouting projection. Does not fetch, mutate, use a
 * bearer or remember a prior seat. Validate the full 2-8 row server-confirmed
 * ranking against the independently validated printed board BEFORE selecting
 * rivals, so an incorrect zero, missing actor, duplicate, tie or row order
 * cannot produce a confident partial comparison.
 *
 * [] means unavailable (never "no rivals"), since legitimate matches always
 * have 2-8 players.
 */
export function verifiedPublicRivalTerritory(
  snapshot: PublicTerritorySourceSnapshot | null,
  standings: readonly PublicTerritoryFootprint[] | null,
  actorId: string,
): readonly VerifiedPublicRivalTerritory[] {
  try {
    if (!snapshot || snapshot.round !== 1 || !Number.isSafeInteger(snapshot.revision)
      || !Array.isArray(snapshot.players) || snapshot.players.length < 2
      || snapshot.players.length > 8 || !Array.isArray(standings)
      || standings.length !== snapshot.players.length
      || !snapshot.players.some(player => player.playerId === actorId))
      return [];

    const streets = verifiedPublicStreetControlMatrix(snapshot);
    const expected = verifiedPublicTerritoryFootprints(snapshot);
    if (streets.length !== cityBoard.streets.length
      || expected.length !== snapshot.players.length
      || standings.some((row, index) => {
        if (!isExactFootprint(row)) return true;
        const reference = expected[index];
        return footprintKeys.some(key => row[key] !== reference[key]);
      }))
      return [];

    const myself = expected.find(row => row.playerId === actorId);
    if (!myself) return [];
    const rivals = expected.filter(row => row.playerId !== actorId).map(row => {
      const sharedStreetIds = streets.filter(street =>
        street.owners.some(owner => owner.playerId === actorId && owner.controlled > 0)
        && street.owners.some(owner =>
          owner.playerId === row.playerId && owner.controlled > 0))
        .map(street => street.streetId);
      return {
        rivalPlayerId: row.playerId,
        rivalPlace: row.place,
        myControlledLots: myself.controlledLots,
        rivalControlledLots: row.controlledLots,
        myLotAdvantage: myself.controlledLots - row.controlledLots,
        sharedStreetIds,
      };
    });
    return rivals.length === snapshot.players.length - 1 ? rivals : [];
  } catch {
    return [];
  }
}
