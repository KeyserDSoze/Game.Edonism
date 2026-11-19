import { expect, test } from "@playwright/test";

// #178: exercises the ACTUAL Vite-transformed guard, not an invented parser.
// 2/4/8 seats matter for the three independent array shapes and actor roster.
for (const count of [2, 4, 8] as const) {
  test(`#178: real Vite tactical overview wire rejects every extra/missing layer (${count} seats)`,
    async ({ page }) => {
      await page.goto("/");
      const results = await page.evaluate(async seats => {
        const { hasExactPublicTacticalOverviewWire: valid } = await import(
          "/src/features/matches/verifiedPublicTacticalOverviewWire.ts");
        const scope = {
          matchId: "00000000-0000-0000-0000-000000000178",
          playerId: "player-0", round: 1, verifiedRevision: 8,
          fromStreetId: "gauss",
        };
        const otherRows = Array.from({ length: seats - 1 }, (_, i) => ({
          otherPlayerId: `player-${i+1}`, streetId: "einstein",
          streetSteps: 1, streetPath: ["gauss", "einstein"],
          controlledActivities: 1, standingHenchmen: 1,
        }));
        const lotRows = Array.from({ length: seats - 1 }, (_, i) => ({
          slotId: `S-0${i+1}`, ownerPlayerId: `player-${i+1}`,
          posture: 0, streetId: "einstein", streetSteps: 1,
          streetPath: ["gauss", "einstein"],
        }));
        const overview = {
          ...scope,
          uncontrolled: { ...scope, routes: [{
            slotId: "N-01", cardId: "synthetic:card", category: "culture",
            streetId: "gauss", streetSteps: 0, streetPath: ["gauss"],
          }] },
          otherPlayers: { ...scope, others: otherRows },
          opponentControlledLots: { ...scope, routes: lotRows },
        };
        const before = JSON.stringify(overview);
        const changes = [
          [] as (string | number)[],
          ["uncontrolled"], ["otherPlayers"], ["opponentControlledLots"],
          ["uncontrolled", "routes", 0], ["otherPlayers", "others", 0],
          ["opponentControlledLots", "routes", 0],
        ];
        const mutate = (path: (string | number)[], operation: "add" | "remove",
          injectedValue: unknown) => {
          const candidate = structuredClone(overview);
          let current: unknown = candidate;
          for (const step of path)
            current = (current as Record<string, unknown>)[String(step)];
          const record = current as Record<string, unknown>;
          const target = operation === "add"
            ? "privateHand" : Object.keys(record)[0];
          if (operation === "add") record[target] = injectedValue;
          else Reflect.deleteProperty(record, target);
          return valid(candidate);
        };
        const unexpected = changes.flatMap(path => [
          mutate(path, "add", null),
          mutate(path, "add", false),
          mutate(path, "remove", null),
        ]);
        const malformed = [
          valid(null), valid([]), valid({}),
          valid({ ...overview, uncontrolled: null }),
          valid({ ...overview, otherPlayers: { ...scope, others: [null] } }),
          valid({ ...overview, opponentControlledLots: {
            ...scope, routes: [{ ...lotRows[0], cardIds: ["private"] }],
          } }),
        ];
        return { accepted: valid(overview), unexpected, malformed,
          unchanged: JSON.stringify(overview) === before };
      }, count);
      expect(results.accepted).toBe(true);
      expect(results.unchanged).toBe(true);
      expect(results.unexpected).toHaveLength(21);
      for (const accepted of [...results.unexpected, ...results.malformed])
        expect(accepted).toBe(false);
    });
}
