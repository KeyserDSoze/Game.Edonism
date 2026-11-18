import { expect, test } from "@playwright/test";

// #172: Import the genuine Vite module for the complete Domain read-only
// first-round progress projection; this does not create skip-turn commands.
const technicalIds = ["Renée", "王小明", "System", "🙂",
  "alpha", "bravo", "charlie", "delta"];

function fixture(seats: 2 | 4 | 8) {
  const ids = technicalIds.slice(0, seats);
  const matchId = "progress-172";
  const state = {
    boardVersion: "edonism-streets-v1",
    matchId,
    revision: 0,
    round: 1,
    phase: 0,
    activePlayerId: ids[0] as string | null,
    players: ids.map((playerId, index) => ({
      playerId,
      streetId: index % 2 === 0 ? "gauss" : "einstein",
      startingSlotId: "N-" + String(index + 1).padStart(2, "0"),
      freeMoveUsed: false,
    })),
    turnOrder: [...ids],
    proposedNextRoundOrder: [...ids.slice(1), ids[0]],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
    boardActivities: [],
    controlledActivities: [],
    grossSalaryQuotes: [],
  };
  const progress = {
    matchId,
    round: 1,
    verifiedRevision: 0,
    phase: 0,
    activePlayerId: ids[0] as string | null,
    totalTurns: seats,
    completedTurns: 0,
    completedPlayerIds: [] as string[],
    remainingPlayerIds: [...ids],
  };
  return { ids, state, progress };
}

for (const seats of [2, 4, 8] as const) {
  test(`#172: ${seats} authentic progress reports preserve exact public turn partitions`,
    async ({ page }) => {
      const { ids, state, progress } = fixture(seats);
      const middle = {
        state: { ...structuredClone(state), activePlayerId: ids[1] },
        progress: { ...structuredClone(progress),
          activePlayerId: ids[1], completedTurns: 1,
          completedPlayerIds: [ids[0]], remainingPlayerIds: ids.slice(1) },
      };
      const last = {
        state: { ...structuredClone(state), activePlayerId: ids[seats - 1] },
        progress: { ...structuredClone(progress),
          activePlayerId: ids[seats - 1], completedTurns: seats - 1,
          completedPlayerIds: ids.slice(0, -1), remainingPlayerIds: [ids[seats - 1]] },
      };
      const pending = {
        state: { ...structuredClone(state), phase: 1, activePlayerId: null },
        progress: { ...structuredClone(progress), phase: 1,
          activePlayerId: null, completedTurns: seats,
          completedPlayerIds: [...ids], remainingPlayerIds: [] },
      };
      const reordered = { remainingPlayerIds: [...ids], totalTurns: seats,
        activePlayerId: ids[0], matchId: progress.matchId, round: 1, phase: 0,
        completedPlayerIds: [], verifiedRevision: 0, completedTurns: 0 };
      const original = JSON.stringify({ state, progress, middle, last, pending, reordered });
      await page.goto("/");
      const actual = await page.evaluate(async ({ state, progress, middle, last, pending, reordered }) => {
        const { hasValidDevelopmentFirstRoundTurnProgress: valid } =
          await import("/src/features/matches/verifiedDevelopmentFirstRoundTurnProgress.ts");
        return {
          first: valid(progress, state),
          middle: valid(middle.progress, middle.state),
          last: valid(last.progress, last.state),
          pending: valid(pending.progress, pending.state),
          shuffledJsonKeys: valid(reordered, state),
          badState: valid(progress, null),
          badResponse: valid(null, state),
        };
      }, { state, progress, middle, last, pending, reordered });
      expect(actual).toEqual({
        first: true, middle: true, last: true, pending: true,
        shuffledJsonKeys: true, badState: false, badResponse: false,
      });
      expect(JSON.stringify({ state, progress, middle, last, pending, reordered }))
        .toBe(original);
    });

  test(`#172: ${seats} forged or over-wide progress DTO fails closed as a whole`,
    async ({ page }) => {
      const { ids, state, progress } = fixture(seats);
      const changed = (edit: (p: typeof progress) => void) => {
        const copy = structuredClone(progress);
        edit(copy);
        return copy;
      };
      const bad = {
        extraRootSecret: Object.assign(changed(() => {}), { privateHand: ["hidden"] }),
        extraRootToken: Object.assign(changed(() => {}), { token: "hidden" }),
        extraFalseSkip: Object.assign(changed(() => {}), { skipTurn: false }),
        extraNullTimeout: Object.assign(changed(() => {}), { disconnectTimeout: null }),
        extraFutureGrant: Object.assign(changed(() => {}), { futureTurnPermissions: ["end"] }),
        missingMatch: changed(p => { delete (p as unknown as Record<string, unknown>).matchId; }),
        missingRound: changed(p => { delete (p as unknown as Record<string, unknown>).round; }),
        missingPhase: changed(p => { delete (p as unknown as Record<string, unknown>).phase; }),
        missingActive: changed(p => { delete (p as unknown as Record<string, unknown>).activePlayerId; }),
        missingRevision: changed(p => { delete (p as unknown as Record<string, unknown>).verifiedRevision; }),
        missingCompleted: changed(p => { delete (p as unknown as Record<string, unknown>).completedPlayerIds; }),
        missingRemaining: changed(p => { delete (p as unknown as Record<string, unknown>).remainingPlayerIds; }),
        missingTotal: changed(p => { delete (p as unknown as Record<string, unknown>).totalTurns; }),
        missingCount: changed(p => { delete (p as unknown as Record<string, unknown>).completedTurns; }),
        otherMatch: changed(p => { p.matchId = "foreign-match"; }),
        laterRevision: changed(p => { p.verifiedRevision = 1; }),
        negativeRevision: changed(p => { p.verifiedRevision = -1; }),
        otherRound: changed(p => { p.round = 2; }),
        invalidPhase: changed(p => { p.phase = 2; }),
        unexpectedActor: changed(p => { p.activePlayerId = ids[1]; }),
        spoofCount: changed(p => { p.completedTurns = 1; }),
        negativeCount: changed(p => { p.completedTurns = -1; }),
        fractionalTotal: changed(p => { p.totalTurns = seats - 0.5; }),
        numberString: changed(p => { p.completedTurns = "0" as unknown as number; }),
        duplicateRemaining: changed(p => {
          p.remainingPlayerIds[seats - 1] = ids[0];
        }),
        unknownRemaining: changed(p => {
          p.remainingPlayerIds[seats - 1] = "intruder";
        }),
        missingRemainingSeat: changed(p => { p.remainingPlayerIds.pop(); }),
        extraRemainingSeat: changed(p => { p.remainingPlayerIds.push("intruder"); }),
        nullCompleted: changed(p => {
          p.completedPlayerIds = null as unknown as string[];
        }),
        scalarRemaining: changed(p => {
          p.remainingPlayerIds = "spoof" as unknown as string[];
        }),
        nullEntry: changed(p => {
          p.remainingPlayerIds[0] = null as unknown as string;
        }),
      };
      const original = JSON.stringify({ state, progress, bad });
      await page.goto("/");
      const output = await page.evaluate(async ({ bad, state }) => {
        const { hasValidDevelopmentFirstRoundTurnProgress: valid } =
          await import("/src/features/matches/verifiedDevelopmentFirstRoundTurnProgress.ts");
        return Object.entries(bad).map(([name, value]) => [name, valid(value, state)]);
      }, { bad, state });
      expect(output).toHaveLength(Object.keys(bad).length);
      for (const [name, allowed] of output)
        expect(allowed, name as string).toBe(false);
      expect(JSON.stringify({ state, progress, bad })).toBe(original);
    });
}
