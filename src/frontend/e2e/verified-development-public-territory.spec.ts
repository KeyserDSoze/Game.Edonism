import { expect, test } from "@playwright/test";

// #179: execute real Vite-transformed .NET public-territory validator on
// complete printed boards, not a second handwritten copy of its logic.
// Neither this read-only scoreboard nor its place index grants victory.
for (const count of [2, 4, 8] as const) {
  test(`#179: verified server territory 2-8 seat cross-check fails closed (${count} seats)`,
    async ({ page }) => {
      await page.goto("/");
      const results = await page.evaluate(async seats => {
        const { cityBoard } = await import("/src/features/city/board.ts");
        const { verifiedPublicStreetControlMatrix } = await import(
          "/src/features/city/publicStreetControlMatrix.ts");
        const { verifiedPublicTerritoryFootprints } = await import(
          "/src/features/city/publicTerritoryFootprints.ts");
        const { verifiedDevelopmentPublicTerritory: valid } = await import(
          "/src/features/matches/verifiedDevelopmentPublicTerritory.ts");

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
        const players = Array.from({ length: seats }, (_, index) => ({
          playerId: `player-${index}`, startingSlotId: cityBoard.slots[index].id,
          streetId: cityBoard.slots[index].streetId,
        }));
        const state = {
          matchId: "00000000-0000-0000-0000-000000000179",
          revision: 5, round: 1,
          activePlayerId: "player-0", players,
          boardActivities: cityBoard.slots.map((slot, index) => ({
            slotId: slot.id, cardId: `synthetic:activity:${index}`,
            category: categories[index],
          })),
          controlledActivities: players.map((player, index) => ({
            slotId: player.startingSlotId, ownerPlayerId: player.playerId,
            posture: index % 2,
          })),
        };
        const streets = verifiedPublicStreetControlMatrix(state);
        const footprints = verifiedPublicTerritoryFootprints(state);
        const raw = {
          matchId: state.matchId, playerId: "player-0",
          round: state.round, verifiedRevision: state.revision,
          totalSlots: cityBoard.slots.length,
          freeLots: streets.reduce((n, x) => n + x.freeLots, 0),
          controlledLots: streets.reduce((n, x) => n + x.controlledLots, 0),
          sharedStreetCount: streets.filter(x =>
            x.owners.filter(o => o.controlled > 0).length > 1).length,
          streets: streets.map(x => ({
            ...x, owners: x.owners.map(owner => ({
              playerId: owner.playerId, controlledLots: owner.controlled,
              standing: owner.standing, fallen: owner.fallen,
            })),
            distinctOwnerCount: x.owners.filter(o => o.controlled > 0).length,
            isShared: x.owners.filter(o => o.controlled > 0).length >= 2,
          })),
          footprints: footprints.map(x => ({ ...x })),
        };
        const before = JSON.stringify(raw);
        const accepted = valid(raw, state, "player-0");
        const mutate = (
          parts: readonly (string | number)[],
          action: "extra-null" | "extra-false" | "missing",
        ) => {
          const candidate = structuredClone(raw);
          let target: unknown = candidate;
          for (const key of parts)
            target = (target as Record<string, unknown>)[String(key)];
          const row = target as Record<string, unknown>;
          if (action === "missing") Reflect.deleteProperty(row, Object.keys(row)[0]);
          else row.futurePrivate = action === "extra-null" ? null : false;
          return valid(candidate, state, "player-0");
        };
        const attacks = [
          [] as (string | number)[], ["streets", 0],
          ["streets", 0, "owners", 0], ["footprints", 0],
        ].flatMap(parts => ["extra-null", "extra-false", "missing"]
          .map(kind => mutate(parts, kind as "extra-null" | "extra-false" | "missing")));
        const changed = (patch: (candidate: typeof raw) => void) => {
          const candidate = structuredClone(raw);
          patch(candidate);
          return valid(candidate, state, "player-0");
        };
        const mismatches = [
          changed(x => { x.playerId = "player-1"; }),
          changed(x => { x.verifiedRevision++; }),
          changed(x => { x.freeLots++; }),
          changed(x => { x.streets[0].owners[0].controlledLots++; }),
          changed(x => { x.footprints[0].place++; }),
          valid({ ...raw, streets: [null] }, state, "player-0"),
          valid({ ...raw, footprints: null }, state, "player-0"),
          valid(raw, state, "nonexistent-player"),
          valid(raw, { ...state, revision: state.revision + 1 }, "player-0"),
        ];
        return {
          accepted: accepted?.length === seats,
          places: accepted?.map(x => x.place),
          noRawMutation: JSON.stringify(raw) === before,
          attacks, mismatches,
        };
      }, count);
      expect(results.accepted).toBe(true);
      expect(results.noRawMutation).toBe(true);
      expect(results.places).toHaveLength(count);
      expect(results.attacks).toHaveLength(12);
      for (const result of [...results.attacks, ...results.mismatches])
        expect(result).toBeNull();
    });
}
