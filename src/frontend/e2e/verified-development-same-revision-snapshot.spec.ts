import { expect, test } from "@playwright/test";

// #121: Import the ACTUAL Vite TypeScript guard, not a copied comparator.
// These are PUBLIC Development snapshots; no private hand or bearer.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function publicState(count: Count) {
  const seats = ids.slice(0, count);
  return {
    matchId: "same-revision-contract", boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: "alice" as string | null,
    turnOrder: seats,
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    players: seats.map((playerId, index) => ({
      playerId, startingSlotId: `N-${index + 1}`,
      streetId: index % 2 ? "einstein" : "gauss",
      freeMoveUsed: false, hearts: 3,
    })),
    boardActivities: [
      { slotId: "N-01", cardId: "public:lot:one", category: "culture" },
      { slotId: "S-01", cardId: "public:lot:two", category: "sport" },
    ],
    controlledActivities: [
      { slotId: "N-01", ownerPlayerId: "alice", posture: 0 },
    ],
    grossSalaryQuotes: seats.map(playerId => ({
      playerId, baseAtoms: 2, standingActivityAtoms: 1, grossAtoms: 3,
    })),
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#121: identical ${count}-seat public JSON snapshots can safely share revision ETag`,
    async ({ page }) => {
    const state = publicState(count);
    const clone = structuredClone(state);
    const reversedKeys = JSON.parse(JSON.stringify(state, (_, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    )) as typeof state;
    const before = JSON.stringify({ state, clone, reversedKeys });
    await page.goto("/");
    const result = await page.evaluate(async ({ state, clone, reversedKeys }) => {
      const { hasSameDevelopmentPublicSnapshotAtRevision: equal } =
        await import("/src/features/matches/verifiedDevelopmentSameRevisionSnapshot.ts");
      return {
        same: equal(state, clone, state.matchId),
        keyOrderIndependent: equal(state, reversedKeys, state.matchId),
        symmetric: equal(reversedKeys, state, state.matchId),
        self: equal(state, state, state.matchId),
      };
    }, { state, clone, reversedKeys });
    expect(result).toEqual({
      same: true, keyOrderIndependent: true, symmetric: true, self: true,
    });
    expect(JSON.stringify({ state, clone, reversedKeys })).toBe(before);
  });

  test(`#121: ${count}-seat same-revision public equivocation fails closed`,
    async ({ page }) => {
    const original = publicState(count);
    const change = (edit: (value: typeof original) => void) => {
      const next = structuredClone(original);
      edit(next);
      return next;
    };
    const variants = {
      movedStreet: change(s => { s.players[0].streetId = "planck"; }),
      forgedOtherSeat: change(s => { s.players[1].streetId = "boson"; }),
      freeMoveFlag: change(s => { s.players[0].freeMoveUsed = true; }),
      changedHearts: change(s => { s.players[0].hearts = 4; }),
      reorderedPlayers: change(s => { [s.players[0], s.players[1]] =
        [s.players[1], s.players[0]]; }),
      alteredProposal: change(s => { s.proposedNextRoundOrder.reverse(); }),
      alteredTurnOrder: change(s => { s.turnOrder.reverse(); }),
      alteredPublicAudit: change(s => { s.events[0].kind = "turn-ended"; }),
      morePublicEvents: change(s => { s.events.push({
        revision: 1, round: 1, kind: "free-move", actorId: "alice",
        fromStreetId: "gauss", toStreetId: "planck",
      }); }),
      changedBoardCard: change(s => { s.boardActivities[0].cardId = "other-card"; }),
      changedLotControl: change(s => { s.controlledActivities[0].posture = 1; }),
      changedSalaryQuote: change(s => { s.grossSalaryQuotes[0].grossAtoms = 30; }),
      reversedActivityOrder: change(s => { s.boardActivities.reverse(); }),
      addedPublicProperty: { ...original, phantomPublicField: true },
      removedPublicProperty: (() => {
        const next = structuredClone(original);
        return { ...next, boardActivities: undefined };
      })(),
      higherRevision: change(s => { s.revision = 1; }),
      lowerRevision: change(s => { s.revision = -1; }),
      changedMatch: change(s => { s.matchId = "not-this-match"; }),
    };
    const before = JSON.stringify(variants);
    await page.goto("/");
    const result = await page.evaluate(async ({ original, variants }) => {
      const { hasSameDevelopmentPublicSnapshotAtRevision: equal } =
        await import("/src/features/matches/verifiedDevelopmentSameRevisionSnapshot.ts");
      return Object.fromEntries(Object.entries(variants).map(([name, value]) =>
        [name, equal(original, value, original.matchId)]));
    }, { original, variants });
    expect(Object.keys(result)).toEqual(Object.keys(variants));
    for (const [name, value] of Object.entries(result)) expect(value, name).toBe(false);
    expect(JSON.stringify(variants)).toBe(before);
  });
}

test("#121: untrusted non-JSON or oversized same-revision records are rejected", async ({ page }) => {
  const state = publicState(2);
  await page.goto("/");
  const result = await page.evaluate(async state => {
    const { hasSameDevelopmentPublicSnapshotAtRevision: equal } =
      await import("/src/features/matches/verifiedDevelopmentSameRevisionSnapshot.ts");
    const bad = [null, undefined, [], {}, 2, "json", false, {
      ...state, revision: Number.NaN,
    }];
    let nested: unknown = "end";
    for (let i = 0; i < 25; i++) nested = { item: nested };
    const deep = { ...state, boardActivities: [nested] };
    const huge = { ...state, boardActivities: Array(15000).fill("public-data") };
    return [
      ...bad.map(value => equal(state, value, state.matchId)),
      equal(state, state, ""),
      equal(state, state, "wrong-match"),
      equal({ ...state, boardActivities: [nested] }, deep, state.matchId),
      equal(huge, structuredClone(huge), state.matchId),
    ];
  }, state);
  expect(result).toEqual(Array(12).fill(false));
});
