import { expect, test } from "@playwright/test";

// #181: Vite runs real board/territory/tactical cross-source selector code.
for (const seats of [2, 4, 8] as const) {
  test(`#181: public rival proximity dossier rejects entire forged cross-source graph (${seats} seats)`,
    async ({ page }) => {
      await page.goto("/");
      const result = await page.evaluate(async count => {
        const { cityBoard, shortestStreetPath } = await import(
          "/src/features/city/board.ts");
        const { verifiedPublicTerritoryFootprints } = await import(
          "/src/features/city/publicTerritoryFootprints.ts");
        const { verifiedPublicRivalProximityDossier: dossier } = await import(
          "/src/features/matches/verifiedPublicRivalProximityDossier.ts");
        const ids = Array.from({ length: count }, (_, i) => `player-${i}`);
        const currentStreets = [
          "gauss", "einstein", "planck", "newton",
          "meson", "boson", "main-square", "gauss",
        ];
        const quotas = [
          ...Array(5).fill("public-financing"),
          ...Array(5).fill("private-financing"),
          ...Array(4).fill("black-market"),
          ...Array(4).fill("corruption"),
          ...Array(4).fill("culture"),
          ...Array(2).fill("sport"),
          ...Array(3).fill("transport"),
          ...Array(3).fill("bishopric"),
        ] as string[];
        const snapshot = {
          matchId: "00000000-0000-0000-0000-000000000181",
          round: 1, revision: 9, activePlayerId: ids[0],
          players: ids.map((playerId, i) => ({
            playerId, streetId: currentStreets[i],
            startingSlotId: cityBoard.slots[i].id,
          })),
          boardActivities: cityBoard.slots.map((slot, i) => ({
            slotId: slot.id, cardId: `synthetic:card:${i}`,
            category: quotas[i],
          })),
          controlledActivities: ids.slice(0, 2).map((ownerPlayerId, i) => ({
            slotId: cityBoard.slots[i].id, ownerPlayerId, posture: i % 2,
          })),
        };
        const standings = verifiedPublicTerritoryFootprints(snapshot);
        const routes = snapshot.players.filter(p => p.playerId !== ids[0])
          .map(p => {
            const path = shortestStreetPath(currentStreets[0], p.streetId)!;
            const own = snapshot.controlledActivities.filter(c =>
              c.ownerPlayerId === p.playerId);
            return {
              otherPlayerId: p.playerId,
              streetId: p.streetId,
              streetSteps: path.length - 1,
              streetPath: [...path],
              controlledActivities: own.length,
              standingHenchmen: own.filter(lot => lot.posture === 0).length,
            };
          }).sort((a, b) => a.streetSteps - b.streetSteps
            || (a.otherPlayerId < b.otherPlayerId ? -1
              : a.otherPlayerId > b.otherPlayerId ? 1 : 0));
        const before = JSON.stringify({ snapshot, standings, routes });
        const valid = dossier(snapshot, standings, ids[0], routes);
        const asMutated = (change: (copy: typeof routes) => void) => {
          const copy = structuredClone(routes);
          change(copy);
          return dossier(snapshot, standings, ids[0], copy).length;
        };
        const attempts = [
          asMutated(x => { x[0].streetSteps++; }),
          asMutated(x => { x[0].streetPath = ["gauss", "main-square"]; }),
          // Every 2/4/8-seat fixture must actually CHANGE the field;
          // nearest seat can already be on Gauss in an eight-seat setup.
          asMutated(x => { x[0].streetId = x[0].streetId === "gauss"
            ? "einstein" : "gauss"; }),
          asMutated(x => { x[0].otherPlayerId = "unknown"; }),
          asMutated(x => { x[0].controlledActivities++; }),
          asMutated(x => { x[0].standingHenchmen++; }),
          asMutated(x => { (x[0] as unknown as Record<string, unknown>).secret = null; }),
          asMutated(x => { (x[0] as unknown as Record<string, unknown>).future = false; }),
          asMutated(x => { Reflect.deleteProperty(x[0], "streetPath"); }),
          asMutated(x => { x.pop(); }),
          asMutated(x => { x.push(structuredClone(x[0])); }),
          dossier(snapshot, standings, "missing", routes).length,
          dossier(snapshot, null, ids[0], routes).length,
          dossier(null, standings, ids[0], routes).length,
          dossier({ ...snapshot, round: 2 }, standings, ids[0], routes).length,
          dossier({ ...snapshot, boardActivities: snapshot.boardActivities.slice(1) },
            standings, ids[0], routes).length,
          dossier(snapshot, standings.map((s, i) =>
            i === 0 ? { ...s, controlledLots: s.controlledLots + 1 } : s),
          ids[0], routes).length,
          dossier(snapshot, standings, ids[0], null).length,
          dossier(snapshot, standings, ids[0], {}).length,
          // All-or-nothing order and duplicate rules even if each row is valid.
          routes.length > 1
            ? asMutated(x => { x.reverse(); }) : 0,
          routes.length > 1
            ? asMutated(x => { x[1] = { ...x[0] }; }) : 0,
        ];
        return {
          count: valid.length,
          expected: routes.map(route => ({
            id: route.otherPlayerId, distance: route.streetSteps,
            path: route.streetPath, owned: route.controlledActivities,
            standing: route.standingHenchmen,
          })),
          actual: valid.map(row => ({
            id: row.rivalPlayerId, distance: row.streetSteps,
            path: row.streetPath, owned: row.rivalControlledLots,
            standing: row.rivalStandingHenchmen,
          })),
          bob: valid.find(row => row.rivalPlayerId === "player-1"),
          nullRivals: valid.filter(row => row.rivalControlledLots === 0).length,
          unmodified: before === JSON.stringify({ snapshot, standings, routes }),
          attempts,
        };
      }, seats);
      expect(result.count).toBe(seats - 1);
      expect(result.actual).toEqual(result.expected);
      expect(result.bob?.sharedStreetIds).toEqual(["gauss"]);
      expect(result.bob?.rivalControlledLots).toBe(1);
      expect(result.bob?.myLotAdvantage).toBe(0);
      expect(result.nullRivals).toBe(seats - 2);
      expect(result.unmodified).toBe(true);
      expect(result.attempts).toEqual(Array(result.attempts.length).fill(0));
    });
}
