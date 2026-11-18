import { expect, test } from "@playwright/test";

// #168: real Vite resource verification must agree with the immutable
// 16-henchman printed per-seat budget enforced by .NET GrossSalaryRules.
const ids = ["Renée", "王小明", "System", "🙂", "alpha", "bravo", "charlie", "delta"];
const roads = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "main-square", "gauss"];
const slots = ["N-01", "S-01", "W-01", "E-01", "B-01", "M-01", "N-02", "N-03"];

for (const seats of [2, 4, 8] as const) {
  test("#168: " + seats + " public seats reject self-consistent forged reserve totals",
    async ({ page }) => {
      await page.goto("/");
      const result = await page.evaluate(async count => {
        const { verifiedPublicSeatResources: verify } = await import(
          "/src/features/city/publicSeatResources.ts");
        const players = ids.slice(0, count);
        const base = {
          matchId: "public-168", revision: 0,
          activePlayerId: players[0],
          players: players.map((playerId, i) => ({
            playerId, streetId: roads[i],
            atoms: i === 0 ? 0 : 4, diplomacyTokens: i === 1 ? 0 : 2,
            henchmenTotal: 16, henchmenAvailable: 15,
          })),
          boardActivities: players.map((_, i) => ({
            slotId: slots[i], cardId: "test:card:" + i, category: "culture",
          })),
          controlledActivities: players.map((ownerPlayerId, i) => ({
            slotId: slots[i], ownerPlayerId, posture: i % 2,
          })),
          grossSalaryQuotes: players.map((playerId, i) => ({
            playerId, baseAtoms: 2,
            standingActivityAtoms: i % 2 === 0 ? 1 : 0,
            grossAtoms: i % 2 === 0 ? 3 : 2,
          })),
        };
        const changed = (input: typeof base, modify: (s: typeof base) => void) => {
          const copy = structuredClone(input);
          modify(copy);
          return copy;
        };
        const noLot = changed(base, s => {
          s.controlledActivities.pop();
          s.players[count - 1].henchmenAvailable = 16;
          s.grossSalaryQuotes[count - 1].standingActivityAtoms = 0;
          s.grossSalaryQuotes[count - 1].grossAtoms = 2;
        });
        const caseOneLot = (total: number, available: number, owner = count - 1) =>
          changed(base, s => {
            s.players[owner].henchmenTotal = total;
            s.players[owner].henchmenAvailable = available;
          });
        const caseZeroLot = (total: number, available: number) =>
          changed(noLot, s => {
            s.players[count - 1].henchmenTotal = total;
            s.players[count - 1].henchmenAvailable = available;
          });
        const forbidden = {
          fifteenFourteen: caseOneLot(15, 14),
          seventeenSixteen: caseOneLot(17, 16),
          oneZero: caseOneLot(1, 0),
          zeroZeroNoLot: caseZeroLot(0, 0),
          fifteenFifteenNoLot: caseZeroLot(15, 15),
          seventeenSeventeenNoLot: caseZeroLot(17, 17),
          firstSeatModified: caseOneLot(15, 14, 0),
          missingTotal: changed(base, s => { s.players[0].henchmenTotal =
            undefined as unknown as number; }),
          fractionalTotal: caseOneLot(16.5, 15.5),
          stringTotal: changed(base, s => { s.players[0].henchmenTotal =
            "16" as unknown as number; }),
          nullTotal: changed(base, s => { s.players[0].henchmenTotal =
            null as unknown as number; }),
        };
        const original = JSON.stringify({ base, noLot, forbidden });
        return {
          valid: [...verify(base)],
          zeroLot: [...verify(noLot)],
          bad: Object.entries(forbidden).map(([key, snapshot]) =>
            [key, verify(snapshot).size] as const),
          unchanged: original === JSON.stringify({ base, noLot, forbidden }),
        };
      }, seats);
      expect(result.valid).toHaveLength(seats);
      expect(result.zeroLot).toHaveLength(seats);
      expect(result.valid.map(([owner]) => owner)).toEqual(ids.slice(0, seats));
      expect(result.zeroLot[seats - 1][1].henchmenTotal).toBe(16);
      expect(result.zeroLot[seats - 1][1].henchmenAvailable).toBe(16);
      expect(result.valid[0][1].atoms).toBe(0);
      expect(result.valid[1][1].diplomacyTokens).toBe(0);
      expect(result.bad).toHaveLength(11);
      for (const [name, size] of result.bad) expect(size, name).toBe(0);
      expect(result.unchanged).toBe(true);
    });
}
