import { expect, test } from "@playwright/test";

// #118: Playwright imports the actual Vite TypeScript helper, never a copy.
// These are synthetic Development full-deck first-round cards only.
const seatIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

const hands = (count: 2 | 4 | 8) => seatIds.slice(0, count)
  .map((playerId, index) => ({
    matchId: "private-first-round-fixture",
    playerId,
    cardIds: Array.from({ length: 4 }, (_, card) =>
      `demo:action:${String(4 * index + card + 1).padStart(2, "0")}`),
  }));

for (const count of [2, 4, 8] as const) {
  test(`#118: valid ${count}-seat distinct private hands preserve actor binding`,
    async ({ page }) => {
    const input = hands(count);
    const before = JSON.stringify(input);
    await page.goto("/");
    const result = await page.evaluate(async input => {
      const { hasValidDevelopmentFirstRoundHand: valid } =
        await import("/src/features/matches/verifiedDevelopmentFirstRoundHand.ts");
      return {
        valid: input.map(hand => valid(hand, hand.matchId, hand.playerId)),
        wrongMatch: valid(input[0], "another-match", input[0].playerId),
        wrongActor: valid(input[0], input[0].matchId, input[1].playerId),
        alternateSeat: valid(input.at(-1), input[0].matchId, input[0].playerId),
      };
    }, input);
    expect(result.valid).toEqual(Array(count).fill(true));
    expect([result.wrongMatch, result.wrongActor, result.alternateSeat])
      .toEqual([false, false, false]);
    expect(JSON.stringify(input)).toBe(before);
  });

  test(`#118: ${count}-seat forged hand duplicates and malformed cards fail closed`,
    async ({ page }) => {
    const original = hands(count)[0];
    const mutated = (change: (hand: typeof original) => void) => {
      const candidate = structuredClone(original);
      change(candidate);
      return candidate;
    };
    const invalid = {
      missingCard: mutated(h => { h.cardIds.pop(); }),
      excessCard: mutated(h => { h.cardIds.push("demo:action:other"); }),
      emptyHand: mutated(h => { h.cardIds = []; }),
      duplicatedCard: mutated(h => { h.cardIds[1] = h.cardIds[0]; }),
      duplicatedLast: mutated(h => { h.cardIds[3] = h.cardIds[2]; }),
      blankCard: mutated(h => { h.cardIds[0] = ""; }),
      whitespaceCard: mutated(h => { h.cardIds[0] = " \t "; }),
      nullCard: mutated(h => { h.cardIds[2] = null as unknown as string; }),
      numericCard: mutated(h => { h.cardIds[1] = 123 as unknown as string; }),
      arrayCard: mutated(h => { h.cardIds[1] = [] as unknown as string; }),
      nullCards: mutated(h => { h.cardIds = null as unknown as string[]; }),
      objectCards: mutated(h => { h.cardIds = {} as unknown as string[]; }),
      stringCards: mutated(h => { h.cardIds = "demo:action:01" as unknown as string[]; }),
      nullActor: mutated(h => { h.playerId = null as unknown as string; }),
      wrongActor: mutated(h => { h.playerId = "bob"; }),
      blankActor: mutated(h => { h.playerId = ""; }),
      wrongMatch: mutated(h => { h.matchId = "another-match"; }),
      nullMatch: mutated(h => { h.matchId = null as unknown as string; }),
    };
    const before = JSON.stringify(invalid);
    await page.goto("/");
    const outcomes = await page.evaluate(async invalid => {
      const { hasValidDevelopmentFirstRoundHand: valid } =
        await import("/src/features/matches/verifiedDevelopmentFirstRoundHand.ts");
      return Object.fromEntries(Object.entries(invalid)
        .map(([name, hand]) => [name, valid(hand,
          "private-first-round-fixture", "alice")]));
    }, invalid);
    expect(Object.keys(outcomes)).toEqual(Object.keys(invalid));
    for (const [label, allowed] of Object.entries(outcomes))
      expect(allowed, label).toBe(false);
    expect(JSON.stringify(invalid)).toBe(before);
  });
}

test("#118: primitive/missing hand containers or blank actor/match never bind", async ({ page }) => {
  const validHand = hands(2)[0];
  await page.goto("/");
  const result = await page.evaluate(async hand => {
    const { hasValidDevelopmentFirstRoundHand: valid } =
      await import("/src/features/matches/verifiedDevelopmentFirstRoundHand.ts");
    return [
      ...[null, undefined, 0, false, "", [], {}]
        .map(bad => valid(bad, hand.matchId, hand.playerId)),
      valid(hand, "", hand.playerId),
      valid(hand, hand.matchId, " "),
      valid(hand, null as unknown as string, hand.playerId),
      valid(hand, hand.matchId, null as unknown as string),
    ];
  }, validHand);
  expect(result).toEqual(Array(11).fill(false));
});
