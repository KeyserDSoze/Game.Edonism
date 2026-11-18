import { expect, test } from "@playwright/test";

// #117: Pure browser-imported Vite TS, not copied TypeScript test logic.
// No client legal-route computation: mock options are shaped like .NET output.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  return {
    boardVersion: "edonism-streets-v1",
    matchId: "actor-options-parity",
    revision: 2, round: 1, phase: 0,
    activePlayerId: "alice" as string | null,
    players: ids.map((playerId, index) => ({
      playerId, startingSlotId: "N-" + String(index + 1).padStart(2, "0"), streetId: index % 2 === 0 ? "gauss" : "einstein",
      freeMoveUsed: false,
    })),
    turnOrder: [...ids],
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created", actorId: "system",
      fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
const options = (playerId: string, canEndTurn: boolean, freeMoveStreetIds: unknown[] = []) => ({
  matchId: "actor-options-parity", playerId, revision: 2, canEndTurn,
  freeMoveStreetIds,
});

for (const count of [2, 4, 8] as const) {
  test(`#117: valid ${count}-seat options agree with current and pending public turns`,
    async ({ page }) => {
    const state = fixture(count);
    const last = structuredClone(state);
    last.activePlayerId = last.turnOrder.at(-1)!;
    const moved = structuredClone(state);
    moved.players[0].freeMoveUsed = true;
    const pending = structuredClone(state);
    pending.phase = 1;
    pending.activePlayerId = null;
    const shuffled = {
      freeMoveStreetIds: ["newton", "planck"], canEndTurn: true,
      revision: 2, playerId: "alice", matchId: state.matchId,
    }; // Object property insertion order is irrelevant to the JSON contract.
    const before = JSON.stringify({ state, last, moved, pending, shuffled });
    await page.goto("/");
    const result = await page.evaluate(async ({ state, last, moved, pending, shuffled, count }) => {
      const { hasValidDevelopmentTurnOptions: valid } =
        await import("/src/features/matches/verifiedDevelopmentTurnOptions.ts");
      const lastSeat = last.turnOrder.at(-1)!;
      return {
        active: valid({ matchId: state.matchId, playerId: "alice", revision: 2,
          canEndTurn: true, freeMoveStreetIds: ["planck", "newton"] }, "alice", state),
        reorderedKeys: valid(shuffled, "alice", state),
        other: valid({ matchId: state.matchId, playerId: "bob", revision: 2,
          canEndTurn: false, freeMoveStreetIds: [] }, "bob", state),
        last: valid({ matchId: last.matchId, playerId: lastSeat, revision: 2,
          canEndTurn: true, freeMoveStreetIds: ["planck"] }, lastSeat, last),
        usedMove: valid({ matchId: moved.matchId, playerId: "alice", revision: 2,
          canEndTurn: true, freeMoveStreetIds: [] }, "alice", moved),
        pending: valid({ matchId: pending.matchId, playerId: lastSeat, revision: 2,
          canEndTurn: false, freeMoveStreetIds: [] }, lastSeat, pending),
        missingSeat: valid({ matchId: state.matchId, playerId: "intruder", revision: 2,
          canEndTurn: false, freeMoveStreetIds: [] }, "intruder", state),
        playerCount: count,
      };
    }, { state, last, moved, pending, shuffled, count });
    expect(result).toEqual({
      active: true, reorderedKeys: true, other: true, last: true, usedMove: true,
      pending: true, missingSeat: false, playerCount: count,
    });
    expect(JSON.stringify({ state, last, moved, pending, shuffled })).toBe(before);
  });

  test(`#117: ${count}-seat forged options never invent end-turn or a second free move`,
    async ({ page }) => {
    const state = fixture(count);
    const moved = structuredClone(state);
    moved.players[0].freeMoveUsed = true;
    const pending = structuredClone(state);
    pending.phase = 1;
    pending.activePlayerId = null;
    const validActive = options("alice", true, ["planck"]);
    const tamper = (change: (value: ReturnType<typeof options>) => void) => {
      const next = structuredClone(validActive);
      change(next);
      return next;
    };
    const invalid = {
      // #170: actor options are retained as a raw HTTP object, so any
      // unexpected key (including a null/false value) fails closed.
      extraPrivateHand: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { privateHand: ["hidden"] }) },
      extraAdminActions: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { adminActions: ["override-turn"] }) },
      extraToken: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { token: "fake-secret" }) },
      extraFutureActions: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { futureActions: [] }) },
      extraUnknownMetadata: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { unknownMetadata: true }) },
      extraNullMetadata: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { metadata: null }) },
      extraInertBoolean: { state, actor: "alice", result:
        Object.assign(structuredClone(validActive), { mayMoveAnywhere: false }) },
      missingCanEndTurn: { state, actor: "alice", result: (() => {
        const row = { ...validActive };
        delete (row as Record<string, unknown>).canEndTurn;
        return row;
      })() },
      missingFreeMoves: { state, actor: "alice", result: (() => {
        const row = { ...validActive };
        delete (row as Record<string, unknown>).freeMoveStreetIds;
        return row;
      })() },
      missingPlayer: { state, actor: "alice", result: (() => {
        const row = { ...validActive };
        delete (row as Record<string, unknown>).playerId;
        return row;
      })() },
      missingRevision: { state, actor: "alice", result: (() => {
        const row = { ...validActive };
        delete (row as Record<string, unknown>).revision;
        return row;
      })() },
      missingMatch: { state, actor: "alice", result: (() => {
        const row = { ...validActive };
        delete (row as Record<string, unknown>).matchId;
        return row;
      })() },
      falseEndTurn: { state, actor: "alice", result: tamper(x => { x.canEndTurn = false; }) },
      wrongActorPermission: { state, actor: "bob", result: options("bob", true) },
      wrongActorMoves: { state, actor: "bob", result: options("bob", false, ["planck"]) },
      movedSeatExtraMove: { state: moved, actor: "alice", result: validActive },
      pendingExtraMove: { state: pending, actor: "alice",
        result: options("alice", false, ["planck"]) },
      pendingFalsePermission: { state: pending, actor: "alice",
        result: options("alice", true) },
      duplicateStreet: { state, actor: "alice", result: options("alice", true, ["planck", "planck"]) },
      blankStreet: { state, actor: "alice", result: options("alice", true, [" "]) },
      numericStreet: { state, actor: "alice", result: options("alice", true, [42]) },
      sameStreet: { state, actor: "alice", result: options("alice", true, ["gauss"]) },
      nullStreet: { state, actor: "alice", result: options("alice", true, [null]) },
      unknownActor: { state, actor: "alice", result: tamper(x => { x.playerId = "intruder"; }) },
      wrongMatch: { state, actor: "alice", result: tamper(x => { x.matchId = "another-match"; }) },
      wrongRevision: { state, actor: "alice", result: tamper(x => { x.revision = 3; }) },
      negativeRevision: { state, actor: "alice", result: tamper(x => { x.revision = -1; }) },
      wrongBoolean: { state, actor: "alice", result: tamper(x => {
        x.canEndTurn = 1 as unknown as boolean;
      }) },
      nullDestinations: { state, actor: "alice", result: tamper(x => {
        x.freeMoveStreetIds = null as unknown as unknown[];
      }) },
      stringDestinations: { state, actor: "alice", result: tamper(x => {
        x.freeMoveStreetIds = "planck" as unknown as unknown[];
      }) },
      badSnapshot: { state: { ...state, players: null }, actor: "alice", result: validActive },
    };
    const before = JSON.stringify(invalid);
    await page.goto("/");
    const result = await page.evaluate(async invalid => {
      const { hasValidDevelopmentTurnOptions: valid } =
        await import("/src/features/matches/verifiedDevelopmentTurnOptions.ts");
      return Object.fromEntries(Object.entries(invalid).map(([name, data]) =>
        [name, valid(data.result, data.actor, data.state)]));
    }, invalid);
    expect(Object.keys(result)).toEqual(Object.keys(invalid));
    for (const [name, accepted] of Object.entries(result)) expect(accepted, name).toBe(false);
    expect(JSON.stringify(invalid)).toBe(before);
  });
}

test("#117: malformed options or snapshot never throw or claim turn permission",
  async ({ page }) => {
  const state = fixture(2);
  await page.goto("/");
  const result = await page.evaluate(async state => {
    const { hasValidDevelopmentTurnOptions: valid } =
      await import("/src/features/matches/verifiedDevelopmentTurnOptions.ts");
    const inputs: unknown[] = [null, undefined, 0, [], "oops", {},
      { matchId: state.matchId, playerId: "alice", revision: state.revision,
        canEndTurn: true, freeMoveStreetIds: {} }];
    const proper = { matchId: state.matchId, playerId: "alice",
      revision: state.revision, canEndTurn: true, freeMoveStreetIds: ["planck"] };
    return [
      ...inputs.map(value => valid(value, "alice", state)),
      valid(proper, "alice", null),
      valid(proper, "alice", []),
      valid(proper, "", state),
      valid(proper, "intruder", state),
    ];
  }, state);
  expect(result).toEqual(Array(11).fill(false));
});
