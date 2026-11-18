import { expect, test } from "@playwright/test";

// #171: import actual production Vite guard, not a test-only reimplementation.
// Presence is Development-only, non-authoritative for game actions.
const playerIds = ["Renée", "王小明", "System", "🙂",
  "alpha", "bravo", "charlie", "delta"];

for (const count of [2, 4, 8] as const) {
  test("#171: " + count + " canonical presence seats are read-only and exact",
    async ({ page }) => {
      const ids = playerIds.slice(0, count);
      const matchId = "presence-171";
      const valid = {
        matchId,
        seats: ids.map((playerId, index) => ({
          playerId, isActive: index % 2 === 0,
        })),
      };
      const allInactive = structuredClone(valid);
      allInactive.seats.forEach(seat => { seat.isActive = false; });
      const allActive = structuredClone(valid);
      allActive.seats.forEach(seat => { seat.isActive = true; });
      const before = JSON.stringify({ valid, allInactive, allActive, ids });
      await page.goto("/");
      const result = await page.evaluate(async ({ valid, allInactive, allActive, ids, matchId }) => {
        const { hasValidDevelopmentSeatPresence: verify } =
          await import("/src/features/matches/verifiedDevelopmentSeatPresence.ts");
        return {
          valid: verify(valid, matchId, ids),
          allInactive: verify(allInactive, matchId, ids),
          allActive: verify(allActive, matchId, ids),
          emptyRoster: verify(valid, matchId, []),
          foreignMatch: verify(valid, "other-match", ids),
          noMatch: verify(valid, "", ids),
        };
      }, { valid, allInactive, allActive, ids, matchId });
      expect(result).toEqual({
        valid: true, allInactive: true, allActive: true,
        emptyRoster: false, foreignMatch: false, noMatch: false,
      });
      expect(JSON.stringify({ valid, allInactive, allActive, ids })).toBe(before);
    });

  test("#171: " + count + " forged 200 presence fails closed for all seats",
    async ({ page }) => {
      const ids = playerIds.slice(0, count);
      const matchId = "presence-171";
      const valid = {
        matchId,
        seats: ids.map((playerId, index) => ({
          playerId, isActive: index % 2 === 0,
        })),
      };
      const changed = (edit: (row: typeof valid) => void): typeof valid => {
        const row = structuredClone(valid);
        edit(row);
        return row;
      };
      const forged: Record<string, unknown> = {
        extraRootLastSeen: Object.assign(changed(() => {}), { lastSeen: 123 }),
        extraRootSecret: Object.assign(changed(() => {}), { secret: "NEVER_EXPOSE" }),
        extraRootToken: Object.assign(changed(() => {}), { token: "NEVER_EXPOSE" }),
        extraRootInactiveHint: Object.assign(changed(() => {}), { canSkipTurn: false }),
        extraFirstSeatToken: changed(row => {
          Object.assign(row.seats[0], { token: "NEVER_EXPOSE" });
        }),
        extraLastSeatTimestamp: changed(row => {
          Object.assign(row.seats[count - 1], { lastSeen: "NEVER_EXPOSE" });
        }),
        extraLastSeatNull: changed(row => {
          Object.assign(row.seats[count - 1], { metadata: null });
        }),
        missingRootMatch: changed(row => {
          delete (row as unknown as Record<string, unknown>).matchId;
        }),
        missingRootSeats: changed(row => {
          delete (row as unknown as Record<string, unknown>).seats;
        }),
        missingRowPlayer: changed(row => {
          delete (row.seats[0] as unknown as Record<string, unknown>).playerId;
        }),
        missingRowActive: changed(row => {
          delete (row.seats[count - 1] as unknown as Record<string, unknown>).isActive;
        }),
        duplicatedPlayer: changed(row => { row.seats[count - 1].playerId = ids[0]; }),
        foreignPlayer: changed(row => { row.seats[count - 1].playerId = "intruder"; }),
        reorderedSeats: changed(row => { row.seats.reverse(); }),
        missingSeat: changed(row => { row.seats.pop(); }),
        extraSeat: changed(row => { row.seats.push({
          playerId: "intruder", isActive: true,
        }); }),
        numericActive: changed(row => { row.seats[0].isActive = 1 as unknown as boolean; }),
        nullActive: changed(row => { row.seats[0].isActive = null as unknown as boolean; }),
        stringActive: changed(row => { row.seats[0].isActive = "true" as unknown as boolean; }),
        nullSeat: changed(row => {
          row.seats[0] = null as unknown as typeof row.seats[0];
        }),
        arraySeat: changed(row => {
          row.seats[0] = [] as unknown as typeof row.seats[0];
        }),
        absent: null,
      };
      const original = JSON.stringify({ forged, valid, ids });
      await page.goto("/");
      const outcome = await page.evaluate(async ({ forged, matchId, ids }) => {
        const { hasValidDevelopmentSeatPresence: verify } =
          await import("/src/features/matches/verifiedDevelopmentSeatPresence.ts");
        return Object.entries(forged).map(([name, response]) =>
          [name, verify(response, matchId, ids)] as const);
      }, { forged, matchId, ids });
      expect(outcome).toHaveLength(22);
      for (const [name, result] of outcome)
        expect(result, name).toBe(false);
      expect(JSON.stringify({ forged, valid, ids })).toBe(original);
    });
}
