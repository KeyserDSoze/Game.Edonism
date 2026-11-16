import { expect, test } from "@playwright/test";

// #123: exercise the real Vite-loaded public ingress; no copied validators.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function stateFor(count: Count) {
  const seats = ids.slice(0, count);
  return {
    matchId: "canonical-public-street",
    boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: seats[0],
    players: seats.map((playerId, index) => ({
      playerId, startingSlotId: "N-" + String(index + 1).padStart(2, "0"), streetId: index % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: seats,
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
for (const count of [2, 4, 8] as const) {
  test("#123: all seven canonical streets remain valid for " + count + " seats",
    async ({ page }) => {
      const initial = stateFor(count);
      const before = JSON.stringify(initial);
      await page.goto("/");
      const result = await page.evaluate(async initial => {
        const { hasValidDevelopmentPublicEnvelope: valid } =
          await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
        const { hasValidDevelopmentPublicAuditChronology: chronology } =
          await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
        const { cityBoard } = await import("/src/features/city/board.ts");
        const candidates = cityBoard.streets.map(street => ({
          ...initial,
          players: initial.players.map((player, index) => index === initial.players.length - 1
            ? { ...player, streetId: street.id } : player),
        }));
        return {
          canonical: cityBoard.streets.map(street => street.id),
          initial: valid(initial, initial.matchId),
          chronology: chronology(initial, initial.matchId),
          accepted: candidates.map(candidate => valid(candidate, initial.matchId)),
          unrelatedBadCard: valid({
            ...initial,
            boardActivities: [{ slotId: "N-01", cardId: 999, category: "culture" }],
          }, initial.matchId),
        };
      }, initial);
      expect(result.canonical).toEqual([
        "gauss", "einstein", "newton", "planck", "boson", "meson", "main-square",
      ]);
      expect(result.initial).toBe(true);
      expect(result.chronology).toBe(true);
      expect(result.accepted).toEqual(Array(7).fill(true));
      expect(result.unrelatedBadCard).toBe(true);
      expect(JSON.stringify(initial)).toBe(before);
    });

  test("#123: forged streets in either endpoint seat fail for " + count + " seats",
    async ({ page }) => {
      const initial = stateFor(count);
      const malformed: unknown[] = [
        "", " ", "GAUSS", "gauss ", " gauss", "gauss-extra",
        "main_square", "none", null, 4, ["gauss"], { id: "gauss" }, false,
      ];
      const variants = [0, count - 1].flatMap(index =>
        malformed.map(streetId => ({
          ...initial,
          players: initial.players.map((player, i) => i === index
            ? { ...player, streetId } : player),
        })));
      const before = JSON.stringify({ initial, variants });
      await page.goto("/");
      const result = await page.evaluate(async ({ matchId, variants }) => {
        const { hasValidDevelopmentPublicEnvelope: valid } =
          await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
        const { hasValidDevelopmentPublicAuditChronology: chronology } =
          await import("/src/features/matches/verifiedDevelopmentPublicAuditChronology.ts");
        return variants.map(candidate => [
          valid(candidate, matchId), chronology(candidate, matchId),
        ]);
      }, { matchId: initial.matchId, variants });
      expect(result).toEqual(Array.from({ length: variants.length }, () => [false, false]));
      expect(JSON.stringify({ initial, variants })).toBe(before);
    });
}
