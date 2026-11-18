import { expect, test } from "@playwright/test";

// #167: the actual Vite modules, backed by the printed 30-slot/7-road board.
// These are public *comparisons*, never a street-control gameplay mechanic.
for (const seats of [2, 4, 8] as const) {
  test("#167: " + seats + " seats show every co-leader and empty street, fail closed",
    async ({ page }) => {
      await page.goto("/");
      const actual = await page.evaluate(async count => {
        const { cityBoard } = await import("/src/features/city/board.ts");
        const { printedActivityCategoryQuotas } = await import(
          "/src/features/city/activityMarkers.ts");
        const { verifiedPublicStreetPlurality: verify } = await import(
          "/src/features/city/publicStreetPlurality.ts");
        const players = ["Renée", "王小明", "System", "🙂",
          "alpha", "bravo", "charlie", "delta"].slice(0, count);
        const categories = [...printedActivityCategoryQuotas]
          .flatMap(([key, size]) => Array(size).fill(key) as string[]);
        const target = cityBoard.streets[0].id;
        const targetSlots = cityBoard.slots.filter(s => s.streetId === target);
        const awaySlots = cityBoard.slots.filter(s => s.streetId !== target);
        const initial = [
          { slotId: targetSlots[0].id, ownerPlayerId: players[0], posture: 0 },
          { slotId: targetSlots[1].id, ownerPlayerId: players[1], posture: 1 },
          ...players.slice(2).map((ownerPlayerId, index) => ({
            slotId: awaySlots[index].id, ownerPlayerId, posture: index % 2,
          })),
        ];
        const base = {
          activePlayerId: players[0] as string | null,
          players: players.map((playerId, i) => ({
            playerId, streetId: cityBoard.streets[i % 7].id,
          })),
          boardActivities: cityBoard.slots.map((slot, i) => ({
            slotId: slot.id, cardId: "synthetic:public:" + slot.id,
            category: categories[i],
          })),
          controlledActivities: initial,
          privateHand: ["NEVER_EXPOSE_PRIVATE_HAND"],
          token: "NEVER_EXPOSE_BEARER",
        };
        const change = (mutate: (state: typeof base) => void) => {
          const state = structuredClone(base);
          mutate(state);
          return state;
        };
        const solo = change(state => {
          state.controlledActivities.push({
            slotId: targetSlots[2].id, ownerPlayerId: players[0], posture: 1,
          });
        });
        const allFree = change(state => { state.controlledActivities = []; });
        const settled = change(state => { state.activePlayerId = null; });
        const bad: Record<string, unknown> = {
          nullInput: null,
          duplicateCard: change(s => { s.boardActivities[1].cardId = s.boardActivities[0].cardId; }),
          foreignCardSlot: change(s => { s.boardActivities[1].slotId = "outside-city"; }),
          missingCard: change(s => { s.boardActivities.pop(); }),
          unknownOwner: change(s => { s.controlledActivities[0].ownerPlayerId = "intruder"; }),
          duplicateOwner: change(s => { s.players[1].playerId = players[0]; }),
          reservedOwner: change(s => { s.players[0].playerId = "system"; }),
          badPosture: change(s => { s.controlledActivities[1].posture = 3; }),
          wrongStreet: change(s => { s.players[1].streetId = "outer-space"; }),
          missingSeat: { ...base, players: base.players.slice(0, 1) },
        };
        const before = JSON.stringify({ base, solo, allFree, settled, bad });
        return {
          target, count,
          printedStreets: cityBoard.streets.map(street => street.id),
          targetSlots: targetSlots.length,
          shared: verify(base),
          solo: verify(solo),
          allFree: verify(allFree),
          settled: verify(settled),
          invalid: Object.entries(bad).map(([key, value]) => [key, verify(value).length]),
          unchanged: before === JSON.stringify({ base, solo, allFree, settled, bad }),
        };
      }, seats);

      expect(actual.targetSlots).toBeGreaterThanOrEqual(3);
      expect(actual.shared.map(s => s.streetId)).toEqual(actual.printedStreets);
      expect(actual.shared).toHaveLength(7);
      expect(actual.shared.reduce((sum, s) => sum + s.controlledLots, 0)).toBe(seats);
      const tied = actual.shared.find(s => s.streetId === actual.target)!;
      expect(tied.maxControlled).toBe(1);
      expect(tied.leaders.map(p => p.playerId)).toEqual(["Renée", "王小明"]);
      expect(tied.leaders.map(p => p.controlled)).toEqual([1, 1]);
      expect(tied.leaders.map(p => p.standing)).toEqual([1, 0]);
      expect(tied.leaders.map(p => p.fallen)).toEqual([0, 1]);

      const single = actual.solo.find(s => s.streetId === actual.target)!;
      expect(single.maxControlled).toBe(2);
      expect(single.leaders.map(p => p.playerId)).toEqual(["Renée"]);
      expect(single.leaders[0].standing).toBe(1);
      expect(single.leaders[0].fallen).toBe(1);
      expect(actual.solo.reduce((sum, s) => sum + s.controlledLots, 0))
        .toBe(seats + 1);

      // A zero-lot road must not pretend that EVERY zero-owning player leads.
      expect(actual.allFree).toHaveLength(7);
      for (const street of actual.allFree) {
        expect(street.maxControlled).toBe(0);
        expect(street.controlledLots).toBe(0);
        expect(street.leaders).toEqual([]);
      }
      expect(actual.shared.some(s => s.controlledLots === 0
        && s.maxControlled === 0 && s.leaders.length === 0)).toBe(true);
      expect(actual.settled).toEqual(actual.shared);
      for (const [key, length] of actual.invalid)
        expect(length, key).toBe(0);
      expect(JSON.stringify(actual)).not.toMatch(/NEVER_EXPOSE/);
      expect(actual.unchanged).toBe(true);
    });
}
