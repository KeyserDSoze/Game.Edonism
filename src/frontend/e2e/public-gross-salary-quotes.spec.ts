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

// #142: printed card identity, not just printed slot identity, must be
// one-to-one. These Vite-browser assertions call the REAL production TS
// validators, including the gross/economy/resources transitive guards.
for (const count of [2, 4, 8] as const) {
  test(`#142: ${count} seats reject duplicated physical activity card IDs across distinct slots`,
    async ({ page }) => {
      const original = fixture(count);
      const legitimate = {
        ...original,
        players: original.players.map(p => ({
          ...p, atoms: 4, diplomacyTokens: 2,
          henchmenTotal: 16, henchmenAvailable: 15,
        })),
        boardActivities: [
          ...original.boardActivities,
          // Neither N-07 nor N-08 is controlled in this fixture.
          { slotId: "N-07", cardId: "synthetic:card:case", category: "culture" },
          { slotId: "N-08", cardId: "synthetic:card:CASE", category: "culture" },
        ],
      };
      const tamper = (edit: (s: typeof legitimate) => void) => {
        const cloned = structuredClone(legitimate);
        edit(cloned);
        return cloned;
      };
      const forged = {
        unownedVsUnowned: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].cardId =
            s.boardActivities[s.boardActivities.length - 2].cardId;
        }),
        unownedVsControlled: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].cardId =
            s.boardActivities[0].cardId;
        }),
        controlledVsControlled: tamper(s => {
          s.boardActivities[1].cardId = s.boardActivities[0].cardId;
        }),
        malformedId: tamper(s => {
          s.boardActivities[s.boardActivities.length - 1].cardId = " ";
        }),
      };
      const unchanged = JSON.stringify({ legitimate, forged });
      await page.goto("/");
      const result = await page.evaluate(async ({ legitimate, forged }) => {
        const { verifiedPublicBoardCardCount: countCards,
          publicGrossSalaryQuotes: wages, controlledLotMarkers: controls } =
          await import("/src/features/city/activityMarkers.ts");
        const { verifiedPublicSeatEconomy: economy } =
          await import("/src/features/city/publicSeatEconomy.ts");
        const { verifiedPublicSeatResources: resources } =
          await import("/src/features/city/publicSeatResources.ts");
        const project = (state: typeof legitimate) => ({
          boardCount: countCards(state),
          quoteCount: wages(state).length,
          economicSeats: economy(state).size,
          resourceSeats: resources(state).size,
          independentControls: controls(state).length,
        });
        return {
          valid: project(legitimate),
          forged: Object.fromEntries(Object.entries(forged)
            .map(([key, state]) => [key, project(state)])),
          emptyBoard: countCards({ boardActivities: [] }),
        };
      }, { legitimate, forged });
      expect(result.valid).toEqual({
        boardCount: count + 2, quoteCount: count,
        economicSeats: count, resourceSeats: count, independentControls: count,
      });
      expect(result.emptyBoard).toBe(0);
      for (const [name, value] of Object.entries(result.forged)) {
        expect(value.boardCount, name).toBeNull();
        expect(value.quoteCount, name).toBe(0);
        expect(value.economicSeats, name).toBe(0);
        expect(value.resourceSeats, name).toBe(0);
        // The legacy #108 owned-lot renderer separately validates slot,
        // owner, posture and local card shape; never erase a valid pawn
        // or grant a game command just because the global count fails.
        expect(value.independentControls, name).toBe(count);
      }
      expect(JSON.stringify({ legitimate, forged })).toBe(unchanged);
    });
}

// #143: compare the ACTUAL Vite/TypeScript projector with the printed
// eight-category Domain quotas; valid partial fixtures remain displayable.
const fullPrintedSlots143 = [
  ...Array.from({ length: 8 }, (_, i) => `N-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `S-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `W-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `E-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `B-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`),
] as const;
const printedQuota143 = [
  ["public-financing", 5], ["private-financing", 5],
  ["black-market", 4], ["corruption", 4], ["culture", 4],
  ["sport", 2], ["transport", 3], ["bishopric", 3],
] as const;
const printedCategories143 = printedQuota143.flatMap(([name, count]) =>
  Array.from({ length: count }, () => name));

for (const count of [2, 4, 8] as const) {
  test(`#143: ${count} seats require canonical public categories and exact 30-card quotas`,
    async ({ page }) => {
      const base = fixture(count);
      const partial = {
        ...base,
        players: base.players.map(p => ({
          ...p, atoms: 4, diplomacyTokens: 2,
          henchmenTotal: 16, henchmenAvailable: 15,
        })),
      };
      const full = structuredClone(partial);
      full.boardActivities = fullPrintedSlots143.map((slotId, i) => ({
        slotId, cardId: `synthetic:full-deck:${i}`,
        category: printedCategories143[i] as string,
      }));
      const partialValid = structuredClone(partial);
      partialValid.boardActivities.push({
        slotId: "N-08", cardId: "synthetic:valid-unowned",
        category: "culture",
      });
      const tamper = (original: typeof full, edit: (s: typeof full) => void) => {
        const cloned = structuredClone(original);
        edit(cloned);
        return cloned;
      };
      const forged = {
        unknownPartial: tamper(partialValid, s => {
          s.boardActivities[s.boardActivities.length - 1].category = "alien";
        }),
        casingPartial: tamper(partialValid, s => {
          s.boardActivities[s.boardActivities.length - 1].category = "Culture";
        }),
        unknownFullUnowned: tamper(full, s => {
          s.boardActivities[s.boardActivities.length - 1].category = "alien";
        }),
        fullQuotaWrongButAllKnown: tamper(full, s => {
          s.boardActivities[s.boardActivities.length - 1].category = "culture";
        }),
      };
      const unchanged = JSON.stringify({ partial, partialValid, full, forged });
      await page.goto("/");
      const projection = await page.evaluate(async ({ partial, partialValid, full, forged }) => {
        const { verifiedPublicBoardCardCount: countCards,
          publicGrossSalaryQuotes: salary } =
          await import("/src/features/city/activityMarkers.ts");
        const { verifiedPublicSeatEconomy: economy } =
          await import("/src/features/city/publicSeatEconomy.ts");
        const { verifiedPublicSeatResources: resources } =
          await import("/src/features/city/publicSeatResources.ts");
        const read = (state: typeof full) => ({
          count: countCards(state), salary: salary(state).length,
          economy: economy(state).size, resources: resources(state).size,
        });
        return {
          partial: read(partial),
          partialValid: read(partialValid),
          full: read(full),
          invalid: Object.fromEntries(Object.entries(forged).map(
            ([key, state]) => [key, read(state)])),
          empty: countCards({ boardActivities: [] }),
        };
      }, { partial, partialValid, full, forged });
      expect(full.boardActivities).toHaveLength(30);
      expect(projection.partial).toEqual({
        count, salary: count, economy: count, resources: count,
      });
      expect(projection.partialValid).toEqual({
        count: count + 1, salary: count, economy: count, resources: count,
      });
      expect(projection.full).toEqual({
        count: 30, salary: count, economy: count, resources: count,
      });
      expect(projection.empty).toBe(0);
      for (const [name, result] of Object.entries(projection.invalid)) {
        expect(result, name).toEqual({
          count: null, salary: 0, economy: 0, resources: 0,
        });
      }
      expect(JSON.stringify({ partial, partialValid, full, forged }))
        .toBe(unchanged);
    });
}
