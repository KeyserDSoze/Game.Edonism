import { expect, test } from "@playwright/test";

// #162: inspect the ACTUAL compiled Vite validator, never a parallel
// imitation. The three rates are printed-rule hypothetical possibilities,
// NOT an applied mayor policy or payable wallet credit.
for (const count of [2, 4, 8] as const) {
  test(`#162: ${count} seats accept only canonical complete 0/1/2 scenarios`,
    async ({ page }) => {
      await page.goto("/");
      const outcome = await page.evaluate(async seats => {
        const { hasVerifiedHypotheticalSalaryScenarios: verify } =
          await import("/src/features/matches/verifiedHypotheticalSalaryScenarios.ts");
        const ids = ["alice", "bob", "charlie", "diana",
          "eve", "frank", "grace", "heidi"].slice(0, seats);
        const gross = ids.map((playerId, i) => ({
          playerId, baseAtoms: 2, standingActivityAtoms: i % 2,
          grossAtoms: 2 + i % 2,
        }));
        const scenarios = [0, 1, 2].map(tax => ({
          hypotheticalTaxAtomsPerPlayer: tax,
          potentialWithheldAtoms: tax * seats,
          players: gross.map(row => ({
            playerId: row.playerId,
            grossAtoms: row.grossAtoms,
            hypotheticalTaxAtoms: tax,
            hypotheticalNetAtoms: row.grossAtoms - tax,
          })),
        }));
        const changed = (update: (data: typeof scenarios) => void) => {
          const copy = structuredClone(scenarios);
          update(copy);
          return verify(copy, gross);
        };
        return {
          valid: verify(scenarios, gross),
          empty: verify([], gross),
          missing: verify(null, gross),
          duplicateRate: changed(data => {
            data[2].hypotheticalTaxAtomsPerPlayer = 1;
          }),
          forgedRate: changed(data => {
            data[2].hypotheticalTaxAtomsPerPlayer = 9;
          }),
          extraWithheld: changed(data => {
            data[1].potentialWithheldAtoms++;
          }),
          forgedPlayer: changed(data => {
            data[0].players[0].playerId = "intruder";
          }),
          reordered: changed(data => {
            [data[0].players[0], data[0].players[1]] =
              [data[0].players[1], data[0].players[0]];
          }),
          falseNet: changed(data => {
            data[2].players[0].hypotheticalNetAtoms++;
          }),
          negativeNet: changed(data => {
            data[2].players[0].hypotheticalNetAtoms = -1;
          }),
          missingOwner: changed(data => {
            data[1].players.pop();
          }),
          forgedGross: changed(data => {
            data[1].players[0].grossAtoms = 200;
          }),
          invalidBase: verify(scenarios, gross.map((row, i) =>
            i === 0 ? { ...row, baseAtoms: 10 } : row)),
          forgedGrossQuote: verify(scenarios, gross.map((row, i) =>
            i === 0 ? { ...row, grossAtoms: -1 } : row)),
        };
      }, count);
      expect(outcome.valid).toBe(true);
      for (const [key, result] of Object.entries(outcome))
        if (key !== "valid") expect(result, key).toBe(false);
    });
}
