import { expect, test } from "@playwright/test";

// #174: browser import of the actual Vite ingress helper; nested guards for
// private hand, public audit and turn options are tested independently.
const matchId = "00000000-0000-0000-0000-000000000020";
const players = ["Renée", "王小明", "System", "🙂", "alpha", "bravo", "charlie", "delta"];

for (const seats of [2, 4, 8] as const) {
  test(`#174: exact Development atomic seat envelope for ${seats} technical owners`,
    async ({ page }) => {
      const ids = players.slice(0, seats);
      const normal = {
        matchId, playerId: ids[seats - 1],
        state: { matchId, players: [...ids] },
        hand: { matchId, playerId: ids[seats - 1] },
        turnOptions: { matchId, playerId: ids[seats - 1] },
      };
      // Wire property insertion order does not matter.
      const shuffled = {
        turnOptions: normal.turnOptions, hand: normal.hand,
        playerId: normal.playerId, matchId: normal.matchId, state: normal.state,
      };
      const original = JSON.stringify({ normal, shuffled });
      await page.goto("/");
      const result = await page.evaluate(async ({ normal, shuffled, matchId }) => {
        const { hasValidDevelopmentSeatBootstrapEnvelope: verify } =
          await import("/src/features/matches/verifiedDevelopmentSeatBootstrapEnvelope.ts");
        return {
          exact: verify(normal, matchId),
          reordered: verify(shuffled, matchId),
          uppercaseId: verify({ ...normal, matchId: matchId.toUpperCase() }, matchId),
          foreign: verify(normal, "00000000-0000-0000-0000-000000000021"),
          null: verify(null, matchId),
        };
      }, { normal, shuffled, matchId });
      expect(result).toEqual({
        exact: true, reordered: true, uppercaseId: true, foreign: false, null: false,
      });
      expect(JSON.stringify({ normal, shuffled })).toBe(original);
    });

  test(`#174: forged root, bad actor or null nested view fails closed for ${seats} seats`,
    async ({ page }) => {
      const owner = players[seats - 1];
      const normal = {
        matchId, playerId: owner, state: {}, hand: {}, turnOptions: {},
      };
      const changed = (update: (row: typeof normal) => void) => {
        const copy = structuredClone(normal);
        update(copy);
        return copy;
      };
      const broken: Record<string, unknown> = {
        extraCredentials: { ...normal, credentials: [{ playerId: "other", token: "SECRET" }] },
        extraOtherBearers: { ...normal, otherPlayerTokens: ["SECRET"] },
        extraCardInfo: { ...normal, privateHand: ["SECRET"] },
        extraAdmin: { ...normal, adminActions: ["override"] },
        extraFuture: { ...normal, futureActions: [] },
        extraNull: { ...normal, metadata: null },
        extraFalse: { ...normal, canSkipTurn: false },
        missingMatch: changed(r => { delete (r as unknown as Record<string, unknown>).matchId; }),
        missingPlayer: changed(r => { delete (r as unknown as Record<string, unknown>).playerId; }),
        missingState: changed(r => { delete (r as unknown as Record<string, unknown>).state; }),
        missingHand: changed(r => { delete (r as unknown as Record<string, unknown>).hand; }),
        missingOptions: changed(r => { delete (r as unknown as Record<string, unknown>).turnOptions; }),
        foreignMatch: { ...normal, matchId: "00000000-0000-0000-0000-000000000021" },
        numericMatch: { ...normal, matchId: 20 },
        badMatchUuid: { ...normal, matchId: "other" },
        reservedSystemActor: { ...normal, playerId: "system" },
        invisibleActor: { ...normal, playerId: "alice\u202E" },
        whitespaceActor: { ...normal, playerId: " bob " },
        nullActor: { ...normal, playerId: null },
        arrayRoot: [],
        nullRoot: null,
        nullState: { ...normal, state: null },
        listState: { ...normal, state: [] },
        nullHand: { ...normal, hand: null },
        listHand: { ...normal, hand: [] },
        nullOptions: { ...normal, turnOptions: null },
        listOptions: { ...normal, turnOptions: [] },
      };
      const original = JSON.stringify({ broken, normal });
      await page.goto("/");
      const result = await page.evaluate(async ({ broken, matchId }) => {
        const { hasValidDevelopmentSeatBootstrapEnvelope: verify } =
          await import("/src/features/matches/verifiedDevelopmentSeatBootstrapEnvelope.ts");
        return Object.entries(broken).map(([label, value]) =>
          [label, verify(value, matchId)] as const);
      }, { broken, matchId });
      expect(result).toHaveLength(Object.keys(broken).length);
      for (const [label, valid] of result) expect(valid, label).toBe(false);
      expect(JSON.stringify({ broken, normal })).toBe(original);
    });
}
