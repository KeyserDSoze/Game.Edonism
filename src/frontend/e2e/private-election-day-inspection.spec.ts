import { expect, test } from "@playwright/test";

// #164: execute the real Vite-transformed TypeScript guard, rather than a
// duplicate Node test implementation. Typed index is OWN-hand only and
// cannot classify a legacy v1 checkpoint by guessing from opaque card IDs.
for (const seats of [2, 4, 8] as const) {
  test(`#164: actual Vite own-election-day guard accepts only typed actor scope (${seats} seats)`,
    async ({ page }) => {
    await page.goto("/");
    const cases = await page.evaluate(async count => {
      const { hasVerifiedOwnElectionDayInspection: valid } = await import(
        "/src/features/matches/verifiedOwnElectionDayInspection.ts");
      const matchId = "00000000-0000-0000-0000-000000000164";
      const actor = `player-${count - 1}`;
      const hand = {
        matchId, playerId: actor,
        cardIds: ["opaque:a", "opaque:b", "opaque:c", "opaque:d"],
      };
      const revision = 7;
      const canonical = {
        matchId, playerId: actor, verifiedRevision: revision,
        classificationAvailable: true, ownHandIndex: 2,
      };
      const changed = (change: (p: typeof canonical) => void) => {
        const copy = structuredClone(canonical);
        change(copy);
        return valid(copy, matchId, actor, revision, hand);
      };
      return {
        valid: valid(canonical, matchId, actor, revision, hand),
        absentFromOwnHand: valid({ ...canonical, ownHandIndex: null },
          matchId, actor, revision, hand),
        legacyUnknown: valid({
          ...canonical, classificationAvailable: false, ownHandIndex: null,
        }, matchId, actor, revision, hand),
        invalidLegacyIndex: valid({
          ...canonical, classificationAvailable: false,
        }, matchId, actor, revision, hand),
        foreignActor: changed(x => { x.playerId = "other"; }),
        staleRevision: changed(x => { x.verifiedRevision = 6; }),
        futureRevision: changed(x => { x.verifiedRevision = 8; }),
        foreignMatch: changed(x => { x.matchId = "other"; }),
        negativeIndex: changed(x => { x.ownHandIndex = -1; }),
        outOfHand: changed(x => { x.ownHandIndex = 4; }),
        nonIntegerIndex: changed(x => { x.ownHandIndex = 1.5; }),
        unknownFlag: valid({
          ...canonical, classificationAvailable: "true",
        }, matchId, actor, revision, hand),
        markerLeak: valid({
          ...canonical, electionDayCardId: "secret:unexposed",
        }, matchId, actor, revision, hand),
        otherHandLeak: valid({
          ...canonical, otherPlayerCardIds: ["secret:other"],
        }, matchId, actor, revision, hand),
        missingStatus: valid(null, matchId, actor, revision, hand),
        missingHand: valid(canonical, matchId, actor, revision, null),
        switchedHand: valid(canonical, matchId, actor, revision,
          { ...hand, playerId: "other" }),
        corruptedHand: valid(canonical, matchId, actor, revision,
          { ...hand, cardIds: ["opaque:a", "opaque:a", "opaque:c", "opaque:d"] }),
      };
    }, seats);
    expect(cases.valid).toBe(true);
    expect(cases.absentFromOwnHand).toBe(true);
    expect(cases.legacyUnknown).toBe(true);
    for (const [key, result] of Object.entries(cases))
      if (!["valid", "absentFromOwnHand", "legacyUnknown"].includes(key))
        expect(result, key).toBe(false);
  });
}
