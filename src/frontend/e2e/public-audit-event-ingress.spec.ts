import { expect, test } from "@playwright/test";

// #113: The REAL Vite-imported TypeScript event contract, not a game replay.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Event = {
  revision: number; round: number; kind: string; actorId: string;
  fromStreetId: string | null; toStreetId: string | null;
};
const publicEvents: Event[] = [
  { revision: 0, round: 1, kind: "match-created", actorId: "system",
    fromStreetId: null, toStreetId: null },
  { revision: 1, round: 1, kind: "free-move", actorId: "alice",
    fromStreetId: "gauss", toStreetId: "planck" },
  { revision: 2, round: 1, kind: "turn-ended", actorId: "alice",
    fromStreetId: null, toStreetId: null },
];
function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  return {
    matchId: "typed-public-events", revision: 2, round: 1, phase: 0,
    activePlayerId: "bob",
    players: ids.map((playerId, i) => ({
      playerId, streetId: i % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: [...ids],
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: structuredClone(publicEvents),
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#113: ${count}-seat public audit events are typed and unknown future kinds remain hidden`,
    async ({ page }) => {
    const state = fixture(count);
    const future = structuredClone(state);
    future.revision = 3;
    future.events.push({
      revision: 3, round: 1, kind: "future-private-action", actorId: "bob",
      fromStreetId: null, toStreetId: null,
    });
    const before = JSON.stringify({ state, future });
    await page.goto("/");
    const result = await page.evaluate(async ({ state, future }) => {
      const { hasValidDevelopmentPublicEnvelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { visiblePublicAuditEvents } =
        await import("/src/features/matches/publicAudit.ts");
      return {
        ingress: hasValidDevelopmentPublicEnvelope(state, state.matchId),
        visible: visiblePublicAuditEvents(state.events, state.players.map(p => p.playerId)),
        futureIngress: hasValidDevelopmentPublicEnvelope(future, future.matchId),
        futureVisible: visiblePublicAuditEvents(future.events, future.players.map(p => p.playerId)),
      };
    }, { state, future });
    expect(result.ingress).toBe(true);
    expect(result.visible).toEqual(publicEvents);
    expect(result.futureIngress).toBe(true);
    expect(result.futureVisible).toEqual(publicEvents);
    expect(JSON.stringify({ state, future })).toBe(before);
  });

  test(`#113: malformed ${count}-seat public audit item rejects ingress and entire feed`,
    async ({ page }) => {
    const base = fixture(count);
    const tamper = (event: unknown) => {
      const snapshot = structuredClone(base);
      snapshot.events[1] = event as Event;
      return snapshot;
    };
    const original = publicEvents[1];
    const cases = {
      nullEvent: tamper(null),
      numericEvent: tamper(42),
      arrayEvent: tamper([]),
      negativeRevision: tamper({ ...original, revision: -1 }),
      fractionalRevision: tamper({ ...original, revision: 1.5 }),
      overflowRevision: tamper({ ...original, revision: Number.MAX_SAFE_INTEGER + 1 }),
      stringRevision: tamper({ ...original, revision: "1" }),
      zeroRound: tamper({ ...original, round: 0 }),
      stringRound: tamper({ ...original, round: "1" }),
      nullKind: tamper({ ...original, kind: null }),
      blankKind: tamper({ ...original, kind: "  " }),
      numericActor: tamper({ ...original, actorId: 13 }),
      blankActor: tamper({ ...original, actorId: "" }),
      numericFromStreet: tamper({ ...original, fromStreetId: 123 }),
      objectToStreet: tamper({ ...original, toStreetId: {} }),
      missingToStreet: tamper({
        revision: 1, round: 1, kind: "free-move",
        actorId: "alice", fromStreetId: "gauss",
      }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const result = await page.evaluate(async inputs => {
      const { hasValidDevelopmentPublicEnvelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { visiblePublicAuditEvents } =
        await import("/src/features/matches/publicAudit.ts");
      return Object.fromEntries(Object.entries(inputs).map(([name, state]) => [
        name, {
          ingress: hasValidDevelopmentPublicEnvelope(state, state.matchId),
          visible: visiblePublicAuditEvents(state.events, state.players.map(p => p.playerId)),
        },
      ]));
    }, cases);
    expect(Object.keys(result)).toEqual(Object.keys(cases));
    for (const [name, outcome] of Object.entries(result)) {
      expect(outcome.ingress, name).toBe(false);
      expect(outcome.visible, name).toEqual([]);
    }
    expect(JSON.stringify(cases)).toBe(before);
  });
}

test("#113: malformed public audit containers and player IDs never throw or display events",
  async ({ page }) => {
  await page.goto("/");
  const out = await page.evaluate(async () => {
    const { visiblePublicAuditEvents, isPublicMatchEventRecord } =
      await import("/src/features/matches/publicAudit.ts");
    const bad: unknown[] = [null, {}, [], "bad", 123, [null], [42], [{}]];
    const genesis = {
      revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null,
    };
    return {
      rejected: bad.map(value => visiblePublicAuditEvents(
        value as Event[], ["alice", "bob"])),
      badPlayers: visiblePublicAuditEvents([genesis], null as unknown as string[]),
      recognized: isPublicMatchEventRecord(genesis),
    };
  });
  expect(out.rejected).toHaveLength(8);
  for (const value of out.rejected) expect(value).toEqual([]);
  expect(out.badPlayers).toEqual([]);
  expect(out.recognized).toBe(true);
});
