import type { PublicMatchSceneState } from "@/features/city/activityMarkers";
import { cityBoard } from "@/features/city/board";
import {
  verifiedPublicStreetControlMatrix,
} from "@/features/city/publicStreetControlMatrix";
import {
  verifiedPublicTerritoryFootprints,
  type PublicTerritoryFootprint,
} from "@/features/city/publicTerritoryFootprints";

/**
 * #179: independent, public-only reconciliation with the current Domain
 * `MatchPublicTerritoryReport`. This never decides control, victory, tax,
 * movement, attack or the hidden faction of a participant.
 */
export type PublicTerritorySourceSnapshot = PublicMatchSceneState & Readonly<{
  round: number;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]):
  value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

const rootKeys = [
  "matchId", "playerId", "round", "verifiedRevision",
  "totalSlots", "freeLots", "controlledLots", "sharedStreetCount",
  "streets", "footprints",
];
const streetKeys = [
  "streetId", "streetName", "totalSlots", "freeLots",
  "controlledLots", "standing", "fallen", "distinctOwnerCount",
  "isShared", "owners",
];
const ownerKeys = ["playerId", "controlledLots", "standing", "fallen"];
const footprintKeys = [
  "playerId", "place", "controlledLots", "standing", "fallen", "occupiedStreets",
];

/**
 * The authoritative API result must be exactly consistent with the independently
 * validated current full 30-card public state. Every nested JSON row is checked
 * before displaying anything; unknown keys (even null/false) fail closed.
 * Return a NEW public-only computed copy, never the untrusted HTTP object.
 *
 * 409 on a partial fixture is handled by the caller as "unavailable", not zero.
 * Actor/revision/capability/abort races must be checked in the caller too.
 */
export function verifiedDevelopmentPublicTerritory(
  candidate: unknown,
  snapshot: PublicTerritorySourceSnapshot | null,
  actorId: string,
): readonly PublicTerritoryFootprint[] | null {
  try {
    if (!snapshot || !exact(candidate, rootKeys)
      || typeof actorId !== "string"
      || candidate.matchId !== snapshot.matchId
      || candidate.playerId !== actorId
      || !Number.isSafeInteger(snapshot.revision)
      || !Number.isSafeInteger(snapshot.round)
      || snapshot.round !== 1 || candidate.round !== snapshot.round
      || candidate.verifiedRevision !== snapshot.revision
      || !Array.isArray(snapshot.players)
      || !snapshot.players.some(player => player.playerId === actorId))
      return null;

    const expectedStreets = verifiedPublicStreetControlMatrix(snapshot);
    const expectedFootprints = verifiedPublicTerritoryFootprints(snapshot);
    if (expectedStreets.length !== cityBoard.streets.length
      || expectedFootprints.length !== snapshot.players.length
      || snapshot.players.length < 2 || snapshot.players.length > 8
      || !Array.isArray(candidate.streets)
      || candidate.streets.length !== expectedStreets.length
      || !Array.isArray(candidate.footprints)
      || candidate.footprints.length !== expectedFootprints.length)
      return null;

    const controlled = expectedStreets.reduce(
      (sum, street) => sum + street.controlledLots, 0);
    const free = expectedStreets.reduce(
      (sum, street) => sum + street.freeLots, 0);
    const shared = expectedStreets.filter(street =>
      street.owners.filter(owner => owner.controlled > 0).length >= 2).length;
    if (candidate.totalSlots !== cityBoard.slots.length
      || candidate.controlledLots !== controlled
      || candidate.freeLots !== free
      || candidate.sharedStreetCount !== shared
      || controlled + free !== cityBoard.slots.length)
      return null;

    for (let i = 0; i < expectedStreets.length; i++) {
      const raw: unknown = candidate.streets[i];
      const expected = expectedStreets[i];
      if (!exact(raw, streetKeys)
        || raw.streetId !== expected.streetId
        || raw.streetName !== expected.streetName
        || raw.totalSlots !== expected.totalSlots
        || raw.freeLots !== expected.freeLots
        || raw.controlledLots !== expected.controlledLots
        || raw.standing !== expected.standing
        || raw.fallen !== expected.fallen
        || !Array.isArray(raw.owners)
        || raw.owners.length !== snapshot.players.length)
        return null;

      const distinct = expected.owners.filter(owner => owner.controlled > 0).length;
      if (raw.distinctOwnerCount !== distinct || raw.isShared !== (distinct >= 2))
        return null;
      for (let seat = 0; seat < snapshot.players.length; seat++) {
        const owner: unknown = raw.owners[seat];
        const row = expected.owners[seat];
        if (!exact(owner, ownerKeys)
          || owner.playerId !== row.playerId
          || owner.controlledLots !== row.controlled
          || owner.standing !== row.standing
          || owner.fallen !== row.fallen)
          return null;
      }
    }

    for (let i = 0; i < expectedFootprints.length; i++) {
      const raw: unknown = candidate.footprints[i];
      const expected = expectedFootprints[i];
      if (!exact(raw, footprintKeys)
        || raw.playerId !== expected.playerId
        || raw.place !== expected.place
        || raw.controlledLots !== expected.controlledLots
        || raw.standing !== expected.standing
        || raw.fallen !== expected.fallen
        || raw.occupiedStreets !== expected.occupiedStreets)
        return null;
    }
    return expectedFootprints.map(row => ({ ...row }));
  } catch {
    // No half-verified territory or thrown render-time exception.
    return null;
  }
}
