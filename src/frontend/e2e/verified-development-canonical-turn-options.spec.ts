import { expect, test } from "@playwright/test";

// #124: Exercise the real Vite-transformed turn-options guard, not a copy.
// This is a synthetic public first-round fixture, not a claim of legal moves.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function snapshot(count: Count) {
  const seats = names.slice(0, count);
  return {
    matchId: "canonical-turn-options",
    boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: "alice",
    players: seats.map((playerId, i) => ({
      playerId, streetId: i % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: seats,
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
function options(freeMoveStreetIds: unknown) {
  return {
    matchId: "canonical-turn-options", playerId: "alice",
    revision: 0, canEndTurn: true, freeMoveStreetIds,
  };
}

for (const count of [2, 4, 8] as const) {
  test("#124: actual canonical street membership is accepted for " + count + " seats",
    async ({ page }) => {
      const state = snapshot(count);
      const before = JSON.stringify(state);
      await page.goto("/");
      const result = await page.evaluate(async state => {
        const { hasValidDevelopmentTurnOptions: valid } =
          await import("/src/features/matches/verifiedDevelopmentTurnOptions.ts");
        const { cityBoard } = await import("/src/features/city/board.ts");
        const streets = cityBoard.streets.map(s => s.id);
        const otherStreets = streets.filter(id => id !== state.players[0].streetId);
        const sample = (destinations: unknown) => ({
          matchId: state.matchId, playerId: "alice", revision: 0,
          canEndTurn: true, freeMoveStreetIds: destinations,
        });
        return {
          streets,
          eachCanonical: otherStreets.map(id => valid(sample([id]), "alice", state)),
          allCanonical: valid(sample(otherStreets), "alice", state),
          nonAdjacentTransportOnly: valid(sample(["meson"]), "alice", state),
          nonActive: valid({
            matchId: state.matchId, playerId: "bob", revision: 0,
            canEndTurn: false, freeMoveStreetIds: [],
          }, "bob", state),
        };
      }, state);
      expect(result.streets).toEqual([
        "gauss", "einstein", "newton", "planck", "boson", "meson", "main-square",
      ]);
      expect(result.eachCanonical).toEqual(Array(6).fill(true));
      expect(result.allCanonical).toBe(true);
      // Membership never grants movement: only .NET checks adjacency/commands.
      expect(result.nonAdjacentTransportOnly).toBe(true);
      expect(result.nonActive).toBe(true);
      expect(JSON.stringify(state)).toBe(before);
    });

  test("#124: foreign or malformed turn-option destination invalidates whole lease for "
    + count + " seats", async ({ page }) => {
    const state = snapshot(count);
    const invalid: unknown[] = [
      "", " ", "GAUSS", "PLANCK", "planck ", " planck",
      "unmapped-road", "main_square", "planck-x", null, 42, false,
      ["planck"], { id: "planck" },
    ];
    const candidates = invalid.flatMap(destination => [
      options([destination]), options(["planck", destination]),
    ]);
    candidates.push(options(["gauss"]), options(["planck", "planck"]));
    const before = JSON.stringify({ state, candidates });
    await page.goto("/");
    const results = await page.evaluate(async ({ state, candidates }) => {
      const { hasValidDevelopmentTurnOptions: valid } =
        await import("/src/features/matches/verifiedDevelopmentTurnOptions.ts");
      return candidates.map(candidate => valid(candidate, "alice", state));
    }, { state, candidates });
    expect(results).toEqual(Array(candidates.length).fill(false));
    expect(JSON.stringify({ state, candidates })).toBe(before);
  });
}
