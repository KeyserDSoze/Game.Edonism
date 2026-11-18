import { expect, test } from "@playwright/test";

// #165: exercise the real Vite module, not a copy of its validator.
// The surrounding Development snapshot gate already checks seat IDs, but a
// standalone three-rate salary preview MUST be fail-closed too.
for (const seats of [2, 4, 8] as const) {
  test(`#165: ${seats} seat tax what-if rejects forged technical owners`,
    async ({ page }) => {
      await page.goto("/");
      const outcome = await page.evaluate(async count => {
        const { hasVerifiedHypotheticalSalaryScenarios: verify } =
          await import("/src/features/matches/verifiedHypotheticalSalaryScenarios.ts");

        // Include printable Unicode and ordinal "System": only lowercase
        // "system" is reserved by the .NET audit-genesis actor policy.
        const original = [
          "Renée", "王小明", "System", "🙂",
          "alpha", "bravo", "charlie", "delta",
        ].slice(0, count);

        const check = (owners: readonly unknown[]) => {
          const gross = owners.map((playerId, i) => ({
            playerId: playerId as string,
            baseAtoms: 2,
            standingActivityAtoms: i % 2,
            grossAtoms: 2 + i % 2,
          }));
          const scenarios = [0, 1, 2].map(tax => ({
            hypotheticalTaxAtomsPerPlayer: tax,
            potentialWithheldAtoms: tax * count,
            players: gross.map(quote => ({
              playerId: quote.playerId,
              grossAtoms: quote.grossAtoms,
              hypotheticalTaxAtoms: tax,
              hypotheticalNetAtoms: quote.grossAtoms - tax,
            })),
          }));
          const immutableBefore = JSON.stringify({ gross, scenarios });
          const passed = verify(scenarios, gross);
          return { passed, unchanged:
            JSON.stringify({ gross, scenarios }) === immutableBefore };
        };

        // Every forged fixture recalculates ALL three rates and row IDs to
        // match the fake roster. We must reject its SOURCE identities, not
        // merely catch mismatched row sums / ordering.
        const hostileOwners: unknown[] = [
          "system", null, 17, "", " ",
          " Renée", "Renée ", "alice\\nbob", "alice\\tbob",
          "alice\\u202Eevil", "alice\\u200B", "alice\\u0085",
          "\\uD800", "\\uDC00", "A".repeat(65), "🙂".repeat(33),
          "alice\\u{E0001}other", original[0],
        ];
        return {
          accepted: check(original),
          rejected: hostileOwners.map(value => {
            const ids = [...original];
            ids[ids.length - 1] = value as string;
            return check(ids);
          }),
        };
      }, seats);
      expect(outcome.accepted).toEqual({ passed: true, unchanged: true });
      for (const [index, result] of outcome.rejected.entries()) {
        expect(result.passed, `invalid ${index} / ${seats} seats`).toBe(false);
        expect(result.unchanged).toBe(true);
      }
    });
}
