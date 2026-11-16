import { expect, test } from "@playwright/test";

// #125: Synthetic first-round transport checks against the actual Vite TS.
// Only the server validates turn legality, card effects and audit replay.
const seats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function fixture(count: Count) {
  const order = seats.slice(0, count);
  return {
    matchId: "canonical-public-audit-streets",
    boardVersion: "edonism-streets-v1",
    revision: 1, round: 1, phase: 0, activePlayerId: "alice",
    players: order.map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"), streetId: i === 0 ? "planck" : i % 2 ? "einstein" : "gauss",
      freeMoveUsed: i === 0,
    })),
    turnOrder: order,
    proposedNextRoundOrder: [...order.slice(-1), ...order.slice(0, -1)],
    events: [
      { revision: 0, round: 1, kind: "match-created", actorId: "system",
        fromStreetId: null as unknown, toStreetId: null as unknown },
      { revision: 1, round: 1, kind: "free-move", actorId: "alice",
        fromStreetId: "gauss" as unknown, toStreetId: "planck" as unknown },
    ],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
function changed(base: ReturnType<typeof fixture>, from: unknown, to: unknown) {
  const next = structuredClone(base);
  next.events[1].fromStreetId = from;
  next.events[1].toStreetId = to;
  return next;
}

for (const count of [2, 4, 8] as const) {
  test("#125: all seven board streets remain transport-valid in public audit for "
    + count + " seats", async ({ page }) => {
    const state = fixture(count);
    const before = JSON.stringify(state);
    await page.goto("/");
    const result = await page.evaluate(async state => {
      const { hasValidDevelopmentPublicEnvelope: envelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      const { cityBoard } = await import("/src/features/city/board.ts");
      const roads = cityBoard.streets.map(street => street.id);
      const withStreet = (from: unknown, to: unknown) => ({
        ...state,
        events: [state.events[0], {
          ...state.events[1], fromStreetId: from, toStreetId: to,
        }],
      });
      const evaluatePair = (from: unknown, to: unknown) => {
        const s = withStreet(from, to);
        return [envelope(s, s.matchId), chronology(s, s.matchId)];
      };
      return {
        roads,
        baseline: evaluatePair("gauss", "planck"),
        allFrom: roads.map(id => evaluatePair(id, "planck")),
        allTo: roads.map(id => evaluatePair("gauss", id)),
        nullFrom: evaluatePair(null, "planck"),
        nullTo: evaluatePair("gauss", null),
        nullBoth: evaluatePair(null, null),
        futureKind: (() => {
          const s = withStreet("boson", "meson");
          s.events[1].kind = "future-public-event";
          return [envelope(s, s.matchId), chronology(s, s.matchId)];
        })(),
        unrelatedBadCard: envelope({
          ...state, boardActivities: [{ slotId: "N-01", cardId: 42 }],
        }, state.matchId),
      };
    }, state);
    expect(result.roads).toEqual([
      "gauss", "einstein", "newton", "planck", "boson", "meson", "main-square",
    ]);
    expect(result.baseline).toEqual([true, true]);
    expect(result.allFrom).toEqual(Array.from({ length: 7 }, () => [true, true]));
    expect(result.allTo).toEqual(Array.from({ length: 7 }, () => [true, true]));
    expect(result.nullFrom).toEqual([true, true]);
    expect(result.nullTo).toEqual([true, true]);
    expect(result.nullBoth).toEqual([true, true]);
    expect(result.futureKind).toEqual([true, true]);
    expect(result.unrelatedBadCard).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  test("#125: malformed or foreign event endpoints reject full snapshot for "
    + count + " seats", async ({ page }) => {
    const state = fixture(count);
    const invalid: unknown[] = [
      "", " ", "GAUSS", "gauss ", " gauss", "unmapped-road",
      "main_square", "planck-x", 42, false, [], { id: "gauss" },
    ];
    const altered = invalid.flatMap(street => [
      changed(state, street, "planck"),
      changed(state, "gauss", street),
      changed(state, street, street),
    ]);
    const before = JSON.stringify({ state, altered });
    await page.goto("/");
    const outcome = await page.evaluate(async ({ matchId, altered }) => {
      const { hasValidDevelopmentPublicEnvelope: envelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return altered.map(s => [envelope(s, matchId), chronology(s, matchId)]);
    }, { matchId: state.matchId, altered });
    expect(outcome).toEqual(Array.from({ length: altered.length }, () => [false, false]));
    expect(JSON.stringify({ state, altered })).toBe(before);
  });
}
