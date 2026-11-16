import { expect, test } from "@playwright/test";

// #139: Test ACTUAL source via Vite; no test-only duplicate of the verifier.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const roads = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];
const slots = ["N-01", "S-01", "W-01", "E-01", "B-01", "M-01", "N-02", "N-03"];
function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  return {
    matchId: "synthetic-public-resources", revision: 0,
    activePlayerId: "alice" as string | null,
    players: ids.map((playerId, i) => ({
      playerId, streetId: roads[i], atoms: i === 0 ? 0 : 4,
      diplomacyTokens: i === 1 ? 0 : 2,
      henchmenTotal: 16, henchmenAvailable: 15,
    })),
    boardActivities: ids.map((_, i) => ({
      slotId: slots[i], cardId: "synthetic:activity:" + i, category: "culture",
    })),
    controlledActivities: ids.map((ownerPlayerId, i) => ({
      slotId: slots[i], ownerPlayerId, posture: i % 2,
    })),
    grossSalaryQuotes: ids.map((playerId, i) => ({
      playerId, baseAtoms: 2, standingActivityAtoms: i % 2 ? 0 : 1,
      grossAtoms: i % 2 ? 2 : 3,
    })),
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#139: ${count}-seat public resources show genuine zero values and 0-lot rivals`,
    async ({ page }) => {
      const state = fixture(count);
      const withZeroLots = structuredClone(state);
      withZeroLots.controlledActivities = withZeroLots.controlledActivities.slice(0, 2);
      for (let i = 2; i < count; i++) {
        withZeroLots.players[i].henchmenAvailable = 16;
        withZeroLots.grossSalaryQuotes[i].standingActivityAtoms = 0;
        withZeroLots.grossSalaryQuotes[i].grossAtoms = 2;
      }
      const original = JSON.stringify({ state, withZeroLots });
      await page.goto("/");
      const result = await page.evaluate(async input => {
        const { verifiedPublicSeatResources: guard } =
          await import("/src/features/city/publicSeatResources.ts");
        return {
          full: [...guard(input.state)],
          zeroLots: [...guard(input.withZeroLots)],
          nullInput: guard(null).size,
        };
      }, { state, withZeroLots });
      expect(result.full).toEqual(state.players.map(p => [p.playerId, {
        atoms: p.atoms, diplomacyTokens: p.diplomacyTokens,
        henchmenTotal: p.henchmenTotal, henchmenAvailable: p.henchmenAvailable,
      }]));
      expect(result.zeroLots).toEqual(withZeroLots.players.map(p => [p.playerId, {
        atoms: p.atoms, diplomacyTokens: p.diplomacyTokens,
        henchmenTotal: p.henchmenTotal, henchmenAvailable: p.henchmenAvailable,
      }]));
      expect(result.nullInput).toBe(0);
      expect(JSON.stringify({ state, withZeroLots })).toBe(original);
    });

  test(`#139: ${count}-seat malformed resource, roster or controlled lot hides ALL public values`,
    async ({ page }) => {
      const baseline = fixture(count);
      const changed = (mutate: (state: typeof baseline) => void) => {
        const clone = structuredClone(baseline);
        mutate(clone);
        return clone;
      };
      const cases: Record<string, unknown> = {
        missingAtom: changed(s => { s.players[0] = {
          ...s.players[0], atoms: undefined as unknown as number }; }),
        negativeAtom: changed(s => { s.players[0].atoms = -1; }),
        fractionalAtom: changed(s => { s.players[0].atoms = 2.5; }),
        overflowingAtom: changed(s => { s.players[0].atoms = Number.MAX_SAFE_INTEGER + 1; }),
        stringAtom: changed(s => { s.players[0].atoms = "4" as unknown as number; }),
        nullAtom: changed(s => { s.players[0].atoms = null as unknown as number; }),
        missingDiplomacy: changed(s => { s.players[0].diplomacyTokens = undefined as unknown as number; }),
        negativeDiplomacy: changed(s => { s.players[0].diplomacyTokens = -1; }),
        fractionalDiplomacy: changed(s => { s.players[0].diplomacyTokens = 1.5; }),
        badTotal: changed(s => { s.players[0].henchmenTotal = -1; }),
        fractionalTotal: changed(s => { s.players[0].henchmenTotal = 16.5; }),
        wrongReserve: changed(s => { s.players[0].henchmenAvailable = 14; }),
        overReserve: changed(s => { s.players[0].henchmenAvailable = 17; }),
        fractionalReserve: changed(s => { s.players[0].henchmenAvailable = 14.5; }),
        negativeReserve: changed(s => { s.players[0].henchmenAvailable = -1; }),
        missingReserve: changed(s => { s.players[0].henchmenAvailable = undefined as unknown as number; }),
        duplicatedPlayer: changed(s => { s.players[1].playerId = "alice"; }),
        reservedActor: changed(s => { s.players[0].playerId = "system"; }),
        foreignStreet: changed(s => { s.players[0].streetId = "outside-city"; }),
        missingQuote: changed(s => { s.grossSalaryQuotes.pop(); }),
        incompatibleStanding: changed(s => { s.grossSalaryQuotes[0].standingActivityAtoms = 0; }),
        unknownLotOwner: changed(s => { s.controlledActivities[0].ownerPlayerId = "intruder"; }),
        bogusPosture: changed(s => { s.controlledActivities[0].posture = 99; }),
        nullContainer: null,
      };
      const original = JSON.stringify({ baseline, cases });
      await page.goto("/");
      const result = await page.evaluate(async values => {
        const { verifiedPublicSeatResources: guard } =
          await import("/src/features/city/publicSeatResources.ts");
        return Object.fromEntries(Object.entries(values).map(([name, val]) => [
          name, guard(val).size,
        ]));
      }, cases);
      expect(Object.keys(result)).toEqual(Object.keys(cases));
      for (const [name, size] of Object.entries(result))
        expect(size, name).toBe(0);
      expect(JSON.stringify({ baseline, cases })).toBe(original);
    });
}
