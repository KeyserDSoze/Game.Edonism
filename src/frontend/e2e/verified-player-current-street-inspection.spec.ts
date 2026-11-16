import { expect, test } from "@playwright/test";

// #133: Import production Vite player marker placement and the versioned
// printed board; this is a public render target, NEVER a move validator.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;

for (const count of [2, 4, 8] as const) {
  test("#133: every canonical public street remains selectable for "
    + count + " separate players", async ({ page }) => {
    const players = names.slice(0, count).map((playerId, i) => ({
      playerId, streetId: i % 2 ? "einstein" : "gauss",
      startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
    }));
    const before = JSON.stringify(players);
    await page.goto("/");
    const result = await page.evaluate(async data => {
      const { playerMarkerPlacements: markers } =
        await import("/src/features/city/playerMarkers.ts");
      const { cityBoard, streetById } =
        await import("/src/features/city/board.ts");
      const all = cityBoard.streets.map(s => s.id);
      const roads = new Set(cityBoard.roads.map(r => r.streetId));
      const each = all.map(target => {
        const copy = structuredClone(data);
        copy[0].streetId = target;
        return markers(copy).some(m => m.playerId === "alice"
          && m.streetId === target
          && streetById(m.streetId) !== undefined);
      });
      const original = markers(data);
      const afterMove = structuredClone(data);
      afterMove[0].streetId = "planck";
      const moved = markers(afterMove);
      return {
        count: all.length, roads: all.every(id => roads.has(id)),
        allCanonical: each,
        baseline: original.map(m => [m.playerId, m.streetId]),
        moved: moved.map(m => [m.playerId, m.streetId]),
        changedOnlyPosition: moved.find(m => m.playerId === "alice")?.streetId,
        immutableOrigin: data[0].startingSlotId === afterMove[0].startingSlotId,
      };
    }, players);
    expect(result.count).toBe(7);
    expect(result.roads).toBe(true);
    expect(result.allCanonical).toEqual(Array(7).fill(true));
    expect(result.baseline).toHaveLength(count);
    expect(result.moved).toHaveLength(count);
    expect(result.changedOnlyPosition).toBe("planck");
    expect(result.immutableOrigin).toBe(true);
    expect(JSON.stringify(players)).toBe(before);
  });

  test("#133: malformed, foreign and duplicated player street must not become "
    + "a selectable pawn for " + count + " seats", async ({ page }) => {
    const players = names.slice(0, count).map((playerId, i) => ({
      playerId, streetId: i % 2 ? "einstein" : "gauss",
      startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
    }));
    const copies: unknown[][] = [
      players.map((p,i) => i === 0 ? { ...p, streetId: "unmapped-road" } : p),
      players.map((p,i) => i === 0 ? { ...p, streetId: "GAUSS" } : p),
      players.map((p,i) => i === 0 ? { ...p, streetId: null } : p),
      players.map((p,i) => i === 0 ? { ...p, streetId: 42 } : p),
      [...players, { ...players[0], streetId: "unmapped-road" }],
      players.map((p,i) => i === 0 ? null : p),
    ];
    const before = JSON.stringify({ players, copies });
    await page.goto("/");
    const result = await page.evaluate(async ({ players, copies }) => {
      const { playerMarkerPlacements: markers } =
        await import("/src/features/city/playerMarkers.ts");
      return {
        baseline: markers(players).length,
        badAlice: copies.map(state =>
          !markers(state as typeof players).some(p => p.playerId === "alice")),
        preservedOther: copies.map(state =>
          markers(state as typeof players).length === players.length - 1),
        invalidContainer: markers(null as unknown as typeof players).length,
      };
    }, { players, copies });
    expect(result.baseline).toBe(count);
    expect(result.badAlice).toEqual(copies.map(() => true));
    // Null/foreign duplicate rows never cause a valid actor's marker
    // to be resurrected or moved to a guessed default road.
    expect(result.preservedOther)
      .toEqual(Array(copies.length).fill(true));
    expect(result.invalidContainer).toBe(0);
    expect(JSON.stringify({ players, copies })).toBe(before);
  });
}
