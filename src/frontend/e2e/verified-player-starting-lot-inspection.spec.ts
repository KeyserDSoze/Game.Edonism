import { expect, test } from "@playwright/test";

// #131: Real Vite board and public display guard, no duplicated lot graph
// and no new client movement or ownership calculation.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
for (const count of [2, 4, 8] as const) {
  test("#131: starting lot inspection maps every printed slot to its original "
    + "street for " + count + " public seats", async ({ page }) => {
    const original = ids.slice(0, count).map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
      streetId: "planck",  // Current pawn location is intentionally unrelated.
    }));
    const before = JSON.stringify(original);
    await page.goto("/");
    const result = await page.evaluate(async players => {
      const { verifiedPublicStartingLots: guarded } =
        await import("/src/features/city/playerStartingLots.ts");
      const { cityBoard, slotById } =
        await import("/src/features/city/board.ts");
      const targets = cityBoard.slots.map(slot => ({
        id: slot.id,
        targetStreet: slotById(slot.id)?.streetId,
        expectedStreet: slot.streetId,
      }));
      const visible = [...guarded(players).entries()];
      const locations = visible.map(([player, slot]) => ({
        player, slot, targetStreet: slotById(slot)?.streetId,
      }));
      const malformed = structuredClone(players);
      malformed[malformed.length - 1].startingSlotId = "invalid-slot";
      return {
        targets, locations,
        unaffectedByPawnStreet: visible.length === players.length,
        invalidSuppressed: guarded(malformed).size === 0,
        foreignTargetUnavailable: slotById("foreign-slot") === undefined,
      };
    }, original);
    expect(result.targets).toHaveLength(30);
    expect(result.targets.every(x => x.targetStreet === x.expectedStreet)).toBe(true);
    expect(result.locations).toHaveLength(count);
    expect(result.locations.every(x => x.targetStreet === "gauss")).toBe(true);
    expect(result.unaffectedByPawnStreet).toBe(true);
    expect(result.invalidSuppressed).toBe(true);
    expect(result.foreignTargetUnavailable).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });
}
