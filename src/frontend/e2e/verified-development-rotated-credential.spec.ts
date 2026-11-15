import { expect, test } from "@playwright/test";

// #115: Import the real Vite TypeScript guard, not a duplicate test function.
// All test credentials are synthetic, local-only and never persisted.
const seatIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const token = (index: number) => "abcdef01".charAt(index).repeat(64);
const replacement = "a1".repeat(32);

for (const count of [2, 4, 8] as const) {
  test(`#115: valid ${count}-seat rotated credential stays scoped and immutable`,
    async ({ page }) => {
    const held = seatIds.slice(0, count).map((playerId, index) => ({
      playerId, token: token(index),
    }));
    const before = JSON.stringify(held);
    await page.goto("/");
    const result = await page.evaluate(async ({ held, replacement }) => {
      const { hasValidDevelopmentRotatedCredential: valid } =
        await import("/src/features/matches/verifiedDevelopmentRotatedCredential.ts");
      return {
        normal: valid({ playerId: "bob", token: replacement }, "bob", "b".repeat(64), held),
        uppercase: valid({ playerId: "bob", token: replacement.toUpperCase() },
          "bob", "B".repeat(64), held),
        alice: valid({ playerId: "alice", token: replacement }, "alice", "a".repeat(64), held),
        // Joining with a single capability is allowed; creator-owned extra seats are optional.
        joined: valid({ playerId: "bob", token: replacement }, "bob", "b".repeat(64),
          [{ playerId: "bob", token: "b".repeat(64) }]),
      };
    }, { held, replacement });
    expect(result).toEqual({ normal: true, uppercase: true, alice: true, joined: true });
    expect(JSON.stringify(held)).toBe(before);
  });

  test(`#115: forged ${count}-seat rotation cannot reuse another local bearer`,
    async ({ page }) => {
    const held = seatIds.slice(0, count).map((playerId, index) => ({
      playerId, token: token(index),
    }));
    const old = held[1].token;
    const before = JSON.stringify(held);
    await page.goto("/");
    const result = await page.evaluate(async ({ held, old, replacement }) => {
      const { hasValidDevelopmentRotatedCredential: valid } =
        await import("/src/features/matches/verifiedDevelopmentRotatedCredential.ts");
      const reply = { playerId: "bob", token: replacement };
      const altered = (change: (seats: typeof held) => void) => {
        const seats = structuredClone(held);
        change(seats);
        return seats;
      };
      const cases: Record<string, boolean> = {
        duplicateAlice: valid({ ...reply, token: held[0].token }, "bob", old, held),
        duplicateAliceUpper: valid({ ...reply, token: held[0].token.toUpperCase() },
          "bob", old, held),
        sameOld: valid({ ...reply, token: old }, "bob", old, held),
        sameOldUpper: valid({ ...reply, token: old.toUpperCase() }, "bob", old, held),
        badLength: valid({ ...reply, token: "a" }, "bob", old, held),
        tooLong: valid({ ...reply, token: "a".repeat(65) }, "bob", old, held),
        nonHex: valid({ ...reply, token: "g".repeat(64) }, "bob", old, held),
        nullToken: valid({ ...reply, token: null }, "bob", old, held),
        numericToken: valid({ ...reply, token: 42 }, "bob", old, held),
        badActor: valid({ ...reply, playerId: "alice" }, "bob", old, held),
        blankActor: valid(reply, "", old, held),
        wrongOld: valid(reply, "bob", held[0].token, held),
        malformedOld: valid(reply, "bob", "z".repeat(64), held),
        otherHeldDuplicate: valid(reply, "bob", old,
          altered(seats => { seats[1].token = seats[0].token; })),
        otherHeldUpperDuplicate: valid(reply, "bob", old,
          altered(seats => { seats[1].token = seats[0].token.toUpperCase(); })),
        duplicateSeatId: valid(reply, "bob", old,
          altered(seats => { seats[0].playerId = "bob"; })),
        missingActor: valid(reply, "bob", old,
          altered(seats => { seats[1].playerId = "intruder"; })),
        malformedHeldToken: valid(reply, "bob", old,
          altered(seats => { seats[0].token = "bad"; })),
        nullHeld: valid(reply, "bob", old, null as unknown as typeof held),
        nonArrayHeld: valid(reply, "bob", old, {} as unknown as typeof held),
        nullHeldSeat: valid(reply, "bob", old,
          [null, ...held.slice(1)] as unknown as typeof held),
        missingResponse: valid(null, "bob", old, held),
        arrayResponse: valid([], "bob", old, held),
        missingSeatId: valid({ token: replacement }, "bob", old, held),
      };
      return cases;
    }, { held, old, replacement });
    expect(Object.keys(result)).toHaveLength(24);
    for (const [name, accepted] of Object.entries(result)) expect(accepted, name).toBe(false);
    expect(JSON.stringify(held)).toBe(before);
  });
}

test("#115: malformed held credentials and response containers fail closed", async ({ page }) => {
  const held = [{ playerId: "bob", token: "b".repeat(64) }];
  await page.goto("/");
  const result = await page.evaluate(async held => {
    const { hasValidDevelopmentRotatedCredential: valid } =
      await import("/src/features/matches/verifiedDevelopmentRotatedCredential.ts");
    const reply = { playerId: "bob", token: "a1".repeat(32) };
    return [
      valid(reply, "bob", held[0].token, []),
      valid(reply, "bob", held[0].token, Array(9).fill(held[0])),
      valid(reply, "bob", held[0].token, "bad" as unknown as typeof held),
      valid("bad", "bob", held[0].token, held),
      valid(42, "bob", held[0].token, held),
      valid(reply, "bob", held[0].token, [{ playerId: "bob", token: 7 }]),
    ];
  }, held);
  expect(result).toEqual([false, false, false, false, false, false]);
});
