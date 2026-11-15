import { expect, test } from "@playwright/test";

// The real TS module imports the versioned board JSON through Vite, never via Node.
const slots = ["N-01", "S-01", "W-01", "E-01",
  "B-01", "M-01", "N-02", "N-03"];
function fixture(count: 2 | 4 | 8) {
  return { boardActivities: slots.slice(0, count).map((slotId, i) => ({
    slotId, cardId: `demo:activity:${i}`, category: "culture",
  })) };
}

for (const count of [2, 4, 8] as const) {
  test(`#111: valid ${count}-seat canonical board card count is stable and read-only`,
    async ({ page }) => {
    const state = fixture(count);
    const before = JSON.stringify(state);
    await page.goto("/");
    const verified = await page.evaluate(async snapshot => {
      const { verifiedPublicBoardCardCount } =
        await import("/src/features/city/activityMarkers.ts");
      return verifiedPublicBoardCardCount(snapshot);
    }, state);
    expect(verified).toBe(count);
    expect(JSON.stringify(state)).toBe(before);
  });

  test(`#111: forged ${count}-seat board card lists cannot create a plausible public count`,
    async ({ page }) => {
    const state = fixture(count);
    const modify = (edit: (s: ReturnType<typeof fixture>) => void) => {
      const copy = structuredClone(state);
      edit(copy);
      return copy;
    };
    const cases = {
      duplicateSlot: modify(s => s.boardActivities.push({ ...s.boardActivities[0] })),
      unknownSlot: modify(s => { s.boardActivities[0].slotId = "unmapped-slot"; }),
      numericSlot: modify(s => { s.boardActivities[0].slotId = 42 as unknown as string; }),
      emptySlot: modify(s => { s.boardActivities[0].slotId = ""; }),
      missingCardId: modify(s => { s.boardActivities[0].cardId = ""; }),
      numericCardId: modify(s => { s.boardActivities[0].cardId = 42 as unknown as string; }),
      nullCardId: modify(s => {
        s.boardActivities[0].cardId = null as unknown as string;
      }),
      numericCategory: modify(s => {
        s.boardActivities[0].category = 3 as unknown as string;
      }),
      blankCategory: modify(s => { s.boardActivities[0].category = "  "; }),
      nullRecord: modify(s => {
        s.boardActivities[0] = null as unknown as typeof s.boardActivities[0];
      }),
      arrayRecord: modify(s => {
        s.boardActivities[0] = [] as unknown as typeof s.boardActivities[0];
      }),
    };
    const before = JSON.stringify(cases);
    await page.goto("/");
    const results = await page.evaluate(async inputs => {
      const { verifiedPublicBoardCardCount } =
        await import("/src/features/city/activityMarkers.ts");
      return Object.fromEntries(Object.entries(inputs)
        .map(([name, snapshot]) => [name, verifiedPublicBoardCardCount(snapshot)]));
    }, cases);
    expect(Object.keys(results)).toEqual(Object.keys(cases));
    for (const [name, countResult] of Object.entries(results))
      expect(countResult, name).toBeNull();
    expect(JSON.stringify(cases)).toBe(before);
  });
}

test("#111: null, non-array and valid empty public card lists stay distinct", async ({ page }) => {
  const valid = fixture(2);
  await page.goto("/");
  const result = await page.evaluate(async snapshot => {
    const { verifiedPublicBoardCardCount } =
      await import("/src/features/city/activityMarkers.ts");
    const badStates: unknown[] = [
      null, undefined, {}, [], "fake",
      { boardActivities: null },
      { boardActivities: {} },
      { boardActivities: "fake" },
      { boardActivities: [null] },
      { boardActivities: [42] },
      { boardActivities: [{ slotId: "N-01", cardId: null, category: "culture" }] },
    ];
    return {
      malformed: badStates.map(s => verifiedPublicBoardCardCount(
        s as typeof snapshot)),
      empty: verifiedPublicBoardCardCount({ boardActivities: [] }),
      valid: verifiedPublicBoardCardCount(snapshot),
    };
  }, valid);
  expect(result.malformed).toHaveLength(11);
  for (const item of result.malformed) expect(item).toBeNull();
  expect(result.empty).toBe(0);
  expect(result.valid).toBe(2);
});
