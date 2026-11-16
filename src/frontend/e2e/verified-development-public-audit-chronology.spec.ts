import { expect, test } from "@playwright/test";

// #119: use the ACTUAL Vite TypeScript validator, never a test copy of it.
// Synthetic first-round public events are not executable game commands.
const playerIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;

function genesis(count: Count) {
  const ids = playerIds.slice(0, count);
  return {
    boardVersion: "edonism-streets-v1",
    matchId: "public-chronology",
    revision: 0, round: 1, phase: 0, activePlayerId: "alice" as string | null,
    players: ids.map((playerId, index) => ({
      playerId, startingSlotId: "N-" + String(index + 1).padStart(2, "0"), streetId: index % 2 === 0 ? "gauss" : "einstein",
      freeMoveUsed: false,
    })),
    turnOrder: ids,
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null as string | null,
      toStreetId: null as string | null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

function firstMoveAndEnd(count: Count) {
  const state = genesis(count);
  state.revision = 2;
  state.activePlayerId = "bob";
  state.players[0].streetId = "planck";
  state.players[0].freeMoveUsed = true;
  state.events.push(
    { revision: 1, round: 1, kind: "free-move",
      actorId: "alice", fromStreetId: "gauss", toStreetId: "planck" },
    { revision: 2, round: 1, kind: "turn-ended",
      actorId: "alice", fromStreetId: null, toStreetId: null },
  );
  return state;
}

function pending(count: Count) {
  const state = genesis(count);
  state.phase = 1;
  state.activePlayerId = null;
  for (const [index, actorId] of state.turnOrder.entries()) {
    const revision = index + 1;
    state.events.push({
      revision, round: 1,
      kind: index === count - 1 ? "round-settlement-pending" : "turn-ended",
      actorId, fromStreetId: null, toStreetId: null,
    });
  }
  state.revision = count;
  return state;
}

for (const count of [2, 4, 8] as const) {
  test(`#119: real public chronology accepts genesis, turn events and ${count}-seat settlement`,
    async ({ page }) => {
    const initial = genesis(count);
    const active = firstMoveAndEnd(count);
    const ended = pending(count);
    const futureKind = genesis(count);
    futureKind.revision = 1;
    futureKind.events.push({ revision: 1, round: 1, kind: "future-public-kind",
      actorId: "alice", fromStreetId: null, toStreetId: null });
    const before = JSON.stringify({ initial, active, ended, futureKind });
    await page.goto("/");
    const result = await page.evaluate(async ({ initial, active, ended, futureKind }) => {
      const { hasValidDevelopmentPublicAuditChronology: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return {
        genesis: valid(initial, initial.matchId),
        current: valid(active, active.matchId),
        pending: valid(ended, ended.matchId),
        futureShape: valid(futureKind, futureKind.matchId),
        otherMatch: valid(active, "wrong-match"),
      };
    }, { initial, active, ended, futureKind });
    expect(result).toEqual({
      genesis: true, current: true, pending: true, futureShape: true,
      otherMatch: false,
    });
    expect(JSON.stringify({ initial, active, ended, futureKind })).toBe(before);
  });

  test(`#119: ${count}-seat malformed public audit cannot advance an accepted revision`,
    async ({ page }) => {
    const original = firstMoveAndEnd(count);
    const changed = (modify: (state: typeof original) => void) => {
      const copy = structuredClone(original);
      modify(copy);
      return copy;
    };
    const cases = {
      missingEvent: changed(s => { s.events.pop(); }),
      extraEvent: changed(s => {
        s.events.push({ revision: 3, round: 1, kind: "turn-ended",
          actorId: "bob", fromStreetId: null, toStreetId: null });
      }),
      gap: changed(s => { s.events[1].revision = 8; }),
      duplicateRevision: changed(s => { s.events[2].revision = 1; }),
      swapped: changed(s => { [s.events[1], s.events[2]] = [s.events[2], s.events[1]]; }),
      malformedGenesis: changed(s => { s.events[0].kind = "free-move"; }),
      wrongGenesisActor: changed(s => { s.events[0].actorId = "alice"; }),
      wrongGenesisRevision: changed(s => { s.events[0].revision = 1; }),
      wrongGenesisFrom: changed(s => { s.events[0].fromStreetId = "gauss"; }),
      wrongGenesisTo: changed(s => { s.events[0].toStreetId = "planck"; }),
      genesisMissing: changed(s => { s.events.shift(); s.revision = 1; }),
      futureRoundEvent: changed(s => { s.events[1].round = 2; }),
      wrongSnapshotRound: changed(s => { s.round = 2; }),
      staleSnapshotRevision: changed(s => { s.revision = 1; }),
      highSnapshotRevision: changed(s => { s.revision = 99; }),
      negativeEventRevision: changed(s => { s.events[1].revision = -1; }),
      fractionalEventRevision: changed(s => { s.events[1].revision = 1.5; }),
      nullEvent: changed(s => {
        s.events[2] = null as unknown as (typeof s.events)[number];
      }),
      nullArray: changed(s => { s.events = null as unknown as typeof s.events; }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const result = await page.evaluate(async cases => {
      const { hasValidDevelopmentPublicAuditChronology: valid } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return Object.fromEntries(Object.entries(cases).map(([name, state]) =>
        [name, valid(state, "public-chronology")]));
    }, cases);
    expect(Object.keys(result)).toEqual(Object.keys(cases));
    for (const [name, accepted] of Object.entries(result))
      expect(accepted, name).toBe(false);
    expect(JSON.stringify(cases)).toBe(before);
  });
}

test("#119: malformed chronology containers fail closed without throwing", async ({ page }) => {
  const validState = genesis(2);
  await page.goto("/");
  const result = await page.evaluate(async state => {
    const { hasValidDevelopmentPublicAuditChronology: valid } =
      await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
    return [
      ...[null, undefined, "", 0, {}, [], false]
        .map(value => valid(value, state.matchId)),
      valid(state, ""),
      valid(state, "unrelated"),
      valid({ ...state, events: [] }, state.matchId),
    ];
  }, validState);
  expect(result).toEqual(Array(10).fill(false));
});
