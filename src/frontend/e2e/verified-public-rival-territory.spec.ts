import { expect, test } from "@playwright/test";

// #180: test the real Vite modules, including the complete-board verifier,
// rather than making up a standalone summary algorithm in Node.
for (const seats of [2, 4, 8] as const) {
  test(`#180: server-confirmed head-to-head is exact and read-only (${seats} seats)`,
    async ({ page }) => {
      await page.goto("/");
      const result = await page.evaluate(async count => {
        const { cityBoard } = await import("/src/features/city/board.ts");
        const { verifiedPublicTerritoryFootprints } = await import(
          "/src/features/city/publicTerritoryFootprints.ts");
        const { verifiedPublicRivalTerritory: compare } = await import(
          "/src/features/matches/verifiedPublicRivalTerritory.ts");
        const categories = [
          ...Array(5).fill("public-financing"),
          ...Array(5).fill("private-financing"),
          ...Array(4).fill("black-market"),
          ...Array(4).fill("corruption"),
          ...Array(4).fill("culture"),
          ...Array(2).fill("sport"),
          ...Array(3).fill("transport"),
          ...Array(3).fill("bishopric"),
        ] as string[];
        const playerIds = Array.from({ length: count }, (_, i) => `player-${i}`);
        const snapshot = {
          matchId: "00000000-0000-0000-0000-000000000180",
          revision: 7, round: 1, activePlayerId: playerIds[0],
          players: playerIds.map((playerId, i) => ({
            playerId, streetId: cityBoard.slots[i].streetId,
            startingSlotId: cityBoard.slots[i].id,
          })),
          boardActivities: cityBoard.slots.map((slot, i) => ({
            slotId: slot.id, cardId: `synthetic:printed:${i}`,
            category: categories[i],
          })),
          // Only the first TWO seats own a starting lot; both on Gauss.
          // Other 2..8 players still have zero public controlled lots.
          controlledActivities: playerIds.slice(0, 2).map((ownerPlayerId, i) => ({
            slotId: cityBoard.slots[i].id, ownerPlayerId,
            posture: i % 2,
          })),
        };
        const standings = verifiedPublicTerritoryFootprints(snapshot);
        const before = JSON.stringify({ snapshot, standings });
        const comparisons = compare(snapshot, standings, "player-0");
        const swapped = compare(snapshot, standings, "player-1");
        // A legitimate additional public rival-controlled lot on Einstein:
        // the first actor is now behind by one (negative signed advantage).
        const trailing = structuredClone(snapshot);
        trailing.controlledActivities.push({
          slotId: cityBoard.slots[8].id, ownerPlayerId: "player-1", posture: 0,
        });
        const trailingStandings = verifiedPublicTerritoryFootprints(trailing);
        const whenBehind = compare(trailing, trailingStandings, "player-0");
        const whenAhead = compare(trailing, trailingStandings, "player-1");
        const emptyActor = compare(snapshot, standings, "missing");
        type MutableFootprint = { playerId: string; place: number;
          controlledLots: number; standing: number; fallen: number; occupiedStreets: number };
        const bad = (tamper: (draft: MutableFootprint[]) => void) => {
          const draft = structuredClone(standings) as MutableFootprint[];
          tamper(draft);
          return compare(snapshot, draft, "player-0").length;
        };
        const rejects = [
          bad(draft => { draft[0].controlledLots++; }),
          bad(draft => { draft[0].place++; }),
          bad(draft => { draft[1].playerId = "player-0"; }),
          bad(draft => { draft.reverse(); }),
          bad(draft => { draft.pop(); }),
          bad(draft => { (draft[0] as unknown as Record<string, unknown>).privateHand = null; }),
          bad(draft => { (draft[0] as unknown as Record<string, unknown>).future = false; }),
          bad(draft => { Reflect.deleteProperty(draft[0], "standing"); }),
          compare({ ...snapshot, revision: 7, round: 2 }, standings, "player-0").length,
          compare({ ...snapshot, boardActivities: snapshot.boardActivities.slice(1) },
            standings, "player-0").length,
          emptyActor.length,
          compare(null, standings, "player-0").length,
          compare(snapshot, null, "player-0").length,
        ];
        return {
          count: comparisons.length,
          comparison: comparisons.map(item => ({
            rival: item.rivalPlayerId,
            theirs: item.rivalControlledLots,
            mine: item.myControlledLots,
            delta: item.myLotAdvantage,
            shared: item.sharedStreetIds,
          })),
          otherSeatComparison: swapped[0]?.myLotAdvantage,
          negativeAdvantage: whenBehind[0]?.myLotAdvantage,
          positiveAdvantage: whenAhead[0]?.myLotAdvantage,
          trailingShared: whenBehind[0]?.sharedStreetIds,
          noMutation: before === JSON.stringify({ snapshot, standings }),
          rejects,
        };
      }, seats);
      expect(result.count).toBe(seats - 1);
      expect(result.comparison[0]).toEqual({
        rival: "player-1", theirs: 1, mine: 1, delta: 0, shared: ["gauss"],
      });
      for (const row of result.comparison.slice(1)) {
        expect(row.theirs).toBe(0);
        expect(row.mine).toBe(1);
        expect(row.delta).toBe(1);
        expect(row.shared).toEqual([]);
      }
      expect(result.otherSeatComparison).toBe(0);
      expect(result.negativeAdvantage).toBe(-1);
      expect(result.positiveAdvantage).toBe(1);
      expect(result.trailingShared).toEqual(["gauss"]);
      expect(result.noMutation).toBe(true);
      expect(result.rejects).toHaveLength(13);
      expect(result.rejects).toEqual(Array(13).fill(0));
    });
}
