import { expect, test } from "@playwright/test";

// #122: Import the actual Vite-loaded guard and the board JSON used by the
// game. The synthetic fixtures are public only, not playable command state.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function snapshot(count: Count) {
  const players = ids.slice(0, count);
  return {
    matchId: "board-version-parity",
    boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: "alice" as string | null,
    players: players.map((playerId, index) => ({
      playerId, startingSlotId: "N-" + String(index + 1).padStart(2, "0"), streetId: index % 2 ? "einstein" : "gauss",
      freeMoveUsed: false,
    })),
    turnOrder: players,
    proposedNextRoundOrder: [...players.slice(-1), ...players.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created", actorId: "system",
      fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#122: ${count}-seat public board version matches the actual shared source`,
    async ({ page }) => {
    const initial = snapshot(count);
    const before = JSON.stringify(initial);
    await page.goto("/");
    const result = await page.evaluate(async initial => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      const { cityBoard } = await import("/src/features/city/board.ts");
      return {
        version: cityBoard.version,
        valid: valid(initial, initial.matchId),
        chronology: chronology(initial, initial.matchId),
        otherMatch: valid(initial, "wrong-match"),
      };
    }, initial);
    expect(result).toEqual({
      version: "edonism-streets-v1", valid: true, chronology: true,
      otherMatch: false,
    });
    expect(JSON.stringify(initial)).toBe(before);
  });

  test(`#122: ${count}-seat missing/foreign/untrusted board versions fail closed`,
    async ({ page }) => {
    const initial = snapshot(count);
    const variants = {
      missing: (({ boardVersion: _removed, ...remaining }) => remaining)(initial),
      nullValue: { ...initial, boardVersion: null },
      empty: { ...initial, boardVersion: "" },
      whitespace: { ...initial, boardVersion: " " },
      otherRelease: { ...initial, boardVersion: "edonism-streets-v2" },
      suffix: { ...initial, boardVersion: "edonism-streets-v1-modified" },
      prefix: { ...initial, boardVersion: "compat-edonism-streets-v1" },
      uppercase: { ...initial, boardVersion: "EDONISM-STREETS-V1" },
      numeric: { ...initial, boardVersion: 1 },
      list: { ...initial, boardVersion: ["edonism-streets-v1"] },
    };
    const before = JSON.stringify(variants);
    await page.goto("/");
    const result = await page.evaluate(async ({ variants, matchId }) => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return Object.fromEntries(Object.entries(variants).map(([name, state]) =>
        [name, [valid(state, matchId), chronology(state, matchId)]]));
    }, { variants, matchId: initial.matchId });
    expect(Object.keys(result)).toEqual(Object.keys(variants));
    for (const [name, accepted] of Object.entries(result))
      expect(accepted, name).toEqual([false, false]);
    expect(JSON.stringify(variants)).toBe(before);
  });
}

test("#122: malformed public containers still cannot bypass board version", async ({ page }) => {
  const state = snapshot(2);
  await page.goto("/");
  const result = await page.evaluate(async state => {
    const { hasValidDevelopmentPublicEnvelope: valid } =
      await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
    return [null, undefined, false, "", 3, [], {}, { boardVersion: "edonism-streets-v1" }]
      .map(value => valid(value, state.matchId));
  }, state);
  expect(result).toEqual(Array(8).fill(false));
});
