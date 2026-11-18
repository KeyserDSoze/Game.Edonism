import type { PublicGrossSalaryQuote } from "@/features/city/activityMarkers";
import { isValidDevelopmentTechnicalPlayerId } from "./verifiedDevelopmentTechnicalPlayerId";

// #162: these are hypothetical 0/1/2 mayor TAX OPTIONS, NOT the active
// public tax, not net atoms credited to any seat, and never a match command.
// #165: even this standalone validator must reject forged/reserved technical
// owners, independent of its caller's public-match ingress gate.
export type HypotheticalNetSalary = Readonly<{
  playerId: string;
  grossAtoms: number;
  hypotheticalTaxAtoms: number;
  hypotheticalNetAtoms: number;
}>;

export type HypotheticalTaxScenario = Readonly<{
  hypotheticalTaxAtomsPerPlayer: number;
  potentialWithheldAtoms: number;
  players: readonly HypotheticalNetSalary[];
}>;

export function hasVerifiedHypotheticalSalaryScenarios(
  scenarios: unknown,
  gross: readonly PublicGrossSalaryQuote[],
): scenarios is readonly HypotheticalTaxScenario[] {
  if (!Array.isArray(scenarios) || scenarios.length !== 3
    || !Array.isArray(gross) || gross.length < 2 || gross.length > 8
    || gross.some(quote => !quote || !isValidDevelopmentTechnicalPlayerId(quote.playerId)
      || !Number.isInteger(quote.baseAtoms)
      || quote.baseAtoms !== 2
      || !Number.isInteger(quote.standingActivityAtoms)
      || quote.standingActivityAtoms < 0 || quote.standingActivityAtoms > 16
      || quote.grossAtoms !== 2 + quote.standingActivityAtoms)
    || new Set(gross.map(quote => quote.playerId)).size !== gross.length
    || gross.reduce((sum, quote) => sum + quote.standingActivityAtoms, 0) > 30)
    return false;

  return scenarios.every((scenario: HypotheticalTaxScenario, tax: number) =>
    scenario && Number.isInteger(scenario.hypotheticalTaxAtomsPerPlayer)
    && scenario.hypotheticalTaxAtomsPerPlayer === tax
    && Number.isInteger(scenario.potentialWithheldAtoms)
    && scenario.potentialWithheldAtoms === tax * gross.length
    && Array.isArray(scenario.players) && scenario.players.length === gross.length
    && scenario.players.every((row, index) => {
      const expected = gross[index];
      return row && row.playerId === expected.playerId
        && Number.isInteger(row.grossAtoms)
        && row.grossAtoms === expected.grossAtoms
        && Number.isInteger(row.hypotheticalTaxAtoms)
        && row.hypotheticalTaxAtoms === tax
        && Number.isInteger(row.hypotheticalNetAtoms)
        && row.hypotheticalNetAtoms === expected.grossAtoms - tax
        && row.hypotheticalNetAtoms >= 0;
    }));
}
