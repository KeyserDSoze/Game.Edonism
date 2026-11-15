import { expect, test } from "@playwright/test";

// #120: Real Vite TypeScript ingress guard. The .NET Domain is the only
// authority for player turns; this only checks ordered public read models.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type SeatCount = 2 | 4 | 8;

function genesis(count: SeatCount) {
  const seats = names.slice(0, count);
  return {
    matchId: "verified-turn-order",
    round: 1, revision: 0, phase: 0, activePlayerId: seats[0] as string | null,
    players: seats.map((playerId, index) => ({
      playerId, streetId: index % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: [...seats],
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    events: [{
      revision: 0, round: 1, kind: "match-created", actorId: "system",
      fromStreetId: null as string | null, toStreetId: null as string | null,
    }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

function pending(count: SeatCount) {
  const state = genesis(count);
  state.activePlayerId = null;
  state.phase = 1;
  for (let i = 0; i < count; i++) {
    state.events.push({
      revision: i + 1, round: 1,
      kind: i === count - 1 ? "round-settlement-pending" : "turn-ended",
      actorId: state.turnOrder[i], fromStreetId: null, toStreetId: null,
    });
  }
  state.revision = count;
  return state;
}

for (const count of [2, 4, 8] as const) {
  test(`#120: ${count} seats keep authoritative ordered players and last-to-first preview`,
    async ({ page }) => {
    const beginning = genesis(count);
    const waiting = pending(count);
    const expected = [beginning.turnOrder.at(-1), ...beginning.turnOrder.slice(0, -1)];
    const before = JSON.stringify({ beginning, waiting });
    await page.goto("/");
    const output = await page.evaluate(async ({ beginning, waiting }) => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: validAudit } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return {
        initial: valid(beginning, beginning.matchId),
        settlement: valid(waiting, waiting.matchId),
        auditInitial: validAudit(beginning, beginning.matchId),
        auditSettlement: validAudit(waiting, waiting.matchId),
        ordered: beginning.players.map(player => player.playerId),
        proposed: beginning.proposedNextRoundOrder,
      };
    }, { beginning, waiting });
    expect(output).toEqual({
      initial: true, settlement: true,
      auditInitial: true, auditSettlement: true,
      ordered: beginning.turnOrder, proposed: expected,
    });
    expect(JSON.stringify({ beginning, waiting })).toBe(before);
  });

  test(`#120: ${count} seats reject plausible but false public turn permutations`,
    async ({ page }) => {
    const initial = genesis(count);
    const revised = pending(count);
    const mutate = (edit: (state: typeof initial) => void) => {
      const state = structuredClone(initial);
      edit(state);
      return state;
    };
    const bad = {
      proposedOriginalOrder: mutate(s => {
        s.proposedNextRoundOrder = [...s.turnOrder];
      }),
      proposedSwapFirstTwo: mutate(s => {
        [s.proposedNextRoundOrder[0], s.proposedNextRoundOrder[1]] =
          [s.proposedNextRoundOrder[1], s.proposedNextRoundOrder[0]];
      }),
      proposedSwapLastTwo: mutate(s => {
        const i = s.proposedNextRoundOrder.length - 1;
        [s.proposedNextRoundOrder[i], s.proposedNextRoundOrder[i - 1]] =
          [s.proposedNextRoundOrder[i - 1], s.proposedNextRoundOrder[i]];
      }),
      playerOrderSwap: mutate(s => {
        [s.players[0], s.players[1]] = [s.players[1], s.players[0]];
      }),
      turnOrderSwap: mutate(s => {
        [s.turnOrder[0], s.turnOrder[1]] = [s.turnOrder[1], s.turnOrder[0]];
      }),
      turnOrderAndProposalAlignedButPlayersStale: mutate(s => {
        [s.turnOrder[0], s.turnOrder[1]] = [s.turnOrder[1], s.turnOrder[0]];
        s.proposedNextRoundOrder = [
          s.turnOrder.at(-1)!, ...s.turnOrder.slice(0, -1),
        ];
      }),
      settlementWrongProposal: (() => {
        const state = structuredClone(revised);
        state.proposedNextRoundOrder = [...state.turnOrder];
        return state;
      })(),
    };
    const before = JSON.stringify(bad);
    await page.goto("/");
    const result = await page.evaluate(async bad => {
      const { hasValidDevelopmentPublicEnvelope: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return Object.fromEntries(Object.entries(bad).map(([name, state]) =>
        [name, valid(state, "verified-turn-order")]));
    }, bad);
    expect(Object.keys(result)).toEqual(Object.keys(bad));
    for (const [name, accepted] of Object.entries(result))
      expect(accepted, name).toBe(false);
    expect(JSON.stringify(bad)).toBe(before);
  });
}

test("#120: untrusted ordered public state containers never throw or bind", async ({ page }) => {
  const current = genesis(2);
  await page.goto("/");
  const result = await page.evaluate(async current => {
    const { hasValidDevelopmentPublicEnvelope: valid } =
      await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
    return [
      ...[null, undefined, {}, [], false, 3, "not-a-snapshot"]
        .map(value => valid(value, current.matchId)),
      valid({ ...current, turnOrder: null }, current.matchId),
      valid({ ...current, proposedNextRoundOrder: {} }, current.matchId),
      valid({ ...current, players: null }, current.matchId),
      valid(current, "not-this-match"),
    ];
  }, current);
  expect(result).toEqual(Array(11).fill(false));
});
