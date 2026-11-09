/** Render-only procedural city sample. NOT authoritative gameplay data. */
export type TileKind = "civic" | "commerce" | "park" | "residential";
export type PreviewTile = Readonly<{ id: string; q: number; r: number; kind: TileKind }>;

export const PREVIEW_RADIUS = 3;

export function toWorld(q: number, r: number): [number, number] {
  const spacing = 1.08;
  return [Math.sqrt(3) * (q + r / 2) * spacing, 1.5 * r * spacing];
}

export function createPreviewTiles(radius = PREVIEW_RADIUS): PreviewTile[] {
  const tiles: PreviewTile[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      const hash = Math.abs(q * 11 + r * 7 + q * r * 3);
      const kind: TileKind = q === 0 && r === 0
        ? "civic"
        : hash % 7 === 0 ? "park" : hash % 3 === 0 ? "commerce" : "residential";
      tiles.push({ id: `${q}:${r}`, q, r, kind });
    }
  }
  return tiles;
}

export const previewTiles = createPreviewTiles();
