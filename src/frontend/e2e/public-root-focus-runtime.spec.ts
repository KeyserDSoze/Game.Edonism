import { expect, test } from "@playwright/test";

// #110: run the real Vite-imported TS validators, not a Node import of board JSON.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];
const pathToEinstein = ["gauss", "main-square", "einstein"];

function fixture(count: 2 | 4 | 8) {
  const players = names.slice(0, count).map((playerId, i) =>
    ({ playerId, streetId: streets[i] }));
  const boardActivities = [
    { slotId: "N-01", cardId: "demo:activity:gauss", category: "culture" },
    { slotId: "S-01", cardId: "demo:activity:einstein", category: "transport" },
    { slotId: "S-02", cardId: "demo:activity:free", category: "sport" },
  ];
  const controlledActivities = [
    { slotId: "N-01", ownerPlayerId: "alice", posture: 0 },
    { slotId: "S-01", ownerPlayerId: "bob", posture: 0 },
  ];
  return {
    matchId: "public-root-overlay-contract", revision: 4, activePlayerId: "alice",
    players, boardActivities, controlledActivities, grossSalaryQuotes: [],
  };
}

const targets = {
  player: {
    kind: "player", matchId: "public-root-overlay-contract", revision: 4,
    actorId: "alice", targetId: "bob", streetPath: pathToEinstein,
  },
  activity: {
    kind: "activity", matchId: "public-root-overlay-contract", revision: 4,
    actorId: "alice", targetId: "S-02", streetPath: pathToEinstein,
  },
  lot: {
    kind: "opponent-lot", matchId: "public-root-overlay-contract", revision: 4,
    actorId: "alice", targetId: "S-01", streetPath: pathToEinstein,
  },
} as const;
const historic = {
  matchId: "public-root-overlay-contract", sourceRevision: 4,
  historyRevision: 2, playerId: "bob", streetId: "einstein",
};

for (const count of [2, 4, 8] as const) {
  test(`#110: valid ${count}-seat public overlays remain canonical and read-only`,
    async ({ page }) => {
    const snapshot = fixture(count);
    const before = JSON.stringify({ snapshot, targets, historic });
    await page.goto("/");
    const result = await page.evaluate(async inputs => {
      const { verifiedTacticalFocus } =
        await import("/src/features/city/tacticalFocus.ts");
      const { verifiedHistoricalStreetFocus } =
        await import("/src/features/city/historicalStreetFocus.ts");
      return {
        player: verifiedTacticalFocus(inputs.snapshot,
          inputs.targets.player as Parameters<typeof verifiedTacticalFocus>[1]),
        activity: verifiedTacticalFocus(inputs.snapshot,
          inputs.targets.activity as Parameters<typeof verifiedTacticalFocus>[1]),
        lot: verifiedTacticalFocus(inputs.snapshot,
          inputs.targets.lot as Parameters<typeof verifiedTacticalFocus>[1]),
        history: verifiedHistoricalStreetFocus(inputs.snapshot, inputs.historic),
      };
    }, { snapshot, targets, historic });
    expect(result.player).toEqual(targets.player);
    expect(result.activity).toEqual(targets.activity);
    expect(result.lot).toEqual(targets.lot);
    expect(result.history).toEqual(historic);
    expect(JSON.stringify({ snapshot, targets, historic })).toBe(before);
  });

  test(`#110: ${count}-seat forged tactical actors, owners, card and route fail closed`,
    async ({ page }) => {
    const state = fixture(count);
    const changed = (modify: (s: ReturnType<typeof fixture>) => void) => {
      const s = structuredClone(state);
      modify(s);
      return s;
    };
    const cases = {
      unknownOwner: changed(s => { s.controlledActivities[1].ownerPlayerId = "intruder"; }),
      ownLot: changed(s => { s.controlledActivities[1].ownerPlayerId = "alice"; }),
      invalidPosture: changed(s => { s.controlledActivities[1].posture = 9; }),
      numericPosture: changed(s => {
        s.controlledActivities[1].posture = "standing" as unknown as number;
      }),
      missingCard: changed(s => { s.boardActivities.splice(1, 1); }),
      duplicateCard: changed(s => {
        s.boardActivities.push({ ...s.boardActivities[1] });
      }),
      numericCardId: changed(s => {
        s.boardActivities[1].cardId = 42 as unknown as string;
      }),
      numericCategory: changed(s => {
        s.boardActivities[1].category = 42 as unknown as string;
      }),
      duplicateControls: changed(s => {
        s.controlledActivities.push({ ...s.controlledActivities[1] });
      }),
      nullControl: changed(s => {
        s.controlledActivities[1] = null as unknown as typeof s.controlledActivities[1];
      }),
      nullCard: changed(s => {
        s.boardActivities[1] = null as unknown as typeof s.boardActivities[1];
      }),
      nullPlayer: changed(s => {
        s.players[0] = null as unknown as typeof s.players[0];
      }),
      duplicatePlayer: changed(s => {
        s.players.push({ ...s.players[0], streetId: "einstein" });
      }),
      numericPlayerId: changed(s => {
        s.players[0].playerId = 42 as unknown as string;
      }),
      invalidStreet: changed(s => { s.players[0].streetId = "non-canonical"; }),
      changedRevision: changed(s => { s.revision++; }),
      unknownCardSlot: changed(s => { s.boardActivities[1].slotId = "fake-slot"; }),
    };
    const modifiedFocuses = {
      wrongPath: { ...targets.lot, streetPath: ["gauss", "einstein"] },
      wrongActor: { ...targets.lot, actorId: "intruder" },
      wrongTarget: { ...targets.lot, targetId: "S-99" },
      wrongMatch: { ...targets.lot, matchId: "other-match" },
      wrongRevision: { ...targets.lot, revision: 3 },
      wrongKind: { ...targets.lot, kind: "unknown" },
      activityAlreadyControlled: { ...targets.activity, targetId: "S-01" },
    };
    await page.goto("/");
    const result = await page.evaluate(async ({ cases, focusCases, state }) => {
      const { verifiedTacticalFocus } =
        await import("/src/features/city/tacticalFocus.ts");
      const againstBadState = Object.fromEntries(Object.entries(cases)
        .map(([key, value]) => [key, verifiedTacticalFocus(value,
          targets.lot as Parameters<typeof verifiedTacticalFocus>[1])]));
      const againstBadFocus = Object.fromEntries(Object.entries(focusCases)
        .map(([key, value]) => [key, verifiedTacticalFocus(state,
          value as Parameters<typeof verifiedTacticalFocus>[1])]));
      return { againstBadState, againstBadFocus };
    }, { cases, focusCases: modifiedFocuses, state });
    expect(Object.keys(result.againstBadState)).toEqual(Object.keys(cases));
    for (const [name, visible] of Object.entries(result.againstBadState))
      expect(visible, name).toBeNull();
    expect(Object.keys(result.againstBadFocus)).toEqual(Object.keys(modifiedFocuses));
    for (const [name, visible] of Object.entries(result.againstBadFocus))
      expect(visible, name).toBeNull();
  });
}

test("#110: malformed public overlay containers and historical requests never throw",
  async ({ page }) => {
  const state = fixture(2);
  const malformed = [
    null, {}, [], "invalid",
    { ...state, players: null },
    { ...state, players: [null, state.players[1]] },
    { ...state, players: [state.players[0], null] },
    { ...state, boardActivities: null },
    { ...state, boardActivities: [null] },
    { ...state, controlledActivities: null },
    { ...state, controlledActivities: [null] },
  ];
  const tamperedHistory = [
    { ...historic, sourceRevision: 99 },
    { ...historic, historyRevision: -1 },
    { ...historic, historyRevision: 5 },
    { ...historic, playerId: "intruder" },
    { ...historic, streetId: "forged-street" },
    { ...historic, matchId: "wrong" },
    { ...historic, historyRevision: 1.5 },
    null,
  ];
  await page.goto("/");
  const results = await page.evaluate(async input => {
    const { verifiedTacticalFocus } =
      await import("/src/features/city/tacticalFocus.ts");
    const { verifiedHistoricalStreetFocus } =
      await import("/src/features/city/historicalStreetFocus.ts");
    const badStates = input.malformed.map(raw => ({
      tactical: verifiedTacticalFocus(raw as Parameters<typeof verifiedTacticalFocus>[0],
        input.lot as Parameters<typeof verifiedTacticalFocus>[1]),
      historical: verifiedHistoricalStreetFocus(
        raw as Parameters<typeof verifiedHistoricalStreetFocus>[0], input.historic),
    }));
    const invalidRequests = input.tamperedHistory.map(requested =>
      verifiedHistoricalStreetFocus(input.state,
        requested as Parameters<typeof verifiedHistoricalStreetFocus>[1]));
    return { badStates, invalidRequests };
  }, { malformed, tamperedHistory, lot: targets.lot, historic, state });
  expect(results.badStates).toHaveLength(malformed.length);
  for (const [i, pair] of results.badStates.entries()) {
    expect(pair.tactical, `case ${i} tactical`).toBeNull();
    // Historical focus only needs public players: malformed board/control
    // arrays must not suppress a *valid* independent historical location.
    if (i <= 6) expect(pair.historical, `case ${i} history`).toBeNull();
    else expect(pair.historical, `case ${i} history`).toEqual(historic);
  }
  expect(results.invalidRequests).toHaveLength(tamperedHistory.length);
  for (const request of results.invalidRequests) expect(request).toBeNull();
});
