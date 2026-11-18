import { expect, test } from "@playwright/test";

// #114: Real Vite TS guard; synthetic credentials are TEST-ONLY, never stored.
const names = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const token = (index: number) => "abcdef01".charAt(index).repeat(64);
function fixture(count: 2 | 4 | 8) {
  const ids = names.slice(0, count);
  const matchId = "00000000-0000-0000-0000-000000000020";
  return {
    matchId,
    state: {
      boardVersion: "edonism-streets-v1",
      matchId, revision: 0, round: 1, phase: 0, activePlayerId: "alice",
      players: ids.map((playerId, i) => ({
        playerId, startingSlotId: "N-" + String(i + 1).padStart(2, "0"), streetId: i % 2 ? "einstein" : "gauss", freeMoveUsed: false,
      })),
      turnOrder: [...ids],
      proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
      events: [{ revision: 0, round: 1, kind: "match-created", actorId: "system",
        fromStreetId: null, toStreetId: null }],
      boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
    },
    credentials: ids.map((playerId, index) => ({ playerId, token: token(index) })),
  };
}
for (const count of [2, 4, 8] as const) {
  test(`#114: valid ${count}-seat creator token binding is pure and deterministic`,
    async ({ page }) => {
    const response = fixture(count);
    const ids = response.state.players.map(p => p.playerId);
    const permuted = structuredClone(response);
    permuted.credentials.reverse(); // Wire order is not a token authority.
    const unicode = structuredClone(response);
    unicode.state.players[0].playerId = "Renée";
    unicode.state.activePlayerId = "Renée";
    unicode.state.turnOrder[0] = "Renée";
    unicode.state.proposedNextRoundOrder[1] = "Renée";
    unicode.credentials[0].playerId = "Renée";
    const unicodeIds = [...ids];
    unicodeIds[0] = "Renée";
    const before = JSON.stringify({ response, ids, permuted, unicode, unicodeIds });
    await page.goto("/");
    const r = await page.evaluate(async ({ response, ids, permuted, unicode, unicodeIds }) => {
      const { hasValidDevelopmentCreatorResponse } =
        await import("/src/features/matches/verifiedDevelopmentCreatorResponse.ts");
      return {
        correct: hasValidDevelopmentCreatorResponse(response, ids),
        permuted: hasValidDevelopmentCreatorResponse(permuted, ids),
        unicode: hasValidDevelopmentCreatorResponse(unicode, unicodeIds),
        duplicateRequest: hasValidDevelopmentCreatorResponse(response, [ids[0], ...ids]),
        wrongSeat: hasValidDevelopmentCreatorResponse(response,
          ids.map(id => id === "bob" ? "intruder" : id)),
      };
    }, { response, ids, permuted, unicode, unicodeIds });
    expect(r).toEqual({
      correct: true, permuted: true, unicode: true,
      duplicateRequest: false, wrongSeat: false,
    });
    expect(JSON.stringify({ response, ids, permuted, unicode, unicodeIds })).toBe(before);
  });
  test(`#114: ${count}-seat forged credential and creator response fields fail closed`,
    async ({ page }) => {
    const response = fixture(count);
    const ids = response.state.players.map(p => p.playerId);
    const altered = (edit: (r: ReturnType<typeof fixture>) => void) => {
      const r = structuredClone(response);
      edit(r);
      return r;
    };
    const cases = {
      // #169: the 201 DTO enters React session storage as a raw object.
      // Reject ANY extra top-level/credential keys, not just invalid tokens.
      extraTopLevelSecret: altered(r => { Object.assign(r, {
        remainingDrawPile: ["hidden"],
      }); }),
      extraTopLevelPrivateHands: altered(r => { Object.assign(r, {
        privateHands: [{ playerId: "alice", cardIds: ["hidden"] }],
      }); }),
      extraTopLevelToken: altered(r => { Object.assign(r, {
        token: "top-secret",
      }); }),
      extraTopLevelMetadata: altered(r => { Object.assign(r, {
        unknownMetadata: true,
      }); }),
      extraFirstCredentialCards: altered(r => { Object.assign(r.credentials[0], {
        otherPlayerCards: ["hidden"],
      }); }),
      extraLastCredentialSecret: altered(r => {
        Object.assign(r.credentials[r.credentials.length - 1], {
          secret: "top-secret",
        });
      }),
      extraLastCredentialDeck: altered(r => {
        Object.assign(r.credentials[r.credentials.length - 1], {
          privateDeal: { seed: 2026 },
        });
      }),
      extraCredentialMetadata: altered(r => { Object.assign(r.credentials[0], {
        unknownMetadata: true,
      }); }),
      missingState: altered(r => { delete (r as unknown as Record<string, unknown>).state; }),
      missingTopLevelMatch: altered(r => {
        delete (r as unknown as Record<string, unknown>).matchId;
      }),
      missingCredentialSeat: altered(r => {
        delete (r.credentials[0] as unknown as Record<string, unknown>).playerId;
      }),
      missingCredentialToken: altered(r => {
        delete (r.credentials[0] as unknown as Record<string, unknown>).token;
      }),
      duplicateBearer: altered(r => { r.credentials[1].token = r.credentials[0].token; }),
      duplicateBearerUppercase: altered(r => {
        r.credentials[1].token = r.credentials[0].token.toUpperCase();
      }),
      shortBearer: altered(r => { r.credentials[0].token = "abc"; }),
      longBearer: altered(r => { r.credentials[0].token += "a"; }),
      nonHexBearer: altered(r => { r.credentials[0].token = "z".repeat(64); }),
      nullBearer: altered(r => { r.credentials[0].token = null as unknown as string; }),
      numericBearer: altered(r => { r.credentials[0].token = 42 as unknown as string; }),
      blankBearer: altered(r => { r.credentials[0].token = ""; }),
      nullCredential: altered(r => {
        r.credentials[0] = null as unknown as typeof r.credentials[0];
      }),
      arrayCredential: altered(r => {
        r.credentials[0] = [] as unknown as typeof r.credentials[0];
      }),
      missingCredential: altered(r => { r.credentials.pop(); }),
      extraCredential: altered(r => {
        r.credentials.push({ playerId: "intruder", token: "2".repeat(64) });
      }),
      unknownCredentialSeat: altered(r => { r.credentials[1].playerId = "intruder"; }),
      duplicateCredentialSeat: altered(r => {
        r.credentials[1].playerId = r.credentials[0].playerId;
      }),
      missingPublicSeat: altered(r => { r.state.players.pop(); }),
      extraPublicSeat: altered(r => {
        r.state.players.push({ playerId: "intruder", streetId: "gauss", freeMoveUsed: false });
      }),
      mismatchedMatchId: altered(r => {
        r.matchId = "00000000-0000-0000-0000-000000000021";
      }),
      invalidMatchId: altered(r => { r.matchId = "not-a-match"; }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const out = await page.evaluate(async ({ cases, ids }) => {
      const { hasValidDevelopmentCreatorResponse } =
        await import("/src/features/matches/verifiedDevelopmentCreatorResponse.ts");
      return Object.fromEntries(Object.entries(cases).map(([name, value]) =>
        [name, hasValidDevelopmentCreatorResponse(value, ids)]));
    }, { cases, ids });
    expect(Object.keys(out)).toEqual(Object.keys(cases));
    for (const [name, ok] of Object.entries(out)) expect(ok, name).toBe(false);
    expect(JSON.stringify(cases)).toBe(before);
  });
}

test("#114: missing credential containers and malformed requested seats never bind tokens",
  async ({ page }) => {
  const response = fixture(2);
  await page.goto("/");
  const out = await page.evaluate(async state => {
    const { hasValidDevelopmentCreatorResponse } =
      await import("/src/features/matches/verifiedDevelopmentCreatorResponse.ts");
    const ids = ["alice", "bob"];
    const invalid: unknown[] = [
      null, {}, [], "bad", 42,
      { ...state, credentials: null },
      { ...state, credentials: "bad" },
      { ...state, credentials: {} },
      { ...state, state: null },
    ];
    return {
      malformed: invalid.map(x => hasValidDevelopmentCreatorResponse(x, ids)),
      nullExpected: hasValidDevelopmentCreatorResponse(state, null as unknown as string[]),
      extraExpected: hasValidDevelopmentCreatorResponse(state, [...ids, "intruder"]),
    };
  }, response);
  expect(out.malformed).toHaveLength(9);
  for (const item of out.malformed) expect(item).toBe(false);
  expect(out.nullExpected).toBe(false);
  expect(out.extraExpected).toBe(false);
});
