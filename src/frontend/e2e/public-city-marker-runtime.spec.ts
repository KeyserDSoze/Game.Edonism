import { expect, test } from "@playwright/test";

// #108: run the real Vite browser module, not a Node import of board JSON.
const seats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];
const slots = ["N-01", "S-01", "W-01", "E-01",
  "B-01", "M-01", "N-02", "N-03"];

function fixture(count: 2 | 4 | 8) {
  const ids = seats.slice(0, count);
  const players = ids.map((playerId, i) => ({ playerId, streetId: streets[i] }));
  const boardActivities = ids.map((_, i) =>
    ({ slotId: slots[i], cardId: `test:card:${i}`, category: "culture" }));
  const controlledActivities = ids.map((ownerPlayerId, i) =>
    ({ slotId: slots[i], ownerPlayerId, posture: i % 2 }));
  const grossSalaryQuotes = ids.map((playerId, i) => ({
    playerId, baseAtoms: 2, standingActivityAtoms: i % 2 === 0 ? 1 : 0,
    grossAtoms: i % 2 === 0 ? 3 : 2,
  }));
  return {
    matchId: "public-city-markers-runtime", revision: 1, activePlayerId: "alice",
    players, boardActivities, controlledActivities, grossSalaryQuotes,
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#108: ${count}-seat valid public pawn and controlled-lot projection stays unchanged`,
    async ({ page }) => {
    const state = fixture(count);
    const before = JSON.stringify(state);
    await page.goto("/");
    const projected = await page.evaluate(async scene => {
      const { playerMarkerPlacements } = await import("/src/features/city/playerMarkers.ts");
      const { controlledLotMarkers, publicGrossSalaryQuotes } =
        await import("/src/features/city/activityMarkers.ts");
      return {
        players: playerMarkerPlacements(scene.players, scene.activePlayerId),
        lots: controlledLotMarkers(scene),
        quotes: publicGrossSalaryQuotes(scene),
      };
    }, state);
    expect(projected.players.map(player => player.playerId)).toEqual(
      [...state.players.map(player => player.playerId)].sort());
    expect(projected.players.every(player =>
      Number.isFinite(player.x) && Number.isFinite(player.z))).toBe(true);
    expect(projected.lots.map(lot => lot.slotId).sort()).toEqual(
      state.boardActivities.map(card => card.slotId).sort());
    expect(projected.quotes).toEqual(state.grossSalaryQuotes);
    expect(JSON.stringify(state)).toBe(before);
  });

  test(`#108: ${count}-seat malformed public marker fields hide affected visuals without exceptions`,
    async ({ page }) => {
    const base = fixture(count);
    const changed = (edit: (state: ReturnType<typeof fixture>) => void) => {
      const next = structuredClone(base);
      edit(next);
      return next;
    };
    const cases = {
      nullPlayer: changed(s => { s.players[0] = null as unknown as typeof s.players[0]; }),
      numericPlayerId: changed(s => { s.players[0].playerId = 8 as unknown as string; }),
      numericStreetId: changed(s => { s.players[0].streetId = 8 as unknown as string; }),
      unknownStreet: changed(s => { s.players[0].streetId = "not-a-street"; }),
      numericCardId: changed(s => { s.boardActivities[0].cardId = 42 as unknown as string; }),
      numericCategory: changed(s => { s.boardActivities[0].category = 42 as unknown as string; }),
      unknownOwner: changed(s => { s.controlledActivities[0].ownerPlayerId = "forged"; }),
      badPosture: changed(s => { s.controlledActivities[0].posture = 77; }),
      repeatedControl: changed(s => {
        s.controlledActivities.push({ ...s.controlledActivities[0] });
      }),
      repeatedCard: changed(s => {
        s.boardActivities.push({ ...s.boardActivities[0] });
      }),
      unknownSlot: changed(s => { s.controlledActivities[0].slotId = "forged-slot"; }),
      nullCard: changed(s => { s.boardActivities[0] = null as unknown as typeof s.boardActivities[0]; }),
      nullControl: changed(s => {
        s.controlledActivities[0] = null as unknown as typeof s.controlledActivities[0];
      }),
      numericCardSlot: changed(s => { s.boardActivities[0].slotId = 42 as unknown as string; }),
      numericControlSlot: changed(s => {
        s.controlledActivities[0].slotId = 42 as unknown as string;
      }),
    };
    const frozenInputs = JSON.stringify(cases);
    await page.goto("/");
    const results = await page.evaluate(async scenes => {
      const { playerMarkerPlacements } = await import("/src/features/city/playerMarkers.ts");
      const { controlledLotMarkers, publicGrossSalaryQuotes } =
        await import("/src/features/city/activityMarkers.ts");
      return Object.fromEntries(Object.entries(scenes).map(([name, state]) => [
        name, {
          pawns: playerMarkerPlacements(state.players, state.activePlayerId),
          lots: controlledLotMarkers(state),
          quotes: publicGrossSalaryQuotes(state),
        },
      ]));
    }, cases);
    expect(Object.keys(results)).toEqual(Object.keys(cases));
    for (const [name, scene] of Object.entries(results)) {
      expect(scene.quotes, name).toEqual([]);
      expect(scene.pawns.length, name).toBe(name === "nullPlayer"
        || name === "numericPlayerId" || name === "numericStreetId"
        || name === "unknownStreet" ? count - 1 : count);
      expect(scene.lots.length, name).toBe(
        ["nullCard", "nullControl", "numericCardSlot", "numericControlSlot"].includes(name)
          ? 0 : count - 1);
    }
    expect(JSON.stringify(cases)).toBe(frozenInputs);
  });
}

test("#108: malformed containers never throw and create no public city markers",
  async ({ page }) => {
  const state = fixture(2);
  await page.goto("/");
  const results = await page.evaluate(async base => {
    const { playerMarkerPlacements } = await import("/src/features/city/playerMarkers.ts");
    const { controlledLotMarkers, publicGrossSalaryQuotes } =
      await import("/src/features/city/activityMarkers.ts");
    const cases: unknown[] = [
      null, {}, [], "not-json-object",
      { ...base, players: null },
      { ...base, players: "bad" },
      { ...base, boardActivities: null },
      { ...base, boardActivities: {} },
      { ...base, controlledActivities: null },
      { ...base, controlledActivities: "bad" },
    ];
    return cases.map(raw => {
      const state = raw as typeof base | null;
      return {
        pawns: playerMarkerPlacements(state?.players as typeof base.players, null),
        lots: controlledLotMarkers(state as typeof base),
        quotes: publicGrossSalaryQuotes(state as typeof base),
      };
    });
  }, state);
  expect(results).toHaveLength(10);
  for (const [index, result] of results.entries()) {
    // A malformed lot container must not suppress independent, valid
    // public player positions. An absent/invalid player list must.
    expect(result.pawns.length, `case ${index} players`).toBe(index >= 6 ? 2 : 0);
    expect(result.lots, `case ${index} controlled lots`).toEqual([]);
    expect(result.quotes, `case ${index} gross quotes`).toEqual([]);
  }
});
