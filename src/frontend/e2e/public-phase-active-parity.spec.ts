import { expect, test } from "@playwright/test";

// #116: Import the actual Vite-loaded public ingress guard, not a test copy.
// The only currently implemented .NET phases are PlayerTurns (0) with an
// active seat and AwaitingRoundSettlement (1) with no active seat.
const players = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

function snapshot(count: 2 | 4 | 8) {
  const ids = players.slice(0, count);
  return {
    matchId: "phase-actor-parity",
    revision: 3, round: 1, phase: 0, activePlayerId: "alice" as string | null,
    players: ids.map((playerId, index) => ({
      playerId, streetId: index % 2 === 0 ? "gauss" : "einstein", freeMoveUsed: false,
    })),
    turnOrder: ids,
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#116: ${count}-seat valid player turns and pending settlement phase remain accepted`,
    async ({ page }) => {
    const current = snapshot(count);
    const pending = structuredClone(current);
    pending.phase = 1;
    pending.activePlayerId = null;
    const before = JSON.stringify({ current, pending });
    await page.goto("/");
    const accepted = await page.evaluate(async ({ current, pending }) => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return {
        firstTurn: valid(current, current.matchId),
        lastTurn: valid({ ...current, activePlayerId: current.turnOrder.at(-1) }, current.matchId),
        pending: valid(pending, pending.matchId),
      };
    }, { current, pending });
    expect(accepted).toEqual({ firstTurn: true, lastTurn: true, pending: true });
    expect(JSON.stringify({ current, pending })).toBe(before);
  });

  test(`#116: ${count}-seat contradictory phase and active-seat pairs fail closed`,
    async ({ page }) => {
    const current = snapshot(count);
    const mutate = (f: (value: ReturnType<typeof snapshot>) => void) => {
      const changed = structuredClone(current);
      f(changed);
      return changed;
    };
    const invalid = {
      turnsWithoutActor: mutate(s => { s.activePlayerId = null; }),
      turnsWithBlankActor: mutate(s => { s.activePlayerId = ""; }),
      turnsWithWhitespaceActor: mutate(s => { s.activePlayerId = "  "; }),
      turnsWithNumericActor: mutate(s => {
        s.activePlayerId = 1 as unknown as string;
      }),
      turnsWithUnknownActor: mutate(s => { s.activePlayerId = "intruder"; }),
      settlementHasCurrentActor: mutate(s => { s.phase = 1; }),
      settlementHasDifferentActor: mutate(s => {
        s.phase = 1; s.activePlayerId = "bob";
      }),
      settlementHasBlankActor: mutate(s => {
        s.phase = 1; s.activePlayerId = "";
      }),
      settlementHasUndefinedActor: mutate(s => {
        s.phase = 1; s.activePlayerId = undefined as unknown as string;
      }),
      settlementHasNumericActor: mutate(s => {
        s.phase = 1; s.activePlayerId = 42 as unknown as string;
      }),
    };
    const before = JSON.stringify(invalid);
    await page.goto("/");
    const rejected = await page.evaluate(async invalid => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return Object.fromEntries(Object.entries(invalid).map(([name, state]) =>
        [name, valid(state, "phase-actor-parity")]));
    }, invalid);
    expect(Object.keys(rejected)).toEqual(Object.keys(invalid));
    for (const [name, value] of Object.entries(rejected)) expect(value, name).toBe(false);
    expect(JSON.stringify(invalid)).toBe(before);
  });
}
