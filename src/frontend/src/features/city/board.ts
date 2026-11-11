import boardJson from "../../../../shared/board/edonism-board.v1.json";

export type BoardPoint = Readonly<{ x: number; y: number }>;
export type Street = Readonly<{
  id: string;
  name: string;
  neighbors: readonly string[];
  label: BoardPoint;
}>;
export type ActivitySlot = Readonly<{ id: string; streetId: string; center: BoardPoint }>;
export type RoadArea = Readonly<{ streetId: string; center: BoardPoint; width: number; height: number }>;
export type BoardDefinition = Readonly<{
  version: string;
  source: string;
  width: number;
  height: number;
  cityHall: BoardPoint;
  streets: readonly Street[];
  slots: readonly ActivitySlot[];
  roads: readonly RoadArea[];
}>;

// This JSON is also embedded by .NET Infrastructure. It is immutable public
// board geometry, NOT trusted match state or authorization.
export const cityBoard: BoardDefinition = boardJson;

export function streetById(id: string): Street | undefined {
  return cityBoard.streets.find((street) => street.id === id);
}

export function slotById(id: string): ActivitySlot | undefined {
  return cityBoard.slots.find((slot) => slot.id === id);
}

export function slotsOnStreet(id: string): ActivitySlot[] {
  return cityBoard.slots.filter((slot) => slot.streetId === id);
}

export function isAdjacentStreet(from: string, to: string): boolean {
  return streetById(from)?.neighbors.includes(to) ?? false;
}

// Public consistency check for the advisory route display. Does not grant
// any movement or purchase permission: the .NET API remains authoritative.
// Keep ordinal tie-breaks consistent with BoardDefinition.ShortestStreetPath.
export function shortestStreetPath(fromStreet: string, toStreet: string): readonly string[] | null {
  if (!streetById(fromStreet) || !streetById(toStreet)) return null;
  const previous = new Map<string, string | null>([[fromStreet, null]]);
  const queue = [fromStreet];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current === toStreet) {
      const reversed: string[] = [];
      for (let id: string | null = current; id !== null; id = previous.get(id) ?? null)
        reversed.push(id);
      return reversed.reverse();
    }
    for (const neighbor of [...(streetById(current)?.neighbors ?? [])].sort()) {
      if (!streetById(neighbor) || previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  return null;
}

// Drawing transforms only. World units are NOT movement coordinates.
export function toScene(point: BoardPoint): [number, number] {
  const scale = 95;
  return [(point.x - cityBoard.width / 2) / scale, (point.y - cityBoard.height / 2) / scale];
}
