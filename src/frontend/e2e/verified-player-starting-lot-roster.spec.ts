import { expect, test } from "@playwright/test";

// #130: Direct real-Vite import of the PUBLIC display helper, no copied
// server-authored board source or entitlement logic.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
for(const count of [2, 4, 8] as const) {
  test("#130: canonical origin badges are stable under public moves for "
    + count + " seats", async ({ page }) => {
    const original = ids.slice(0, count).map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
      streetId: i % 2 ? "einstein" : "gauss",
    }));
    const before = JSON.stringify(original);
    await page.goto("/");
    const result = await page.evaluate(async players => {
      const { verifiedPublicStartingLots: display } =
        await import("/src/features/city/playerStartingLots.ts");
      const { cityBoard } = await import("/src/features/city/board.ts");
      const slots = cityBoard.slots.map(s => s.id);
      const variants = slots.map(last => {
        const taken = slots.filter(s => s !== last).slice(0, players.length - 1);
        const data = players.map((p, i) => ({
          ...p, startingSlotId: i === players.length - 1 ? last : taken[i],
        }));
        return [...display(data).values()];
      });
      const moved = players.map((p,i) =>
        i === 0 ? { ...p, streetId: "planck" } : p);
      return {
        count: slots.length,
        baseline: [...display(players).entries()],
        variants,
        moved: [...display(moved).entries()],
      };
    }, original);
    expect(result.count).toBe(30);
    expect(result.baseline).toEqual(original.map(p => [p.playerId, p.startingSlotId]));
    expect(result.variants.every(v => v.length === count)).toBe(true);
    expect(result.moved).toEqual(result.baseline);
    expect(JSON.stringify(original)).toBe(before);
  });

  test("#130: malformed or duplicate origin data hides all public badges for "
    + count + " seats", async ({ page }) => {
    const players = ids.slice(0, count).map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
      streetId: "gauss",
    }));
    const variants: unknown[] = [
      null, {}, [], "invalid",
      players.map((p,i) => i === count - 1
        ? { ...p, startingSlotId: "N-01" } : p),
      players.map((p,i) => i === count - 1
        ? { ...p, startingSlotId: "foreign-lot" } : p),
      players.map((p,i) => i === count - 1
        ? { ...p, startingSlotId: null } : p),
      players.map((p,i) => i === count - 1
        ? { ...p, startingSlotId: 42 } : p),
      players.map((p,i) => i === count - 1
        ? { ...p, playerId: players[0].playerId } : p),
      players.map((p,i) => i === count - 1 ? null : p),
    ];
    const before = JSON.stringify({ players, variants });
    await page.goto("/");
    const result = await page.evaluate(async ({ players, variants }) => {
      const { verifiedPublicStartingLots: display } =
        await import("/src/features/city/playerStartingLots.ts");
      return {
        rejected: variants.map(value => display(value).size),
        accepted: display(players).size,
      };
    }, { players, variants });
    expect(result.rejected).toEqual(variants.map(() => 0));
    expect(result.accepted).toBe(count);
    expect(JSON.stringify({ players, variants })).toBe(before);
  });
}
