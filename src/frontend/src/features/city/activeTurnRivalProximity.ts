import { cityBoard, shortestStreetPath } from "./board";
import { playerMarkerPlacements } from "./playerMarkers";
import { isValidDevelopmentTechnicalPlayerId } from "../matches/verifiedDevelopmentTechnicalPlayerId";

/**
 * #147: Public, READ-ONLY shortest street-hop proximity of every rival to
 * the server-declared current turn owner. This is board TOPOLOGY only:
 * neither legal movement nor turn count, attack range or PvP permission.
 * The server's VerifiedOtherPlayerRoutesForActor is authoritative.
 */
export type PublicTurnRivalProximity = Readonly<{
  fromPlayerId: string;
  fromStreetId: string;
  toStreetId: string;
  streetSteps: number;
  streetPath: readonly string[];
}>;

type PublicSeat = Readonly<{ playerId: string; streetId: string }>;
const canonicalStreets = new Set(cityBoard.streets.map(street => street.id));

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function verifiedActiveTurnRivalProximity(
  snapshot: unknown,
): ReadonlyMap<string, PublicTurnRivalProximity> {
  const empty = () => new Map<string, PublicTurnRivalProximity>();
  if (!record(snapshot) || !Array.isArray(snapshot.players)
    || snapshot.players.length < 2 || snapshot.players.length > 8
    // At pending first-round settlement, the Domain has NO active player.
    // Never invent a tactical origin for that state.
    || !isValidDevelopmentTechnicalPlayerId(snapshot.activePlayerId))
    return empty();

  const seats: PublicSeat[] = [];
  const ids = new Set<string>();
  for (const raw of snapshot.players) {
    if (!record(raw)
      || !isValidDevelopmentTechnicalPlayerId(raw.playerId)
      || ids.has(raw.playerId)
      || typeof raw.streetId !== "string"
      || !canonicalStreets.has(raw.streetId)) return empty();
    ids.add(raw.playerId);
    seats.push({ playerId: raw.playerId, streetId: raw.streetId });
  }

  const active = seats.find(p => p.playerId === snapshot.activePlayerId);
  if (!active || playerMarkerPlacements(seats, active.playerId).length !== seats.length)
    return empty();

  const result = new Map<string, PublicTurnRivalProximity>();
  for (const rival of seats) {
    if (rival.playerId === active.playerId) continue;
    // Same street produces one inclusive waypoint and ZERO steps.
    // Sort/tie-breaks are inherited from the canonical public board helper.
    const path = shortestStreetPath(active.streetId, rival.streetId);
    if (!path || path[0] !== active.streetId
      || path[path.length - 1] !== rival.streetId) return empty();
    result.set(rival.playerId, {
      fromPlayerId: active.playerId,
      fromStreetId: active.streetId,
      toStreetId: rival.streetId,
      streetSteps: path.length - 1,
      streetPath: path,
    });
  }
  return result.size === seats.length - 1 ? result : empty();
}
