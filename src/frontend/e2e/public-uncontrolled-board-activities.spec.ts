import { expect, test } from "@playwright/test";

// #149: Chromium imports the real Vite/TypeScript selector, not a synthetic
// duplicate implementation. All categories/slots mirror printed rulebook p.4.
const slots149 = [
  ...Array.from({ length: 8 }, (_, i) => `N-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `S-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `W-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `E-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `B-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`),
];
const categories149 = [
  ...Array(5).fill("public-financing"),
  ...Array(5).fill("private-financing"),
  ...Array(4).fill("black-market"),
  ...Array(4).fill("corruption"),
  ...Array(4).fill("culture"),
  ...Array(2).fill("sport"),
  ...Array(3).fill("transport"),
  ...Array(3).fill("bishopric"),
] as string[];
const ids149 = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

for (const count of [2, 4, 8] as const) {
  test(`#149: ${count} seats see exactly the canonical unowned full-board cards`,
    async ({ page }) => {
      const state = {
        players: ids149.slice(0, count).map((playerId, i) => ({
          playerId,
          streetId: i % 2 ? "einstein" : "gauss",
        })),
        activePlayerId: "alice" as string | null,
        boardActivities: slots149.map((slotId, i) => ({
          slotId, cardId: `synthetic:public:${slotId}`, category: categories149[i],
        })),
        controlledActivities: slots149.slice(0, count).map((slotId, i) => ({
          slotId, ownerPlayerId: ids149[i], posture: 0,
        })),
        privateHand: ["NEVER_EXPOSE_SECRET_CARD"],
        accessToken: "NEVER_EXPOSE_TOKEN",
      };
      const change = (mutate: (value: typeof state) => void) => {
        const copy = structuredClone(state);
        mutate(copy);
        return copy;
      };
      const afterSettlement = change(s => { s.activePlayerId = null; });
      const malformed = {
        duplicateCardId: change(s => {
          s.boardActivities[29].cardId = s.boardActivities[0].cardId;
        }),
        duplicateBoardSlot: change(s => {
          s.boardActivities[29].slotId = s.boardActivities[0].slotId;
        }),
        foreignBoardSlot: change(s => {
          s.boardActivities[29].slotId = "not-printed";
        }),
        brokenQuota: change(s => {
          s.boardActivities[29].category = "culture";
        }),
        unknownCategory: change(s => {
          s.boardActivities[29].category = "made-up";
        }),
        missingBoardCard: change(s => { s.boardActivities.pop(); }),
        malformedCard: change(s => {
          s.boardActivities[0].cardId = "" as string;
        }),
        duplicateControlledLot: change(s => {
          s.controlledActivities[1].slotId = s.controlledActivities[0].slotId;
        }),
        foreignControlSlot: change(s => {
          s.controlledActivities[0].slotId = "not-printed";
        }),
        foreignOwner: change(s => {
          s.controlledActivities[0].ownerPlayerId = "intruder";
        }),
        badPosture: change(s => {
          s.controlledActivities[0].posture = 2;
        }),
        reservedSeat: change(s => { s.players[0].playerId = "system"; }),
        duplicateSeat: change(s => { s.players[1].playerId = "alice"; }),
        unknownStreet: change(s => { s.players[1].streetId = "outer-space"; }),
        tooFewPlayers: { ...state, players: state.players.slice(0, 1) },
        wrongContainer: null,
      };
      const original = JSON.stringify({ state, afterSettlement, malformed });
      await page.goto("/");
      const output = await page.evaluate(async inputs => {
        const { verifiedPublicUncontrolledBoardActivities: verify } =
          await import("/src/features/city/publicUncontrolledBoardActivities.ts");
        const { selectVerifiedPublicUncontrolledActivities: select } =
          await import("/src/features/city/publicUncontrolledActivityFilters.ts");
        const { verifiedPublicFreeActivityStreetDistribution: distribute } =
          await import("/src/features/city/publicFreeActivityStreetDistribution.ts");
        return {
          valid: verify(inputs.state),
          distribution: distribute(inputs.state),
          pendingDistribution: distribute(inputs.afterSettlement),
          invalidDistributions: Object.entries(inputs.malformed).map(([id, altered]) =>
            [id, distribute(altered).length]),
          filtered: {
            all: select(inputs.state, { streetId: "", category: "" }),
            street: select(inputs.state, { streetId: "gauss", category: "" }),
            category: select(inputs.state, { streetId: "", category: "sport" }),
            combined: select(inputs.state, { streetId: "gauss", category: "sport" }),
            invalidPrefs: select(inputs.state, {
              streetId: "outer-space", category: "nonexistent",
            }),
            invalidBoard: select(inputs.malformed.duplicateCardId, {
              streetId: "gauss", category: "",
            }),
          },
          pending: verify(inputs.afterSettlement),
          invalid: Object.entries(inputs.malformed).map(([id, altered]) =>
            [id, verify(altered).length]),
          nullInput: verify(null).length,
          undefinedInput: verify(undefined).length,
        };
      }, { state, afterSettlement, malformed });
      // #151: every printed street, including an entirely controlled street
      // with ZERO free lots in eight-seat fixture, must be in canonical order.
      const printedStreets = await page.evaluate(async () => {
        const { cityBoard } = await import("/src/features/city/board.ts");
        return cityBoard.streets.map(street => ({
          streetId: street.id, streetName: street.name,
        }));
      });
      expect(output.distribution).toHaveLength(7);
      expect(output.distribution.map(({ streetId, streetName }) => ({
        streetId, streetName,
      }))).toEqual(printedStreets);
      expect(output.distribution.reduce((sum, street) => sum + street.count, 0))
        .toBe(30 - count);
      for (const street of output.distribution)
        expect(street.count).toBe(
          output.valid.filter(card => card.streetId === street.streetId).length);
      if (count === 8)
        expect(output.distribution.find(x => x.streetId === "gauss")?.count)
          .toBe(0);
      expect(output.pendingDistribution).toEqual(output.distribution);
      expect(output.invalidDistributions).toEqual(
        Object.keys(malformed).map(id => [id, 0]));
      expect(output.valid).toHaveLength(30 - count);
      expect(output.valid.map(card => card.slotId)).toEqual(slots149.slice(count));
      expect(output.valid.map(card => card.cardId)).toEqual(
        state.boardActivities.slice(count).map(card => card.cardId));
      expect(output.valid.map(card => card.category)).toEqual(
        state.boardActivities.slice(count).map(card => card.category));
      // A secondary check of public street provenance from the actual Vite
      // board JSON is made in the browser; do not hand-author game geometry.
      const streets = await page.evaluate(async slots => {
        const { slotById } = await import("/src/features/city/board.ts");
        return slots.map(slot => slotById(slot)?.streetId ?? null);
      }, slots149.slice(count));
      expect(output.valid.map(card => card.streetId)).toEqual(streets);
      // #150: always filter AFTER the same full-board #149 verification.
      expect(output.filtered.all.visible).toEqual(output.valid);
      expect(output.filtered.all.totalCount).toBe(30 - count);
      expect(output.filtered.street.visible).toEqual(
        output.valid.filter(x => x.streetId === "gauss"));
      expect(output.filtered.street.streetId).toBe("gauss");
      expect(output.filtered.category.visible).toEqual(
        output.valid.filter(x => x.category === "sport"));
      expect(output.filtered.category.category).toBe("sport");
      expect(output.filtered.combined.visible).toEqual([]);
      expect(output.filtered.combined.visibleCount).toBe(0);
      expect(output.filtered.combined.totalCount).toBe(30 - count);
      expect(output.filtered.invalidPrefs.streetId).toBe("");
      expect(output.filtered.invalidPrefs.category).toBe("");
      expect(output.filtered.invalidPrefs.visible).toEqual(output.valid);
      expect(output.filtered.invalidBoard.all).toEqual([]);
      expect(output.filtered.invalidBoard.visible).toEqual([]);
      expect(output.filtered.invalidBoard.totalCount).toBe(0);
      expect(output.pending).toEqual(output.valid);
      expect(output.invalid).toEqual(
        Object.keys(malformed).map(id => [id, 0]));
      expect(output.nullInput).toBe(0);
      expect(output.undefinedInput).toBe(0);
      expect(JSON.stringify(output)).not.toMatch(/NEVER_EXPOSE/);
      expect(JSON.stringify({ state, afterSettlement, malformed })).toBe(original);
    });
}
