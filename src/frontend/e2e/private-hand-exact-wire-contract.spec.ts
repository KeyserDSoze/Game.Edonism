import { expect, test } from "@playwright/test";

// #166: exercise the actual Vite source, not a duplicate validation function.
// A self-consistent forged HTTP 200 with an extra secret must never be stored.
for (const seatCount of [2, 4, 8] as const) {
  test("#166: " + seatCount + " seats reject secret/unknown private-hand fields",
    async ({ page }) => {
      await page.goto("/");
      const results = await page.evaluate(async count => {
        const { hasValidDevelopmentFirstRoundHand: valid } = await import(
          "/src/features/matches/verifiedDevelopmentFirstRoundHand.ts");
        const matchId = "private-first-round-166";
        const players = ["Renée", "王小明", "System", "🙂", "a", "b", "c", "d"]
          .slice(0, count);
        const hands = players.map((playerId, i) => ({
          matchId, playerId,
          cardIds: Array.from({ length: 4 }, (_, j) => "opaque:" + i + ":" + j),
        }));
        const own = hands.at(-1)!;
        const tryHand = (candidate: unknown, actor = own.playerId) =>
          valid(candidate, matchId, actor);
        const secretExtras = [
          { remainingDrawPile: ["hidden:deck"] },
          { electionDayCardId: "private:special" },
          { otherPlayerCardIds: ["hidden:rival"] },
          { privateHands: [{ playerId: players[0], cardIds: ["secret"] }] },
          { token: "top-secret" },
          { credentials: [{ token: "top-secret" }] },
          { privateDeal: { seed: 1234 } },
          { unknownMetadata: true },
        ];
        const forged = secretExtras.map(extra => ({ ...own, ...extra }));
        const malformed = [
          { ...own, cardIds: ["a", "b", "c"] },
          { ...own, cardIds: ["a", "a", "b", "c"] },
          { ...own, cardIds: ["a", "b", " ", "c"] },
          { ...own, cardIds: null },
          { ...own, playerId: "another" },
          { ...own, matchId: "other" },
          { playerId: own.playerId, cardIds: own.cardIds },
          { matchId: own.matchId, cardIds: own.cardIds },
          { matchId: own.matchId, playerId: own.playerId },
        ];
        const invalidActors: unknown[] = [
          "system", " ", " Renée", "Renée ", "alice\u202Eevil",
          "alice\u200B", "\uD800", "\uDC00", "A".repeat(65),
          "🙂".repeat(33), null, 123,
        ];
        const before = JSON.stringify({ hands, forged, malformed, invalidActors });
        const result = {
          accepted: hands.map(hand => valid(hand, matchId, hand.playerId)),
          extras: forged.map(hand => tryHand(hand)),
          malformed: malformed.map(hand => tryHand(hand)),
          badActor: invalidActors.map(actor => valid(
            { ...own, playerId: actor }, matchId, actor as string)),
          wrongSeat: valid(hands[0], matchId, own.playerId),
          wrongMatch: valid(own, "other", own.playerId),
        };
        return {
          ...result,
          unchanged: before === JSON.stringify({ hands, forged, malformed, invalidActors }),
        };
      }, seatCount);
      expect(results.accepted).toEqual(Array(seatCount).fill(true));
      expect(results.extras).toEqual(Array(8).fill(false));
      expect(results.malformed).toEqual(Array(9).fill(false));
      expect(results.badActor).toEqual(Array(12).fill(false));
      // For two or more players the first and last owners differ.
      expect(results.wrongSeat).toBe(false);
      expect(results.wrongMatch).toBe(false);
      expect(results.unchanged).toBe(true);
    });
}
