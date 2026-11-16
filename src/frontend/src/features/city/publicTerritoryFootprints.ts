import { cityBoard } from "./board";
import { verifiedPublicStreetControlMatrix } from "./publicStreetControlMatrix";

/**
 * #153 — Comparing public controlled-lot footprints is NOT a game
 * score, power, victory ranking, attack range, purchase or legal move.
 * Only public 30-card board / deployed-henchman facts are considered.
 */
export type PublicTerritoryFootprint = Readonly<{
  playerId: string;
  place: number;
  controlledLots: number;
  standing: number;
  fallen: number;
  occupiedStreets: number;
}>;

/**
 * Builds a stable, whole-roster read-only overview exclusively from #152's
 * fully verified public 30-card / seven-street territory matrix. ALL owners,
 * including zero-lot players, are included. Competition-style ties are based
 * ONLY on number of controlled lots: 1, 1, 3, never implied victory points.
 */
export function verifiedPublicTerritoryFootprints(snapshot: unknown):
  readonly PublicTerritoryFootprint[] {
  const streets = verifiedPublicStreetControlMatrix(snapshot);
  if (streets.length !== cityBoard.streets.length) return [];
  const players = streets[0]?.owners.map(owner => owner.playerId) ?? [];
  if (players.length < 2 || players.length > 8
    || new Set(players).size !== players.length) return [];
  for (let index = 0; index < streets.length; index++) {
    if (streets[index].streetId !== cityBoard.streets[index].id
      || streets[index].owners.length !== players.length
      || streets[index].owners.some((owner, i) => owner.playerId !== players[i]))
      return [];
  }
  const totals = players.map((playerId, i) => {
    const entries = streets.map(road => road.owners[i]);
    return {
      playerId,
      controlledLots: entries.reduce((sum, own) => sum + own.controlled, 0),
      standing: entries.reduce((sum, own) => sum + own.standing, 0),
      fallen: entries.reduce((sum, own) => sum + own.fallen, 0),
      occupiedStreets: entries.filter(own => own.controlled > 0).length,
    };
  });
  const owned = totals.reduce((sum, player) => sum + player.controlledLots, 0);
  const standing = totals.reduce((sum, player) => sum + player.standing, 0);
  const fallen = totals.reduce((sum, player) => sum + player.fallen, 0);
  if (owned !== streets.reduce((sum, road) => sum + road.controlledLots, 0)
    || standing !== streets.reduce((sum, road) => sum + road.standing, 0)
    || fallen !== streets.reduce((sum, road) => sum + road.fallen, 0)
    || owned + streets.reduce((sum, road) => sum + road.freeLots, 0)
      !== cityBoard.slots.length
    || totals.some(row => row.standing + row.fallen !== row.controlledLots
      || row.occupiedStreets > streets.length))
    return [];

  const ordered = [...totals].sort((left, right) =>
    right.controlledLots - left.controlledLots
      || (left.playerId < right.playerId ? -1
        : left.playerId > right.playerId ? 1 : 0));
  let place = 0;
  return ordered.map((row, index) => {
    if (index === 0 || row.controlledLots !== ordered[index - 1].controlledLots)
      place = index + 1;
    return { ...row, place };
  });
}
