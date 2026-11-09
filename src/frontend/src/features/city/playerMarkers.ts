import { cityBoard, toScene } from "./board";

/** The only match fields the renderer accepts: public, server-authored IDs. */
export type PublicPlayerPosition = Readonly<{ playerId: string; streetId: string }>;
export type PublicPlayerPositions = Readonly<{
  players: readonly PublicPlayerPosition[];
  activePlayerId: string | null;
}>;

export type PlayerMarkerPlacement = Readonly<{
  playerId: string;
  streetId: string;
  x: number;
  z: number;
  color: string;
  isActive: boolean;
}>;

const pawnColors = [
  "#f29e72", "#89d6db", "#d8b7ec", "#d6cb78",
  "#9fd38e", "#f29dad", "#a8b9f1", "#e8b777",
] as const;

/**
 * A deterministic VISUAL projection of server street IDs onto printed road
 * rectangles. It is never used to decide whether a player may move.
 * Unknown streets have no corresponding marker; we never guess a position.
 * Multiple players on a street are spread along its longer road axis.
 */
export function playerMarkerPlacements(
  players: readonly PublicPlayerPosition[],
  activePlayerId: string | null,
): PlayerMarkerPlacement[] {
  const uniqueIds = new Set<string>();
  const knownPlayers = [...players]
    .filter((player) => player.playerId.trim().length > 0 &&
      cityBoard.roads.some((road) => road.streetId === player.streetId))
    .sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
    .filter((player) => {
      if (uniqueIds.has(player.playerId)) return false;
      uniqueIds.add(player.playerId);
      return true;
    });

  return knownPlayers.map((player, index) => {
    // Main Square has multiple road rectangles; its first is north of City Hall,
    // allowing a marker without pretending that the building is a playable lot.
    const road = cityBoard.roads.find((candidate) => candidate.streetId === player.streetId)!;
    const onStreet = knownPlayers.filter((member) => member.streetId === player.streetId);
    const position = onStreet.findIndex((member) => member.playerId === player.playerId);
    const majorExtent = Math.max(road.width, road.height) / 95;
    const step = Math.min(0.72, Math.max(0, majorExtent - 0.65) / Math.max(1, onStreet.length - 1));
    const stagger = (position - (onStreet.length - 1) / 2) * step;
    const [centerX, centerZ] = toScene(road.center);
    const horizontal = road.width >= road.height;

    return {
      playerId: player.playerId,
      streetId: player.streetId,
      x: centerX + (horizontal ? stagger : 0),
      z: centerZ + (horizontal ? 0 : stagger),
      color: pawnColors[index % pawnColors.length],
      isActive: player.playerId === activePlayerId,
    };
  });
}
