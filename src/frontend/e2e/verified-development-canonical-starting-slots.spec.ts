import { expect, test } from "@playwright/test";

// #129: Import actual Vite guards and shared board. Browser validates only
// immutable initial lot transport provenance; .NET replays authoritative moves.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type SeatCount = 2 | 4 | 8;
function fixture(count: SeatCount) {
  const players = ids.slice(0, count);
  return {
    matchId: "verified-public-origin-lots", boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: players[0],
    players: players.map((playerId, i) => ({
      playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
      streetId: i % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: players,
    proposedNextRoundOrder: [...players.slice(-1), ...players.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null as string | null,
      toStreetId: null as string | null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
function replacingLastOrigin(s: ReturnType<typeof fixture>, slot: unknown) {
  const copy = structuredClone(s);
  copy.players[copy.players.length - 1].startingSlotId = slot as string;
  return copy;
}

for (const count of [2, 4, 8] as const) {
  test("#129: all 30 shared origin slots stay transport-valid with "
    + count + " players", async ({ page }) => {
    const original = fixture(count);
    const before = JSON.stringify(original);
    await page.goto("/");
    const result = await page.evaluate(async data => {
      const { hasValidDevelopmentPublicEnvelope: ingress } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      const { cityBoard } = await import("/src/features/city/board.ts");
      const allSlots = cityBoard.slots.map(slot => slot.id);
      const versions = allSlots.map(last => {
        const used = allSlots.filter(s => s !== last)
          .slice(0, data.players.length - 1);
        const state = structuredClone(data);
        state.players = state.players.map((p, i) => ({
          ...p, startingSlotId: i === state.players.length - 1 ? last : used[i],
        }));
        return [ingress(state, data.matchId), chronology(state, data.matchId)];
      });

      // A valid movement changes CURRENT street, not StartingSlotId.
      const moved = structuredClone(data);
      moved.revision = 1;
      moved.players[0].streetId = "planck";
      moved.players[0].freeMoveUsed = true;
      moved.events.push({
        revision: 1, round: 1, kind: "free-move", actorId: "alice",
        fromStreetId: "gauss", toStreetId: "planck",
      });
      return {
        count: allSlots.length, distinct: new Set(allSlots).size,
        baseline: [ingress(data, data.matchId), chronology(data, data.matchId)],
        all: versions,
        moved: [ingress(moved, data.matchId), chronology(moved, data.matchId)],
      };
    }, original);
    expect(result.count).toBe(30);
    expect(result.distinct).toBe(30);
    expect(result.baseline).toEqual([true, true]);
    expect(result.all).toEqual(Array.from({ length: 30 }, () => [true, true]));
    expect(result.moved).toEqual([true, true]);
    expect(JSON.stringify(original)).toBe(before);
  });

  test("#129: missing, foreign or duplicate origin invalidates the whole "
    + count + "-player match", async ({ page }) => {
    const original = fixture(count);
    const invalid: unknown[] = [
      "", " ", "N-00", "N-09", "N-1", "n-01", "N-01 ",
      "origin-slot-foreign", null, undefined, 42, false, [], { id: "N-01" },
    ];
    const states = invalid.map(x => replacingLastOrigin(original, x));
    states.push(replacingLastOrigin(original, original.players[0].startingSlotId));
    const before = JSON.stringify({ original, states });
    await page.goto("/");
    const response = await page.evaluate(async ({ original, states }) => {
      const { hasValidDevelopmentPublicEnvelope: ingress } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      const { hasValidDevelopmentPublicAuditChronology: chronology } =
        await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
      return {
        rejected: states.map(state => [ingress(state, original.matchId),
          chronology(state, original.matchId)]),
        baseline: ingress(original, original.matchId),
        independentBadCard: ingress({
          ...original, boardActivities: [{ slotId: "N-01", cardId: 42 }],
        }, original.matchId),
      };
    }, { original, states });
    expect(response.rejected).toEqual(Array.from({ length: states.length },
      () => [false, false]));
    expect(response.baseline).toBe(true);
    expect(response.independentBadCard).toBe(true);
    expect(JSON.stringify({ original, states })).toBe(before);
  });
}
