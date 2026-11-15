import { expect, test } from "@playwright/test";

// #109: exercise the REAL TypeScript code from Vite's browser module graph.
// Node 24 test runtime must not import the board's JSON-backed module directly.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];

function seats(count: 2 | 4 | 8) {
  return names.slice(0, count).map((playerId, i) =>
    ({ playerId, streetId: streets[i] }));
}

for (const count of [2, 4, 8] as const) {
  test(`#109: ${count}-seat valid pawn placement is order-stable and same-street deterministic`,
    async ({ page }) => {
    const original = seats(count);
    const sameStreet = original.map(seat => ({ ...seat, streetId: "gauss" }));
    const before = JSON.stringify({ original, sameStreet });
    await page.goto("/");
    const output = await page.evaluate(async data => {
      const { playerMarkerPlacements } =
        await import("/src/features/city/playerMarkers.ts");
      return {
        normal: playerMarkerPlacements(data.original, "alice"),
        reverse: playerMarkerPlacements([...data.original].reverse(), "alice"),
        allGauss: playerMarkerPlacements(data.sameStreet, "alice"),
        allGaussReverse: playerMarkerPlacements([...data.sameStreet].reverse(), "alice"),
      };
    }, { original, sameStreet });
    expect(output.normal).toHaveLength(count);
    expect(output.normal).toEqual(output.reverse);
    expect(output.normal.map(p => p.playerId)).toEqual(
      [...original.map(p => p.playerId)].sort());
    expect(output.normal.filter(p => p.isActive).map(p => p.playerId))
      .toEqual(["alice"]);
    expect(output.allGauss).toEqual(output.allGaussReverse);
    expect(output.allGauss.map(p => p.streetId)).toEqual(
      Array.from({ length: count }, () => "gauss"));
    expect(new Set(output.allGauss.map(p => `${p.x}:${p.z}`)).size).toBe(count);
    expect(output.allGauss.every(p => Number.isFinite(p.x) && Number.isFinite(p.z)))
      .toBe(true);
    expect(JSON.stringify({ original, sameStreet })).toBe(before);
  });

  test(`#109: ${count}-seat duplicated public IDs never produce an arbitrary genuine pawn`,
    async ({ page }) => {
    const valid = seats(count);
    const cases = {
      sameStreet: [...valid, { ...valid[0] }],
      conflictingStreet: [...valid, { ...valid[0], streetId: "einstein" }],
      unknownOtherStreet: [...valid, { ...valid[0], streetId: "forged" }],
      nullOtherStreet: [...valid,
        { ...valid[0], streetId: null as unknown as string }],
      duplicatesTwoOwners: [...valid, { ...valid[0] }, { ...valid[1] }],
      duplicateInactiveOwner: [...valid, { ...valid[1], streetId: "gauss" }],
      unrecognizedDifferentId: [...valid,
        { playerId: "not-a-seat", streetId: "forged" }],
      malformedDifferentId: [...valid,
        { playerId: null as unknown as string, streetId: "gauss" }],
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const results = await page.evaluate(async inputs => {
      const { playerMarkerPlacements } =
        await import("/src/features/city/playerMarkers.ts");
      return Object.fromEntries(Object.entries(inputs).map(([name, people]) =>
        [name, playerMarkerPlacements(people, "alice")]));
    }, cases);
    for (const [name, placements] of Object.entries(results)) {
      const removed = name === "duplicatesTwoOwners" ? 2
        : name === "unrecognizedDifferentId" || name === "malformedDifferentId"
          ? 0 : 1;
      const remaining = valid.slice(removed === 2 ? 2 : removed === 0 ? 0 : 1);
      expect(placements.map(p => p.playerId), name).toEqual(
        [...remaining.map(p => p.playerId)].sort());
      expect(placements.every(p => Number.isFinite(p.x) && Number.isFinite(p.z)),
        name).toBe(true);
      if (removed > 0) expect(placements.some(p => p.playerId ===
        (name === "duplicateInactiveOwner" ? "bob" : "alice"))).toBe(false);
    }
    expect(JSON.stringify(cases)).toBe(before);
  });
}
