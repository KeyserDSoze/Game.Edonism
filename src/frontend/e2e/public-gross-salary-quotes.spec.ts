import { expect, test } from "@playwright/test";

// #105: Node 24 cannot runtime-import the Vite module's board JSON here.
// Execute the REAL pure TypeScript projection in Vite's browser module graph.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];
const slots = ["N-01", "S-01", "W-01", "E-01",
  "B-01", "M-01", "N-02", "N-03"];

function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  const players = ids.map((playerId, index) =>
    ({ playerId, streetId: streets[index] }));
  const boardActivities = ids.map((_, index) =>
    ({ slotId: slots[index], cardId: `synthetic:activity:${index}`, category: "culture" }));
  const controlledActivities = ids.map((ownerPlayerId, index) =>
    ({ slotId: slots[index], ownerPlayerId, posture: index % 2 }));
  const grossSalaryQuotes = ids.map((playerId, index) =>
    ({ playerId, baseAtoms: 2, standingActivityAtoms: index % 2 === 0 ? 1 : 0,
      grossAtoms: index % 2 === 0 ? 3 : 2 }));
  return {
    matchId: "test-public-gross-quotes", revision: 3, players,
    activePlayerId: "alice", boardActivities, controlledActivities, grossSalaryQuotes,
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#105: ${count}-seat public gross salary quotes equal server snapshot standing counts`,
    async ({ page }) => {
    const state = fixture(count);
    const before = JSON.stringify(state);
    await page.goto("/");
    const result = await page.evaluate(async snapshot => {
      const { publicGrossSalaryQuotes } =
        await import("/src/features/city/activityMarkers.ts");
      return publicGrossSalaryQuotes(snapshot);
    }, state);
    expect(result).toEqual(state.grossSalaryQuotes);
    expect(result).not.toBe(state.grossSalaryQuotes);
    expect(JSON.stringify(state)).toBe(before);
  });

  test(`#105: ${count}-seat forged arithmetic, base, owner, lot and posture fail closed`,
    async ({ page }) => {
    const baseline = fixture(count);
    const changed = (edit: (snapshot: ReturnType<typeof fixture>) => void) => {
      const snapshot = structuredClone(baseline);
      edit(snapshot);
      return snapshot;
    };
    const cases = {
      wrongTotal: changed(x => { x.grossSalaryQuotes[0].grossAtoms = 999; }),
      forgedBaseButBalancedSum: changed(x => {
        x.grossSalaryQuotes[0].baseAtoms = 3; x.grossSalaryQuotes[0].grossAtoms = 4;
      }),
      forgedStandingButBalancedSum: changed(x => {
        x.grossSalaryQuotes[0].standingActivityAtoms = 0;
        x.grossSalaryQuotes[0].grossAtoms = 2;
      }),
      unknownQuoteOwner: changed(x => { x.grossSalaryQuotes[0].playerId = "intruder"; }),
      repeatedQuote: changed(x => {
        x.grossSalaryQuotes.push({ ...x.grossSalaryQuotes[0] });
      }),
      duplicateControlledSlot: changed(x => {
        x.controlledActivities.push({ ...x.controlledActivities[0] });
      }),
      missingControlledCard: changed(x => { x.boardActivities.shift(); }),
      unknownControlledSlot: changed(x => {
        x.controlledActivities[0].slotId = "outside-board";
      }),
      illegalPosture: changed(x => { x.controlledActivities[0].posture = 9; }),
      unknownControlOwner: changed(x => {
        x.controlledActivities[0].ownerPlayerId = "intruder";
      }),
      negativeAmount: changed(x => { x.grossSalaryQuotes[0].grossAtoms = -2; }),
      fractionalAmount: changed(x => { x.grossSalaryQuotes[0].grossAtoms = 2.5; }),
      overflowingAmount: changed(x => {
        x.grossSalaryQuotes[0].grossAtoms = Number.MAX_SAFE_INTEGER + 1;
      }),
      nonIntegerBase: changed(x => { x.grossSalaryQuotes[0].baseAtoms = 2.5; }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const results = await page.evaluate(async testCases => {
      const { publicGrossSalaryQuotes } =
        await import("/src/features/city/activityMarkers.ts");
      return Object.fromEntries(Object.entries(testCases)
        .map(([name, snapshot]) => [name, publicGrossSalaryQuotes(snapshot)]));
    }, cases);
    expect(Object.keys(results)).toEqual(Object.keys(cases));
    for (const [name, visible] of Object.entries(results))
      expect(visible, name).toEqual([]);
    expect(JSON.stringify(cases)).toBe(before);
    expect(baseline.grossSalaryQuotes).toHaveLength(count);
  });
}


for (const count of [2, 4, 8] as const) {
  test(`#107: ${count}-seat missing/empty quotes fail closed, complete reverse order is preserved`,
    async ({ page }) => {
    const complete = fixture(count);
    const missing = structuredClone(complete);
    missing.grossSalaryQuotes.pop();
    const empty = structuredClone(complete);
    empty.grossSalaryQuotes.length = 0;
    const reversed = structuredClone(complete);
    reversed.grossSalaryQuotes.reverse();
    const before = JSON.stringify({ complete, missing, empty, reversed });
    await page.goto("/");
    const projections = await page.evaluate(async states => {
      const { publicGrossSalaryQuotes } =
        await import("/src/features/city/activityMarkers.ts");
      return {
        complete: publicGrossSalaryQuotes(states.complete),
        missing: publicGrossSalaryQuotes(states.missing),
        empty: publicGrossSalaryQuotes(states.empty),
        reversed: publicGrossSalaryQuotes(states.reversed),
      };
    }, { complete, missing, empty, reversed });
    expect(projections.complete).toEqual(complete.grossSalaryQuotes);
    expect(projections.missing).toEqual([]);
    expect(projections.empty).toEqual([]);
    expect(projections.reversed).toEqual(reversed.grossSalaryQuotes);
    expect(JSON.stringify({ complete, missing, empty, reversed })).toBe(before);
  });
}

test("#105: malformed public quote projections never throw or display gross values",
  async ({ page }) => {
  const state = fixture(2);
  await page.goto("/");
  const results = await page.evaluate(async snapshot => {
    const { publicGrossSalaryQuotes } =
      await import("/src/features/city/activityMarkers.ts");
    const cases: unknown[] = [
      null, [], "fake", {},
      { ...snapshot, players: null },
      { ...snapshot, grossSalaryQuotes: null },
      { ...snapshot, grossSalaryQuotes: "invalid" },
      { ...snapshot, grossSalaryQuotes: [null] },
      { ...snapshot, grossSalaryQuotes: [{}] },
      { ...snapshot, controlledActivities: null },
      { ...snapshot, boardActivities: null },
      { ...snapshot, players: [{ playerId: "alice", streetId: "gauss" },
        { playerId: "alice", streetId: "gauss" }] },
    ];
    return cases.map(item => publicGrossSalaryQuotes(item as typeof snapshot));
  }, state);
  expect(results).toHaveLength(12);
  for (const result of results) expect(result).toEqual([]);
});

// #140: a forged UNCONTROLLED card previously escaped the salary view even
// though #111 correctly hid the board card count. Test the REAL coupled
// guard path through Vite; no client economy is recreated in this fixture.
for (const count of [2, 4, 8] as const) {
  test(`#140: ${count}-seat full-board card integrity gates all public economic views`,
    async ({ page }) => {
      const sample = fixture(count);
      const baseline = {
        ...sample,
        players: sample.players.map(p => ({
          ...p, atoms: 4, diplomacyTokens: 2,
          henchmenTotal: 16, henchmenAvailable: 15,
        })),
      };
      // N-08 is canonical and intentionally does not belong to any
      // controlled owner in this 2/4/8-seat synthetic snapshot.
      const good = structuredClone(baseline);
      good.boardActivities.push({
        slotId: "N-08", cardId: "synthetic:uncontrolled:valid", category: "culture",
      });
      const tamper = (mutate: (s: typeof good) => void) => {
        const next = structuredClone(good);
        mutate(next);
        return next;
      };
      const invalid = {
        duplicateUncontrolled: tamper(s => {
          s.boardActivities.push({ ...s.boardActivities[s.boardActivities.length - 1] });
        }),
        foreignUncontrolled: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].slotId = "not-printed";
        }),
        malformedUncontrolledCategory: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].category = 42 as unknown as string;
        }),
        malformedUncontrolledId: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].cardId = null as unknown as string;
        }),
        noncanonicalUncontrolledSlotType: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].slotId = 3 as unknown as string;
        }),
      };
      const before = JSON.stringify({ good, invalid });
      await page.goto("/");
      const result = await page.evaluate(async ({ good, invalid }) => {
        const m = await import("/src/features/city/activityMarkers.ts");
        const { verifiedPublicSeatEconomy } =
          await import("/src/features/city/publicSeatEconomy.ts");
        const { verifiedPublicSeatResources } =
          await import("/src/features/city/publicSeatResources.ts");
        const summary = (s: typeof good) => ({
          cards: m.verifiedPublicBoardCardCount(s),
          salary: m.publicGrossSalaryQuotes(s),
          economy: verifiedPublicSeatEconomy(s).size,
          resources: verifiedPublicSeatResources(s).size,
          independentControlled: m.controlledLotMarkers(s).length,
        });
        return {
          valid: summary(good),
          forged: Object.fromEntries(Object.entries(invalid)
            .map(([key, item]) => [key, summary(item)])),
        };
      }, { good, invalid });
      expect(result.valid.cards).toBe(count + 1);
      expect(result.valid.salary).toEqual(good.grossSalaryQuotes);
      expect(result.valid.economy).toBe(count);
      expect(result.valid.resources).toBe(count);
      expect(result.valid.independentControlled).toBe(count);
      for (const [name, forged] of Object.entries(result.forged)) {
        expect(forged.cards, name).toBeNull();
        expect(forged.salary, name).toEqual([]);
        expect(forged.economy, name).toBe(0);
        expect(forged.resources, name).toBe(0);
        // The pre-existing controlled-lot guard intentionally rejects the
        // ENTIRE list on a non-string slotId (untrusted runtime shape).
        // Valid-but-foreign and duplicate unowned slots do not disturb
        // otherwise verifiable controlled markers. Never relax that guard
        // just to make an independent-visibility test pass.
        expect(forged.independentControlled, name)
          .toBe(name === "noncanonicalUncontrolledSlotType" ? 0 : count);
      }
      expect(JSON.stringify({ good, invalid })).toBe(before);
    });
}
