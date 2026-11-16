import { expect, test } from "@playwright/test";

// #126: Exercise actual Vite-imported TypeScript, not copied guard logic.
// Unknown event kind remains a transport-compatible shape, not game authority.
const playerIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function stateFor(count: Count) {
  const order = playerIds.slice(0, count);
  return {
    matchId: "public-audit-actors", boardVersion: "edonism-streets-v1",
    revision: 1, round: 1, phase: 0, activePlayerId: "alice",
    players: order.map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"), streetId: i % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: order,
    proposedNextRoundOrder: [...order.slice(-1), ...order.slice(0, -1)],
    events: [
      { revision: 0, round: 1, kind: "match-created", actorId: "system" as unknown,
        fromStreetId: null, toStreetId: null },
      { revision: 1, round: 1, kind: "future-public-kind", actorId: "alice" as unknown,
        fromStreetId: "gauss", toStreetId: "planck" },
    ],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}

for (const count of [2, 4, 8] as const) {
  test("#134: real public envelope admits known actors, chronology reserves system for "
    + count + " seats", async ({ page }) => {
    const initial = stateFor(count);
    const before = JSON.stringify(initial);
    await page.goto("/");
    const result = await page.evaluate(async initial => {
      const { hasValidDevelopmentPublicEnvelope: envelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      const variant = (actorId: unknown) => {
        const s = structuredClone(initial);
        s.events[1].actorId = actorId;
        return [envelope(s, initial.matchId), chronology(s, initial.matchId)];
      };
      return {
        bySeat: initial.turnOrder.map(variant),
        system: variant("system"),
        initial: [envelope(initial, initial.matchId),
          chronology(initial, initial.matchId)],
        badIndependentCard: envelope({
          ...initial, boardActivities: [{ slotId: "N-01", cardId: 42 }],
        }, initial.matchId),
      };
    }, initial);
    expect(result.bySeat).toEqual(Array.from({ length: count }, () => [true, true]));
    // #126's broad envelope is shape-compatible; #134's narrower
    // chronology refuses reserved genesis identity after revision zero.
    expect(result.system).toEqual([true, false]);
    expect(result.initial).toEqual([true, true]);
    expect(result.badIndependentCard).toBe(true);
    expect(JSON.stringify(initial)).toBe(before);
  });

  test("#126: missing or foreign audit actors reject whole match for "
    + count + " seats", async ({ page }) => {
    const initial = stateFor(count);
    const malformed: unknown[] = [
      "outsider", "ALICE", " alice", "alice ", "SYSTEM",
      "system ", "unknown", "", " ", null, false, 42, [], { id: "alice" },
    ];
    const variants = malformed.map(actor => {
      const s = structuredClone(initial);
      s.events[1].actorId = actor;
      return s;
    });
    const before = JSON.stringify({ initial, variants });
    await page.goto("/");
    const result = await page.evaluate(async ({ initial, variants }) => {
      const { hasValidDevelopmentPublicEnvelope: envelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return variants.map(s => [
        envelope(s, initial.matchId), chronology(s, initial.matchId),
      ]);
    }, { initial, variants });
    expect(result).toEqual(
      Array.from({ length: malformed.length }, () => [false, false]));
    expect(JSON.stringify({ initial, variants })).toBe(before);
  });
}
