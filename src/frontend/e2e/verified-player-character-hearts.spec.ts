import { expect, test } from "@playwright/test";

// #137: import the ACTUAL TypeScript helper from Vite in Chromium. Printed
// public character hearts are read-only, not a client damage/attack engine.
const playerIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

for (const count of [2, 4, 8] as const) {
  test(`#137: verified ${count}-seat public hearts preserve printed values and hide invalid/mixed rosters`,
    async ({ page }) => {
      const seats = playerIds.slice(0, count).map((playerId, index) => ({
        playerId, streetId: index % 2 ? "einstein" : "gauss",
        hearts: 1 + (index % 5),
      }));
      const changed = (mutate: (entries: typeof seats) => void) => {
        const copy = structuredClone(seats);
        mutate(copy);
        return copy;
      };
      const legacy = seats.map(s => ({ ...s, hearts: null as number | null }));
      const invalid = {
        missing: seats.map((s, i) => i === 0
          ? { playerId: s.playerId, streetId: s.streetId } : s),
        zero: changed(s => { s[0].hearts = 0; }),
        negative: changed(s => { s[0].hearts = -1; }),
        fractional: changed(s => { s[0].hearts = 2.5; }),
        abovePrintedMax: changed(s => { s[0].hearts = 6; }),
        notNumber: changed(s => { s[0].hearts = "3" as unknown as number; }),
        boolean: changed(s => { s[0].hearts = true as unknown as number; }),
        duplicateId: changed(s => { s[count - 1].playerId = "alice"; }),
        foreignStreet: changed(s => { s[0].streetId = "foreign-street"; }),
        nullRecord: seats.map((s, i) => i === 0 ? null : s),
        systemActor: changed(s => { s[0].playerId = "system"; }),
        trailingSpace: changed(s => { s[0].playerId = "alice "; }),
        unsafeUnicode: changed(s => { s[0].playerId = "alice\u202e"; }),
        mixedLegacy: seats.map((s, i) => i === 0
          ? { ...s, hearts: null } : s),
        allMissing: seats.map(s => ({ playerId: s.playerId, streetId: s.streetId })),
        nullContainer: null,
        tooSmall: seats.slice(0, 1),
      };
      const initialJson = JSON.stringify({ seats, legacy, invalid });
      await page.goto("/");
      const result = await page.evaluate(async ({ seats, legacy, invalid }) => {
        const { verifiedPublicCharacterHearts: guard } =
          await import("/src/features/city/playerCharacterHearts.ts");
        return {
          valid: [...guard(seats)],
          allLegacy: guard(legacy).size,
          invalid: Object.entries(invalid).map(([key, value]) => [key, guard(value).size]),
          blank: guard(undefined).size,
        };
      }, { seats, legacy, invalid });
      expect(result.valid).toEqual(seats.map(s => [s.playerId, s.hearts]));
      expect(result.allLegacy).toBe(0);
      expect(result.invalid).toEqual(Object.keys(invalid).map(key => [key, 0]));
      expect(result.blank).toBe(0);
      expect(JSON.stringify({ seats, legacy, invalid })).toBe(initialJson);
    });
}
