import { expect, test } from "@playwright/test";

// #137/#141: Chromium imports the ACTUAL Vite TypeScript helper. Verify
// public character provenance, not a test-only JS calculation or combat.
const players = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

for (const count of [2, 4, 8] as const) {
  test(`#141: ${count}-seat printed hearts agree with all assigned public characters`,
    async ({ page }) => {
      const roster = players.slice(0, count).map((playerId, i) => ({
        playerId, streetId: i % 2 ? "einstein" : "gauss",
        hearts: 1 + i % 5,
      }));
      const assignedCharacters = roster.map((p, i) => ({
        playerId: p.playerId,
        characterId: `synthetic-character:${i + 1}`,
        startingActivityCardId: `synthetic-activity:${i + 1}`,
        printedInitialHearts: p.hearts,
      }));
      const valid = { players: roster, assignedCharacters };
      const legacy = {
        players: roster.map(p => ({ ...p, hearts: null as number | null })),
        assignedCharacters: [],
      };
      const tamper = (edit: (data: typeof valid) => void): typeof valid => {
        const result = structuredClone(valid);
        edit(result);
        return result;
      };
      const bad: Record<string, unknown> = {
        missingPair: tamper(s => { s.assignedCharacters.pop(); }),
        foreignActor: tamper(s => { s.assignedCharacters[0].playerId = "intruder"; }),
        duplicateSeat: tamper(s => {
          s.assignedCharacters[1].playerId = "alice";
        }),
        duplicateCharacter: tamper(s => {
          s.assignedCharacters[1].characterId = s.assignedCharacters[0].characterId;
        }),
        duplicateStartingActivity: tamper(s => {
          s.assignedCharacters[1].startingActivityCardId =
            s.assignedCharacters[0].startingActivityCardId;
        }),
        emptyCharacter: tamper(s => {
          s.assignedCharacters[0].characterId = "";
        }),
        emptyStartingActivity: tamper(s => {
          s.assignedCharacters[0].startingActivityCardId = "";
        }),
        forgedPrintedHearts: tamper(s => {
          s.assignedCharacters[0].printedInitialHearts = 5 + s.players[0].hearts;
        }),
        plausibleMismatch: tamper(s => {
          s.assignedCharacters[0].printedInitialHearts =
            s.players[0].hearts === 5 ? 4 : s.players[0].hearts + 1;
        }),
        forgedPublicHearts: tamper(s => {
          s.players[0].hearts = 5 + s.assignedCharacters[0].printedInitialHearts;
        }),
        partialNull: tamper(s => {
          s.players[0].hearts = null as unknown as number;
        }),
        missingHearts: tamper(s => {
          s.players[0].hearts = undefined as unknown as number;
        }),
        fractionalHearts: tamper(s => { s.players[0].hearts = 2.5; }),
        zeroHearts: tamper(s => { s.players[0].hearts = 0; }),
        negativeHearts: tamper(s => { s.players[0].hearts = -1; }),
        abovePrintedMax: tamper(s => { s.players[0].hearts = 6; }),
        booleanHearts: tamper(s => {
          s.players[0].hearts = true as unknown as number;
        }),
        nonNumericHearts: tamper(s => {
          s.players[0].hearts = "3" as unknown as number;
        }),
        mixedLegacy: tamper(s => {
          s.players[0].hearts = null as unknown as number;
          s.assignedCharacters.pop();
        }),
        nullPlayer: tamper(s => {
          s.players[0] = null as unknown as typeof s.players[0];
        }),
        duplicatePlayer: tamper(s => { s.players[1].playerId = "alice"; }),
        reservedSeat: tamper(s => { s.players[0].playerId = "system"; }),
        trailingSpaceSeat: tamper(s => { s.players[0].playerId = "alice "; }),
        unicodeBidiSeat: tamper(s => { s.players[0].playerId = "alice\\u202e"; }),
        foreignStreet: tamper(s => { s.players[0].streetId = "fake-road"; }),
        tooSmall: { players: roster.slice(0, 1), assignedCharacters: assignedCharacters.slice(0, 1) },
        missingAssignments: { players: roster },
        missingPlayers: { assignedCharacters },
        wrongContainer: [],
        nullContainer: null,
      };
      const unchanged = JSON.stringify({ valid, legacy, bad });
      await page.goto("/");
      const result = await page.evaluate(async ({ valid, legacy, bad }) => {
        const { verifiedPublicCharacterHearts: guard } =
          await import("/src/features/city/playerCharacterHearts.ts");
        return {
          valid: [...guard(valid)],
          legacy: guard(legacy).size,
          bad: Object.entries(bad).map(([name, input]) => [name, guard(input).size]),
          noInput: guard(undefined).size,
        };
      }, { valid, legacy, bad });
      expect(result.valid).toEqual(roster.map(p => [p.playerId, p.hearts]));
      expect(result.legacy).toBe(0);
      expect(result.bad).toEqual(Object.keys(bad).map(name => [name, 0]));
      expect(result.noInput).toBe(0);
      expect(JSON.stringify({ valid, legacy, bad })).toBe(unchanged);
    });
}
