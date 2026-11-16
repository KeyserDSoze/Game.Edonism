import { expect, test } from "@playwright/test";

// #147: browser runs the actual Vite TypeScript proximity selector, NOT a
// rewritten test-only route calculator. No mock fetch, no mutation or tokens.
const ids147 = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

for (const count of [2, 4, 8] as const) {
  test(`#147: ${count}-seat current-turn public proximity is fail-closed and immutable`,
    async ({ page }) => {
      const roster = ids147.slice(0, count).map((playerId, i) => ({
        playerId, streetId: i % 2 === 0 ? "gauss" : "einstein",
      }));
      const genuine = {
        activePlayerId: "alice" as string | null,
        players: roster,
        // None of these fields may appear in the derived public view.
        privateHand: ["NEVER_EXPOSE_ACTION"],
        credentials: [{ token: "NEVER_EXPOSE_TOKEN" }],
      };
      const edit = (mutate: (value: typeof genuine) => void) => {
        const clone = structuredClone(genuine);
        mutate(clone);
        return clone;
      };
      const afterMove = edit(x => { x.players[0].streetId = "main-square"; });
      const afterTurn = edit(x => { x.activePlayerId = "bob"; });
      const pendingSettlement = edit(x => { x.activePlayerId = null; });
      const forged = {
        missingActiveActor: edit(x => { x.activePlayerId = "intruder"; }),
        reservedActor: edit(x => { x.activePlayerId = "system"; }),
        invalidActiveType: edit(x => {
          x.activePlayerId = 42 as unknown as string;
        }),
        duplicatePlayer: edit(x => { x.players[1].playerId = "alice"; }),
        foreignStreet: edit(x => { x.players[count - 1].streetId = "alien"; }),
        reservedPlayer: edit(x => { x.players[count - 1].playerId = "system"; }),
        invalidPlayerId: edit(x => { x.players[count - 1].playerId = "eve "; }),
        nullPlayer: edit(x => { x.players[1] = null as unknown as typeof roster[0]; }),
        wrongContainer: null,
        oneSeat: { ...genuine, players: roster.slice(0, 1) },
        nineSeats: { ...genuine, players: [
          ...roster,
          ...Array.from({ length: 9 - count }, (_, i) => ({
            playerId: `extra-${i}`, streetId: "gauss",
          })),
        ] },
      };
      const unchanged = JSON.stringify({
        genuine, afterMove, afterTurn, pendingSettlement, forged,
      });
      await page.goto("/");
      const out = await page.evaluate(async data => {
        const { verifiedActiveTurnRivalProximity: verify } =
          await import("/src/features/city/activeTurnRivalProximity.ts");
        return {
          genuine: [...verify(data.genuine)],
          afterMove: [...verify(data.afterMove)],
          afterTurn: [...verify(data.afterTurn)],
          pendingSettlement: verify(data.pendingSettlement).size,
          forged: Object.entries(data.forged)
            .map(([name, value]) => [name, verify(value).size]),
          missing: verify(undefined).size,
        };
      }, { genuine, afterMove, afterTurn, pendingSettlement, forged });

      expect(out.genuine).toHaveLength(count - 1);
      for (const [id, details] of out.genuine) {
        expect(id).not.toBe("alice");
        expect(details.fromPlayerId).toBe("alice");
        expect(details.fromStreetId).toBe("gauss");
        expect(details.toStreetId).toBe(
          roster.find(p => p.playerId === id)?.streetId);
        if (details.toStreetId === "gauss") {
          expect(details.streetSteps).toBe(0);
          expect(details.streetPath).toEqual(["gauss"]);
        } else {
          expect(details.streetSteps).toBe(2);
          expect(details.streetPath).toEqual(["gauss", "main-square", "einstein"]);
        }
      }
      expect(out.afterMove).toHaveLength(count - 1);
      for (const [, details] of out.afterMove) {
        expect(details.fromStreetId).toBe("main-square");
        expect(details.streetSteps).toBe(1);
        expect(details.streetPath[0]).toBe("main-square");
      }
      expect(out.afterTurn).toHaveLength(count - 1);
      expect(out.afterTurn.some(([id]) => id === "bob")).toBe(false);
      expect(out.afterTurn.some(([id]) => id === "alice")).toBe(true);
      for (const [, details] of out.afterTurn)
        expect(details.fromPlayerId).toBe("bob");
      expect(out.pendingSettlement).toBe(0);
      expect(out.missing).toBe(0);
      expect(out.forged).toEqual(
        Object.keys(forged).map(name => [name, 0]));
      expect(JSON.stringify(out)).not.toContain("NEVER_EXPOSE");
      expect(JSON.stringify({
        genuine, afterMove, afterTurn, pendingSettlement, forged,
      })).toBe(unchanged);
    });
}
