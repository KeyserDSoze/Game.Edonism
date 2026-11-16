import { expect, test } from "@playwright/test";

// #136: Exercise the actual TypeScript module through Vite, not a test-only
// copy. This flag is public presentation ONLY: false does not authorize moves.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

for (const count of [2, 4, 8] as const) {
  test(`#136: ${count}-seat public free-move flags follow only the verified roster`,
    async ({ page }) => {
      const players = names.slice(0, count).map((playerId, index) => ({
        playerId,
        streetId: index % 2 ? "einstein" : "gauss",
        startingSlotId: "N-" + String(index + 1).padStart(2, "0"),
        freeMoveUsed: index % 2 === 0,
      }));
      const switched = players.map((seat, index) =>
        index === 0 ? { ...seat, freeMoveUsed: false } : seat);
      const defective = {
        duplicate: players.map((seat, index) =>
          index === count - 1 ? { ...seat, playerId: "alice" } : seat),
        invalidFlag: players.map((seat, index) =>
          index === 0 ? { ...seat, freeMoveUsed: "false" } : seat),
        missingFlag: players.map((seat, index) =>
          index === 0 ? { playerId: seat.playerId, streetId: seat.streetId } : seat),
        unknownStreet: players.map((seat, index) =>
          index === 0 ? { ...seat, streetId: "unmapped-road" } : seat),
        nullSeat: players.map((seat, index) =>
          index === 0 ? null : seat),
        systemSeat: players.map((seat, index) =>
          index === 0 ? { ...seat, playerId: "system" } : seat),
        invalidContainer: null,
        tooMany: [...players, ...names.map((name, index) => ({
          playerId: "other-" + name + index, streetId: "gauss",
          freeMoveUsed: false,
        }))],
      };
      const before = JSON.stringify({ players, switched, defective });
      await page.goto("/");
      const result = await page.evaluate(async ({ players, switched, defective }) => {
        const { verifiedPublicFreeMoveUsage: guard } =
          await import("/src/features/city/playerFreeMoveUsage.ts");
        return {
          initial: [...guard(players)],
          switched: [...guard(switched)],
          invalid: Object.entries(defective).map(([name, value]) =>
            [name, guard(value).size]),
          empty: guard(undefined).size,
        };
      }, { players, switched, defective });
      expect(result.initial).toEqual(players.map(p => [p.playerId, p.freeMoveUsed]));
      expect(result.switched).toEqual(switched.map(p => [p.playerId, p.freeMoveUsed]));
      expect(result.invalid).toEqual(Object.keys(defective).map(name => [name, 0]));
      expect(result.empty).toBe(0);
      expect(JSON.stringify({ players, switched, defective })).toBe(before);
    });
}
