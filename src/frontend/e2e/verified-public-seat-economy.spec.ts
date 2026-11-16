import { expect, test } from "@playwright/test";

// #138: production TypeScript helper via actual Vite browser module graph,
// not an independent JS reimplementation or a new client economy engine.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck", "boson", "meson", "main-square", "gauss"];
const slots = ["N-01", "S-01", "W-01", "E-01", "B-01", "M-01", "N-02", "N-03"];

function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  return {
    matchId: "economic-public-scouting",
    revision: 0, activePlayerId: "alice" as string | null,
    players: ids.map((playerId, i) => ({ playerId, streetId: streets[i] })),
    boardActivities: ids.map((_, i) => ({
      slotId: slots[i], cardId: "synthetic:public:" + i, category: "culture",
    })),
    controlledActivities: ids.map((ownerPlayerId, i) => ({
      slotId: slots[i], ownerPlayerId, posture: i % 2,
    })),
    grossSalaryQuotes: ids.map((playerId, i) => ({
      playerId, baseAtoms: 2, standingActivityAtoms: i % 2 === 0 ? 1 : 0,
      grossAtoms: i % 2 === 0 ? 3 : 2,
    })),
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#138: ${count} public seats have verified controlled, standing/fallen and gross quotes`,
    async ({ page }) => {
      const state = fixture(count);
      const withFreeSeats = structuredClone(state);
      // Owners after the first two have no henchman: nevertheless they get
      // exactly the server's 2-base-atom gross quote (NOT an awarded salary).
      withFreeSeats.controlledActivities = withFreeSeats.controlledActivities.slice(0, 2);
      for (const quote of withFreeSeats.grossSalaryQuotes.slice(2)) {
        quote.standingActivityAtoms = 0;
        quote.grossAtoms = 2;
      }
      const before = JSON.stringify({ state, withFreeSeats });
      await page.goto("/");
      const result = await page.evaluate(async ({ state, withFreeSeats }) => {
        const { verifiedPublicSeatEconomy: guard } =
          await import("/src/features/city/publicSeatEconomy.ts");
        return {
          regular: [...guard(state)],
          freeSeats: [...guard(withFreeSeats)],
          absent: guard(null).size,
        };
      }, { state, withFreeSeats });
      expect(result.regular).toEqual(state.players.map((seat, i) => [
        seat.playerId, {
          controlledLots: 1, standing: i % 2 === 0 ? 1 : 0,
          fallen: i % 2, grossAtoms: i % 2 === 0 ? 3 : 2,
        },
      ]));
      expect(result.freeSeats).toEqual(state.players.map((seat, i) => [
        seat.playerId, {
          controlledLots: i < 2 ? 1 : 0, standing: i === 0 ? 1 : 0,
          fallen: i === 1 ? 1 : 0, grossAtoms: i === 0 ? 3 : 2,
        },
      ]));
      expect(result.absent).toBe(0);
      expect(JSON.stringify({ state, withFreeSeats })).toBe(before);
    });

  test(`#138: ${count}-seat forged public economy cannot show any city summary`,
    async ({ page }) => {
      const state = fixture(count);
      const changed = (edit: (s: typeof state) => void) => {
        const x = structuredClone(state);
        edit(x);
        return x;
      };
      const cases: Record<string, unknown> = {
        missingQuote: changed(x => { x.grossSalaryQuotes.pop(); }),
        duplicateQuote: changed(x => { x.grossSalaryQuotes[1] = { ...x.grossSalaryQuotes[0] }; }),
        wrongQuoteTotal: changed(x => { x.grossSalaryQuotes[0].grossAtoms = 999; }),
        forgedStanding: changed(x => { x.grossSalaryQuotes[0].standingActivityAtoms = 0; x.grossSalaryQuotes[0].grossAtoms = 2; }),
        malformedBase: changed(x => { x.grossSalaryQuotes[0].baseAtoms = 4; x.grossSalaryQuotes[0].grossAtoms = 5; }),
        foreignQuoteOwner: changed(x => { x.grossSalaryQuotes[0].playerId = "outsider"; }),
        missingControlledCard: changed(x => { x.boardActivities.shift(); }),
        missingControlledLot: changed(x => { x.controlledActivities.shift(); }),
        foreignControlledLot: changed(x => { x.controlledActivities[0].slotId = "foreign-lot"; }),
        duplicateControlledLot: changed(x => { x.controlledActivities.push({ ...x.controlledActivities[0] }); }),
        forgedOwner: changed(x => { x.controlledActivities[0].ownerPlayerId = "outsider"; }),
        badPosture: changed(x => { x.controlledActivities[0].posture = 42; }),
        malformedCard: changed(x => { x.boardActivities[0].cardId = 99 as unknown as string; }),
        duplicateSeat: changed(x => { x.players[1].playerId = "alice"; }),
        reservedSeat: changed(x => { x.players[0].playerId = "system"; }),
        foreignStreet: changed(x => { x.players[0].streetId = "foreign-street"; }),
        emptyQuotes: changed(x => { x.grossSalaryQuotes = []; }),
        malformedContainer: null,
      };
      // An omitted control while an unchanged quote says standing=1 MUST
      // hide all rows, and a forged duplicate must never become 2 controls.
      const before = JSON.stringify(cases);
      await page.goto("/");
      const result = await page.evaluate(async cases => {
        const { verifiedPublicSeatEconomy: guard } =
          await import("/src/features/city/publicSeatEconomy.ts");
        return Object.fromEntries(Object.entries(cases).map(([name, s]) =>
          [name, guard(s).size]));
      }, cases);
      expect(Object.keys(result)).toEqual(Object.keys(cases));
      for (const [name, size] of Object.entries(result))
        expect(size, name).toBe(0);
      expect(JSON.stringify(cases)).toBe(before);
    });
}
