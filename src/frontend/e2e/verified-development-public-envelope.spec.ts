import { expect, test } from "@playwright/test";

const seats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
function fixture(count: 2 | 4 | 8) {
  const ids = seats.slice(0, count);
  return {
    matchId: "public-envelope-test",
    revision: 3, round: 1, phase: 0, activePlayerId: "alice",
    players: ids.map((playerId, i) => ({
      playerId, streetId: i % 2 === 0 ? "gauss" : "einstein", freeMoveUsed: false,
    })),
    turnOrder: [...ids],
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: [{ revision: 0, kind: "match-created" }],
    boardActivities: [{ slotId: "N-01", cardId: "demo:activity:gauss", category: "culture" }],
    controlledActivities: [{ slotId: "N-01", ownerPlayerId: "alice", posture: 0 }],
    grossSalaryQuotes: ids.map(playerId => ({
      playerId, baseAtoms: 2, standingActivityAtoms: playerId === "alice" ? 1 : 0,
      grossAtoms: playerId === "alice" ? 3 : 2,
    })),
  };
}

for (const count of [2, 4, 8] as const) {
  test(`#112: valid ${count}-seat public snapshot envelope is accepted without mutation`,
    async ({ page }) => {
    const data = fixture(count);
    const before = JSON.stringify(data);
    await page.goto("/");
    const result = await page.evaluate(async input => {
      const { hasValidDevelopmentPublicEnvelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return {
        match: hasValidDevelopmentPublicEnvelope(input, input.matchId),
        wrongMatch: hasValidDevelopmentPublicEnvelope(input, "another-match"),
      };
    }, data);
    expect(result).toEqual({ match: true, wrongMatch: false });
    expect(JSON.stringify(data)).toBe(before);
  });

  test(`#112: ${count}-seat forged revision, player and turn-order envelopes fail closed`,
    async ({ page }) => {
    const data = fixture(count);
    const changed = (mutate: (state: ReturnType<typeof fixture>) => void) => {
      const state = structuredClone(data);
      mutate(state);
      return state;
    };
    const cases = {
      negativeRevision: changed(s => { s.revision = -1; }),
      fractionalRevision: changed(s => { s.revision = 3.5; }),
      overflowRevision: changed(s => { s.revision = Number.MAX_SAFE_INTEGER + 1; }),
      badRound: changed(s => { s.round = 0; }),
      badPhase: changed(s => { s.phase = 5; }),
      unknownActiveSeat: changed(s => { s.activePlayerId = "intruder"; }),
      badPlayer: changed(s => {
        s.players[0] = null as unknown as typeof s.players[0];
      }),
      repeatedPlayer: changed(s => { s.players.push({ ...s.players[0] }); }),
      missingPlayer: changed(s => { s.players.pop(); }),
      numericPlayerId: changed(s => {
        s.players[0].playerId = 7 as unknown as string;
      }),
      numericStreet: changed(s => {
        s.players[0].streetId = 3 as unknown as string;
      }),
      badMoveFlag: changed(s => {
        s.players[0].freeMoveUsed = 0 as unknown as boolean;
      }),
      unknownTurnOrder: changed(s => { s.turnOrder[0] = "intruder"; }),
      duplicateTurnOrder: changed(s => { s.turnOrder[1] = s.turnOrder[0]; }),
      incompleteNextOrder: changed(s => { s.proposedNextRoundOrder.pop(); }),
      duplicatedNextOrder: changed(s => {
        s.proposedNextRoundOrder[1] = s.proposedNextRoundOrder[0];
      }),
      malformedEvents: changed(s => {
        s.events = null as unknown as typeof s.events;
      }),
      malformedCardsArray: changed(s => {
        s.boardActivities = 42 as unknown as typeof s.boardActivities;
      }),
      malformedControlledArray: changed(s => {
        s.controlledActivities = null as unknown as typeof s.controlledActivities;
      }),
      malformedQuotesArray: changed(s => {
        s.grossSalaryQuotes = {} as unknown as typeof s.grossSalaryQuotes;
      }),
      forgedMatch: changed(s => { s.matchId = "not-our-match"; }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const results = await page.evaluate(async inputs => {
      const { hasValidDevelopmentPublicEnvelope } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return Object.fromEntries(Object.entries(inputs)
        .map(([name, state]) => [name, hasValidDevelopmentPublicEnvelope(state,
          "public-envelope-test")]));
    }, cases);
    expect(Object.keys(results)).toEqual(Object.keys(cases));
    for (const [name, result] of Object.entries(results)) expect(result, name).toBe(false);
    expect(JSON.stringify(cases)).toBe(before);
  });
}

test("#112: runtime JSON containers are checked, but individual card display faults stay isolated",
  async ({ page }) => {
  const state = fixture(2);
  const malformed = [
    null, {}, [], "bad", 3,
    { ...state, players: null },
    { ...state, turnOrder: null },
    { ...state, proposedNextRoundOrder: null },
    { ...state, events: "invalid" },
    { ...state, boardActivities: null },
    { ...state, controlledActivities: null },
    { ...state, grossSalaryQuotes: null },
  ];
  const badCard = structuredClone(state);
  badCard.boardActivities[0].cardId = 42 as unknown as string;
  const before = JSON.stringify({ malformed, badCard });
  await page.goto("/");
  const result = await page.evaluate(async ({ inputs, badCard }) => {
    const { hasValidDevelopmentPublicEnvelope } =
      await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
    return {
      malformed: inputs.map(value => hasValidDevelopmentPublicEnvelope(value, "public-envelope-test")),
      independentCardDisplay: hasValidDevelopmentPublicEnvelope(badCard, "public-envelope-test"),
    };
  }, { inputs: malformed, badCard });
  expect(result.malformed).toHaveLength(malformed.length);
  for (const item of result.malformed) expect(item).toBe(false);
  expect(result.independentCardDisplay).toBe(true);
  expect(JSON.stringify({ malformed, badCard })).toBe(before);
});
