import { shortestStreetPath } from "@/features/city/board";
import type { PublicTerritoryFootprint } from "@/features/city/publicTerritoryFootprints";
import {
  verifiedPublicRivalTerritory,
} from "./verifiedPublicRivalTerritory";
import type {
  PublicTerritorySourceSnapshot,
} from "./verifiedDevelopmentPublicTerritory";

/**
 * #181: only publicly known graph distance from the active observer to a
 * printed rival street, paired with the server-confirmed #180 public lot
 * comparison. Street steps are graph edges, NOT turns, targeting permission,
 * a combat range, a victory score or a claimed faction.
 */
export type VerifiedRivalProximity = Readonly<{
  rivalPlayerId: string;
  rivalStreetId: string;
  streetSteps: number;
  streetPath: readonly string[];
  rivalControlledLots: number;
  rivalStandingHenchmen: number;
  myLotAdvantage: number;
  rivalTerritoryPlace: number;
  sharedStreetIds: readonly string[];
}>;

export type VerifiedOtherSeatRoute = Readonly<{
  otherPlayerId: string;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
  controlledActivities: number;
  standingHenchmen: number;
}>;

const exactOtherKeys = [
  "otherPlayerId", "streetId", "streetSteps", "streetPath",
  "controlledActivities", "standingHenchmen",
] as const;
function exactOther(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === exactOtherKeys.length
    && exactOtherKeys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * All-or-nothing two-source public join, no HTTP, React, bearer, local storage
 * or mutation. The caller supplies only #178 whole-DTO verified other-player
 * routes and #179 server-verified public footprint copies. Verify each source
 * against the SAME snapshot independently again, including canonical printed
 * shortest paths and the whole unfiltered public owner roster.
 *
 * [] = unavailable (valid first-round matches always contain >=1 other seat).
 */
export function verifiedPublicRivalProximityDossier(
  snapshot: PublicTerritorySourceSnapshot | null,
  standings: readonly PublicTerritoryFootprint[] | null,
  actorId: string,
  others: unknown,
): readonly VerifiedRivalProximity[] {
  try {
    const territory = verifiedPublicRivalTerritory(snapshot, standings, actorId);
    if (!snapshot || territory.length !== snapshot.players.length - 1
      || !Array.isArray(others) || others.length !== territory.length)
      return [];
    const origin = snapshot.players.find(p => p.playerId === actorId);
    if (!origin || !shortestStreetPath(origin.streetId, origin.streetId))
      return [];

    const territoryByRival = new Map(territory.map(row => [row.rivalPlayerId, row]));
    const canonical = snapshot.players.filter(row => row.playerId !== actorId)
      .map(player => {
        const path = shortestStreetPath(origin.streetId, player.streetId);
        const lots = snapshot.controlledActivities.filter(lot =>
          lot.ownerPlayerId === player.playerId);
        const territoryRow = territoryByRival.get(player.playerId);
        if (!path || !territoryRow || territoryRow.rivalControlledLots !== lots.length)
          return null;
        return {
          rivalPlayerId: player.playerId,
          rivalStreetId: player.streetId,
          streetSteps: path.length - 1,
          streetPath: [...path],
          rivalControlledLots: lots.length,
          rivalStandingHenchmen: lots.filter(lot => lot.posture === 0).length,
          myLotAdvantage: territoryRow.myLotAdvantage,
          rivalTerritoryPlace: territoryRow.rivalPlace,
          sharedStreetIds: [...territoryRow.sharedStreetIds],
        };
      });
    if (canonical.some(row => !row)) return [];
    const ordered = (canonical as VerifiedRivalProximity[])
      .sort((a, b) => a.streetSteps - b.streetSteps
        || (a.rivalPlayerId < b.rivalPlayerId ? -1
          : a.rivalPlayerId > b.rivalPlayerId ? 1 : 0));
    for (let i = 0; i < ordered.length; i++) {
      const raw: unknown = others[i];
      const row = ordered[i];
      if (!exactOther(raw) || raw.otherPlayerId !== row.rivalPlayerId
        || raw.streetId !== row.rivalStreetId
        || raw.streetSteps !== row.streetSteps
        || raw.controlledActivities !== row.rivalControlledLots
        || raw.standingHenchmen !== row.rivalStandingHenchmen
        || !Array.isArray(raw.streetPath)
        || raw.streetPath.length !== row.streetPath.length
        || !row.streetPath.every((street, n) => raw.streetPath[n] === street))
        return [];
    }
    return ordered.map(row => ({
      ...row, streetPath: [...row.streetPath],
      sharedStreetIds: [...row.sharedStreetIds],
    }));
  } catch {
    return [];
  }
}
