import { expect, test } from "@playwright/test";

// #176: exercise the REAL Vite settlement guard, never a copied test version.
// These 0/1/2 quotes are read-only and DO NOT pay wages, pick a mayor tax
// or advance a round, even if the browser receives an authorized HTTP 200.
const actorIds = [
  "Renée", "王小明", "System", "🙂", "alpha", "bravo", "charlie", "delta",
];

function pendingFixture(seats: 2 | 4 | 8) {
  const ids = actorIds.slice(0, seats);
  const gross = ids.map(playerId => ({
    playerId, baseAtoms: 2, standingActivityAtoms: 1, grossAtoms: 3,
  }));
  const state = {
    matchId: "settlement-176",
    round: 1, revision: seats, phase: 1,
    players: ids.map(playerId => ({ playerId })),
    proposedNextRoundOrder: [ids[ids.length - 1], ...ids.slice(0, -1)],
    grossSalaryQuotes: gross,
  };
  const preview = {
    matchId: state.matchId,
    round: state.round,
    verifiedRevision: state.revision,
    nextTurnOrder: [...state.proposedNextRoundOrder],
    grossSalaryQuotes: structuredClone(gross),
    hypotheticalTaxScenarios: [0, 1, 2].map(tax => ({
      hypotheticalTaxAtomsPerPlayer: tax,
      potentialWithheldAtoms: tax * seats,
      players: ids.map(playerId => ({
        playerId, grossAtoms: 3, hypotheticalTaxAtoms: tax,
        hypotheticalNetAtoms: 3 - tax,
      })),
    })),
  };
  return { state, preview };
}

for (const seats of [2, 4, 8] as const) {
  test(`#176: exact 6/4/3/4 settlement wire is public and purely hypothetical for ${seats} seats`,
    async ({ page }) => {
      const { state, preview } = pendingFixture(seats);
      const reordered = {
        hypotheticalTaxScenarios: preview.hypotheticalTaxScenarios.map(s => ({
          players: s.players.map(row => ({
            playerId: row.playerId,
            hypotheticalNetAtoms: row.hypotheticalNetAtoms,
            grossAtoms: row.grossAtoms,
            hypotheticalTaxAtoms: row.hypotheticalTaxAtoms,
          })),
          potentialWithheldAtoms: s.potentialWithheldAtoms,
          hypotheticalTaxAtomsPerPlayer: s.hypotheticalTaxAtomsPerPlayer,
        })),
        grossSalaryQuotes: preview.grossSalaryQuotes.map(q => ({
          standingActivityAtoms: q.standingActivityAtoms,
          playerId: q.playerId, grossAtoms: q.grossAtoms,
          baseAtoms: q.baseAtoms,
        })),
        nextTurnOrder: preview.nextTurnOrder,
        verifiedRevision: preview.verifiedRevision,
        round: preview.round, matchId: preview.matchId,
      };
      const before = JSON.stringify({ state, preview, reordered });
      await page.goto("/");
      const result = await page.evaluate(async ({ state, preview, reordered }) => {
        const { hasVerifiedDevelopmentPendingSettlementPreview: valid } =
          await import("/src/features/matches/verifiedDevelopmentPendingSettlementPreview.ts");
        return {
          canonical: valid(preview, state),
          keyInsertionOrder: valid(reordered, state),
          nullPreview: valid(null, state),
          nullState: valid(preview, null),
          preSettlement: valid(preview, { ...state, phase: 0 }),
          staleRevision: valid(preview, { ...state, revision: state.revision + 1 }),
        };
      }, { state, preview, reordered });
      expect(result).toEqual({
        canonical: true, keyInsertionOrder: true,
        nullPreview: false, nullState: false,
        preSettlement: false, staleRevision: false,
      });
      expect(JSON.stringify({ state, preview, reordered })).toBe(before);
    });

  test(`#176: forged root, quote, scenario or one seat row invalidates ${seats}-seat preview`,
    async ({ page }) => {
      const { state, preview } = pendingFixture(seats);
      const change = (edit: (p: typeof preview) => void): typeof preview => {
        const copy = structuredClone(preview);
        edit(copy);
        return copy;
      };
      const bad: Record<string, unknown> = {
        extraRootSelectedTax: { ...preview, selectedMayorTaxAtoms: 2 },
        extraRootOtherToken: { ...preview, otherPlayerTokens: ["HIDDEN"] },
        extraRootFutureTaxCommand: { ...preview, applyMayorTax: false },
        extraRootNullMetadata: { ...preview, metadata: null },
        extraGrossPrivate: change(p => {
          Object.assign(p.grossSalaryQuotes[0], { privateHand: ["HIDDEN"] });
        }),
        extraLastGrossWallet: change(p => {
          Object.assign(p.grossSalaryQuotes[seats - 1], { walletCredit: 0 });
        }),
        extraScenarioSecret: change(p => {
          Object.assign(p.hypotheticalTaxScenarios[0], { secret: "HIDDEN" });
        }),
        extraScenarioNull: change(p => {
          Object.assign(p.hypotheticalTaxScenarios[1], { metadata: null });
        }),
        extraScenarioFalseFuture: change(p => {
          Object.assign(p.hypotheticalTaxScenarios[2], { applied: false });
        }),
        extraFirstRowCard: change(p => {
          Object.assign(p.hypotheticalTaxScenarios[0].players[0],
            { privateCards: ["HIDDEN"] });
        }),
        extraLastRowNetApplied: change(p => {
          Object.assign(p.hypotheticalTaxScenarios[2].players[seats - 1],
            { hasPaid: false });
        }),
        missingRootOrder: change(p => {
          delete (p as unknown as Record<string, unknown>).nextTurnOrder;
        }),
        missingRootScenarios: change(p => {
          delete (p as unknown as Record<string, unknown>).hypotheticalTaxScenarios;
        }),
        missingGrossBase: change(p => {
          delete (p.grossSalaryQuotes[0] as unknown as Record<string, unknown>).baseAtoms;
        }),
        missingScenarioPlayers: change(p => {
          delete (p.hypotheticalTaxScenarios[1] as unknown as Record<string, unknown>).players;
        }),
        missingRowNet: change(p => {
          Reflect.deleteProperty(p.hypotheticalTaxScenarios[2].players[0],
            "hypotheticalNetAtoms");
        }),
        wrongRound: change(p => { p.round = 2; }),
        wrongMatch: change(p => { p.matchId = "other"; }),
        wrongGross: change(p => { p.grossSalaryQuotes[0].grossAtoms += 1; }),
        wrongTax: change(p => {
          p.hypotheticalTaxScenarios[1].hypotheticalTaxAtomsPerPlayer = 5;
        }),
        wrongNet: change(p => {
          p.hypotheticalTaxScenarios[2].players[0].hypotheticalNetAtoms = 90;
        }),
        otherPlayer: change(p => {
          p.hypotheticalTaxScenarios[1].players[0].playerId = "impostor";
        }),
        missingQuote: change(p => { p.grossSalaryQuotes.pop(); }),
        nullQuote: change(p => { p.grossSalaryQuotes[0] = null as never; }),
        nullScenario: change(p => { p.hypotheticalTaxScenarios[1] = null as never; }),
        arrayScenario: change(p => { p.hypotheticalTaxScenarios[0] = [] as never; }),
        nullPlayerRow: change(p => {
          p.hypotheticalTaxScenarios[1].players[0] = null as never;
        }),
        arrayPlayerRow: change(p => {
          p.hypotheticalTaxScenarios[2].players[0] = [] as never;
        }),
        invalidSnapshotId: null,
      };
      const before = JSON.stringify({ state, preview, bad });
      await page.goto("/");
      const res = await page.evaluate(async ({ state, bad }) => {
        const { hasVerifiedDevelopmentPendingSettlementPreview: valid } =
          await import("/src/features/matches/verifiedDevelopmentPendingSettlementPreview.ts");
        return Object.entries(bad).map(([label, value]) =>
          [label, valid(value, state)] as const);
      }, { state, bad });
      expect(res).toHaveLength(Object.keys(bad).length);
      for (const [label, accepted] of res)
        expect(accepted, label).toBe(false);
      expect(JSON.stringify({ state, preview, bad })).toBe(before);
    });
}
