import { expect, test } from "@playwright/test";

// #148: execute the actual Vite TypeScript city selector in Chromium.
// Nearest is purely public *street* proximity, not a movement/attack option.
const allIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
for (const count of [2, 4, 8] as const) {
  test(`#148: ${count}-seat nearest rival shortlist includes ALL tied shortest hops`,
    async ({ page }) => {
      const roster = allIds.slice(0, count).map((playerId, i) => ({
        playerId, streetId: i % 2 ? "einstein" : "gauss",
      }));
      const valid = {
        activePlayerId: "alice" as string | null,
        players: roster,
        privateHand: ["NEVER_LEAK_CARD"],
        token: "NEVER_LEAK_TOKEN",
      };
      const edit = (fn: (x: typeof valid) => void) => {
        const copy = structuredClone(valid);
        fn(copy);
        return copy;
      };
      const allAtOrigin = edit(s => {
        for (const p of s.players) p.streetId = "gauss";
      });
      const sameStreetTies = edit(s => {
        // Multiple peers at the minimum 0 hops are all retained.
        if (count >= 4) {
          s.players[1].streetId = "gauss";
          s.players[2].streetId = "gauss";
          s.players[3].streetId = "einstein";
        } else {
          s.players[1].streetId = "gauss";
        }
      });
      const moved = edit(s => { s.players[0].streetId = "main-square"; });
      const rotated = edit(s => { s.activePlayerId = "bob"; });
      const pending = edit(s => { s.activePlayerId = null; });
      const invalid = {
        duplicateSeat: edit(s => { s.players[1].playerId = "alice"; }),
        reservedActor: edit(s => { s.activePlayerId = "system"; }),
        missingActor: edit(s => { s.activePlayerId = "ghost"; }),
        foreignStreet: edit(s => { s.players[0].streetId = "pluto"; }),
        malformedId: edit(s => { s.players[0].playerId = "alice "; }),
        nullSeat: edit(s => { s.players[1] = null as unknown as typeof roster[1]; }),
        singleSeat: { ...valid, players: valid.players.slice(0, 1) },
        tooManySeats: { ...valid, players: [
          ...valid.players,
          ...Array.from({ length: 9 - count }, (_, i) => ({
            playerId: `extra-${i}`, streetId: "gauss",
          })),
        ] },
        noPlayers: { activePlayerId: "alice" },
        notAnObject: null,
      };
      const frozenInput = JSON.stringify({
        valid, allAtOrigin, sameStreetTies, moved, rotated, pending, invalid,
      });
      await page.goto("/");
      const observed = await page.evaluate(async data => {
        const { verifiedNearestActiveTurnRivals: select } =
          await import("/src/features/city/nearestActiveTurnRivals.ts");
        return {
          valid: select(data.valid),
          allAtOrigin: select(data.allAtOrigin),
          sameStreetTies: select(data.sameStreetTies),
          moved: select(data.moved),
          rotated: select(data.rotated),
          pending: select(data.pending),
          invalid: Object.entries(data.invalid).map(([name, value]) =>
            [name, select(value).length]),
          noInput: select(undefined).length,
        };
      }, { valid, allAtOrigin, sameStreetTies, moved, rotated, pending, invalid });
      const min = count === 2 ? 2 : 0;
      const nearestIds = count === 2 ? ["bob"]
        : allIds.slice(0, count).filter((_, i) => i > 0 && i % 2 === 0);
      expect(observed.valid.map(x => x.playerId)).toEqual(nearestIds);
      expect(observed.valid.every(x =>
        x.streetSteps === min && x.fromPlayerId === "alice"
        && x.fromStreetId === "gauss")).toBe(true);
      expect(observed.allAtOrigin.map(x => x.playerId))
        .toEqual(allIds.slice(1, count));
      expect(observed.allAtOrigin.every(x =>
        x.streetSteps === 0 && x.streetPath.join(",") === "gauss")).toBe(true);
      expect(observed.sameStreetTies.map(x => x.playerId))
        .toEqual(count === 2 ? ["bob"] : ["bob", "charlie", ...nearestIds.filter(
          id => id !== "charlie")]);
      expect(observed.moved).toHaveLength(count - 1);
      expect(observed.moved.every(x => x.streetSteps === 1)).toBe(true);
      expect(observed.rotated.every(x => x.fromPlayerId === "bob")).toBe(true);
      expect(observed.rotated.some(x => x.playerId === "bob")).toBe(false);
      expect(observed.pending).toEqual([]);
      expect(observed.noInput).toBe(0);
      expect(observed.invalid).toEqual(
        Object.keys(invalid).map(name => [name, 0]));
      expect(JSON.stringify(observed)).not.toMatch(/NEVER_LEAK/);
      expect(JSON.stringify({
        valid, allAtOrigin, sameStreetTies, moved, rotated, pending, invalid,
      })).toBe(frozenInput);
    });
}
