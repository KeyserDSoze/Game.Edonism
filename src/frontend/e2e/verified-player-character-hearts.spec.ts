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
        unicodeBidiSeat: tamper(s => { s.players[0].playerId = "alice" + String.fromCodePoint(0x202e); }),
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


// #145: the real 30-card public board must prove not only printed hearts
// but also the physical starting card in EACH player's own origin slot.
// Import the actual browser helper from Vite; do not reimplement its rules.
const fullBoardSlots145 = [
  ...Array.from({ length: 8 }, (_, i) => "N-" + String(i + 1).padStart(2, "0")),
  ...Array.from({ length: 8 }, (_, i) => "S-" + String(i + 1).padStart(2, "0")),
  ...Array.from({ length: 3 }, (_, i) => "W-" + String(i + 1).padStart(2, "0")),
  ...Array.from({ length: 3 }, (_, i) => "E-" + String(i + 1).padStart(2, "0")),
  ...Array.from({ length: 4 }, (_, i) => "B-" + String(i + 1).padStart(2, "0")),
  ...Array.from({ length: 4 }, (_, i) => "M-" + String(i + 1).padStart(2, "0")),
];

for (const count of [2, 4, 8] as const) {
  test("#145: " + count + "-seat full-board character origins are card/slot bound",
    async ({ page }) => {
      const roster = players.slice(0, count).map((playerId, i) => ({
        playerId, streetId: i % 2 ? "einstein" : "gauss",
        startingSlotId: fullBoardSlots145[i], hearts: (i % 5) + 1,
      }));
      const genuine = {
        players: roster,
        boardActivities: fullBoardSlots145.map(slotId => ({
          slotId, cardId: "synthetic:activity:" + slotId, category: "culture",
        })),
        assignedCharacters: roster.map((p, i) => ({
          playerId: p.playerId, characterId: "synthetic:character:" + i,
          startingActivityCardId: "synthetic:activity:" + p.startingSlotId,
          printedInitialHearts: p.hearts,
        })),
      };
      const edit = (fn: (s: typeof genuine) => void) => {
        const s = structuredClone(genuine);
        fn(s);
        return s;
      };
      const unknownOtherCategory = edit(s => {
        s.boardActivities[29].category = "unrelated-forgery";
      });
      const forged = {
        foreignCard: edit(s => {
          s.assignedCharacters[0].startingActivityCardId =
            "synthetic:activity:M-04";
        }),
        nonexistentCard: edit(s => {
          s.assignedCharacters[0].startingActivityCardId = "synthetic:missing";
        }),
        cardIdCasing: edit(s => {
          s.assignedCharacters[0].startingActivityCardId =
            "Synthetic:activity:N-01";
        }),
        swappedCards: edit(s => {
          const a = s.assignedCharacters[0].startingActivityCardId;
          s.assignedCharacters[0].startingActivityCardId =
            s.assignedCharacters[1].startingActivityCardId;
          s.assignedCharacters[1].startingActivityCardId = a;
        }),
        forgedOriginSlot: edit(s => {
          s.players[0].startingSlotId = "M-04";
        }),
        unknownOriginSlot: edit(s => {
          s.players[0].startingSlotId = "unknown-slot";
        }),
        misplacedOriginalCard: edit(s => {
          s.boardActivities[0].slotId = "unknown-slot";
        }),
        duplicateOriginalCard: edit(s => {
          s.boardActivities[29].cardId = s.boardActivities[0].cardId;
        }),
        duplicateOriginSlot: edit(s => {
          s.boardActivities[29].slotId = s.boardActivities[0].slotId;
        }),
        missingOriginCard: edit(s => {
          s.boardActivities[0].cardId = "synthetic:replacement";
        }),
      };
      const partialFixture = edit(s => {
        s.boardActivities.pop();
        // Partial synthetic Development fixtures still use #141 validation.
        s.assignedCharacters[0].startingActivityCardId = "legacy:unbound-card";
      });
      const legacy = {
        players: roster.map(p => ({ ...p, hearts: null as number | null })),
        assignedCharacters: [],
        boardActivities: genuine.boardActivities,
      };
      const immutable = JSON.stringify({
        genuine, unknownOtherCategory, forged, partialFixture, legacy,
      });
      await page.goto("/");
      const observed = await page.evaluate(async data => {
        const { verifiedPublicCharacterHearts: verify } =
          await import("/src/features/city/playerCharacterHearts.ts");
        return {
          genuine: [...verify(data.genuine)],
          independent: [...verify(data.unknownOtherCategory)],
          forged: Object.entries(data.forged)
            .map(([name, state]) => [name, verify(state).size]),
          partial: [...verify(data.partialFixture)],
          legacy: verify(data.legacy).size,
        };
      }, { genuine, unknownOtherCategory, forged, partialFixture, legacy });
      const expected = roster.map(p => [p.playerId, p.hearts]);
      expect(observed.genuine).toEqual(expected);
      expect(observed.independent).toEqual(expected);
      expect(observed.forged)
        .toEqual(Object.keys(forged).map(name => [name, 0]));
      expect(observed.partial).toEqual(expected);
      expect(observed.legacy).toBe(0);
      expect(JSON.stringify({
        genuine, unknownOtherCategory, forged, partialFixture, legacy,
      })).toBe(immutable);
    });
}


// #146: PvP scouting may show ONLY the public character/origin technical
// IDs after #141/#145 has established complete, genuine provenance.
// A synthetic private hand/token field must never be copied into the UI.
for (const count of [2, 4, 8] as const) {
  test("#146: " + count + "-seat verified public card identities never leak private fields",
    async ({ page }) => {
      const roster = players.slice(0, count).map((playerId, i) => ({
        playerId, streetId: i % 2 ? "einstein" : "gauss",
        startingSlotId: fullBoardSlots145[i], hearts: i % 5 + 1,
      }));
      const genuine = {
        players: roster,
        boardActivities: fullBoardSlots145.map(slotId => ({
          slotId, cardId: "synthetic:origin:" + slotId, category: "culture",
        })),
        assignedCharacters: roster.map((p, i) => ({
          playerId: p.playerId, characterId: "public:character:" + i,
          startingActivityCardId: "synthetic:origin:" + p.startingSlotId,
          printedInitialHearts: p.hearts,
        })),
        privateHand: { token: "NEVER_EXPOSE_TOKEN", cards: ["NEVER_EXPOSE_HAND"] },
      };
      const tamper = (edit: (s: typeof genuine) => void) => {
        const s = structuredClone(genuine);
        edit(s);
        return s;
      };
      const forged = {
        swappedOrigin: tamper(s => {
          const id = s.assignedCharacters[0].startingActivityCardId;
          s.assignedCharacters[0].startingActivityCardId =
            s.assignedCharacters[1].startingActivityCardId;
          s.assignedCharacters[1].startingActivityCardId = id;
        }),
        missingCharacter: tamper(s => { s.assignedCharacters.pop(); }),
        duplicatedCharacter: tamper(s => {
          s.assignedCharacters[1].characterId = s.assignedCharacters[0].characterId;
        }),
        forgedHearts: tamper(s => { s.assignedCharacters[0].printedInitialHearts = 99; }),
        wrongOrigin: tamper(s => { s.players[0].startingSlotId = "M-04"; }),
        reservedSeat: tamper(s => { s.players[0].playerId = "system"; }),
        duplicatePlayerId: tamper(s => { s.players[1].playerId = "alice"; }),
      };
      const partial = tamper(s => {
        s.boardActivities.pop();
        // The #141 partial Development fixture remains valid.
        s.assignedCharacters[0].startingActivityCardId = "synthetic:partial";
      });
      const legacy = tamper(s => {
        s.assignedCharacters = [];
        s.players.forEach(p => { p.hearts = null as unknown as number; });
      });
      const immutable = JSON.stringify({ genuine, forged, partial, legacy });
      await page.goto("/");
      const result = await page.evaluate(async data => {
        const { verifiedPublicCharacterRoster: verify } =
          await import("/src/features/city/playerCharacterHearts.ts");
        return {
          good: [...verify(data.genuine)],
          forged: Object.entries(data.forged)
            .map(([name, input]) => [name, verify(input).size]),
          partial: [...verify(data.partial)],
          legacy: verify(data.legacy).size,
          noInput: verify(null).size,
        };
      }, { genuine, forged, partial, legacy });
      const expected = genuine.assignedCharacters.map(a => [
        a.playerId, {
          characterId: a.characterId,
          startingActivityCardId: a.startingActivityCardId,
          printedInitialHearts: a.printedInitialHearts,
        },
      ]);
      expect(result.good).toEqual(expected);
      expect(result.forged).toEqual(Object.keys(forged).map(name => [name, 0]));
      expect(result.partial).toEqual(genuine.assignedCharacters.map((a, i) => [
        a.playerId, {
          characterId: a.characterId,
          startingActivityCardId: i === 0 ? "synthetic:partial" : a.startingActivityCardId,
          printedInitialHearts: a.printedInitialHearts,
        },
      ]));
      expect(result.legacy).toBe(0);
      expect(result.noInput).toBe(0);
      expect(JSON.stringify(result)).not.toMatch(/NEVER_EXPOSE/);
      expect(JSON.stringify({ genuine, forged, partial, legacy })).toBe(immutable);
    });
}
