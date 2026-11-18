import type { PublicGrossSalaryQuote } from "@/features/city/activityMarkers";
import { isValidDevelopmentTechnicalPlayerId } from "./verifiedDevelopmentTechnicalPlayerId";
import {
  hasVerifiedHypotheticalSalaryScenarios,
  type HypotheticalTaxScenario,
} from "./verifiedHypotheticalSalaryScenarios";

/**
 * #176: read-only Domain-audited first-round settlement INPUT.
 * No salary payment, elected mayor, real tax policy or next-round action.
 */
export type VerifiedDevelopmentPendingSettlementPreview = Readonly<{
  matchId: string;
  round: number;
  verifiedRevision: number;
  nextTurnOrder: readonly string[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
  hypotheticalTaxScenarios: readonly HypotheticalTaxScenario[];
}>;

export type PendingSettlementPublicSnapshot = Readonly<{
  matchId: string;
  round: number;
  revision: number;
  phase: number;
  players: readonly Readonly<{ playerId: string }>[];
  proposedNextRoundOrder: readonly string[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const previewKeys =
  "grossSalaryQuotes|hypotheticalTaxScenarios|matchId|nextTurnOrder|round|verifiedRevision";
const quoteKeys = "baseAtoms|grossAtoms|playerId|standingActivityAtoms";

/**
 * Only accept the exact raw HTTP wire emitted by .NET
 * MatchPendingSettlementPreview (6) / MatchGrossSalaryQuote (4) /
 * MatchHypotheticalTaxScenario (3) / MatchHypotheticalNetSalary (4).
 *
 * The independently verified public snapshot determines the revision,
 * actors, proposed order and public gross salary. This does not pay or
 * authorize anything and never strips unknown extra keys.
 */
export function hasVerifiedDevelopmentPendingSettlementPreview(
  value: unknown, snapshot: PendingSettlementPublicSnapshot | null,
): value is VerifiedDevelopmentPendingSettlementPreview {
  if (!snapshot || !isRecord(value)
    || Object.keys(value).sort().join("|") !== previewKeys
    || typeof snapshot.matchId !== "string" || !snapshot.matchId.trim()
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || !Number.isSafeInteger(snapshot.round) || snapshot.round !== 1
    || snapshot.phase !== 1
    || value.matchId !== snapshot.matchId
    || value.round !== snapshot.round
    || value.verifiedRevision !== snapshot.revision
    || !Array.isArray(snapshot.players)
    || snapshot.players.length < 2 || snapshot.players.length > 8
    || snapshot.players.some(p => !p || !isValidDevelopmentTechnicalPlayerId(p.playerId))
    || new Set(snapshot.players.map(p => p.playerId)).size !== snapshot.players.length
    || !Array.isArray(snapshot.proposedNextRoundOrder)
    || snapshot.proposedNextRoundOrder.length !== snapshot.players.length
    || new Set(snapshot.proposedNextRoundOrder).size !== snapshot.players.length
    || snapshot.proposedNextRoundOrder.some(id =>
      !snapshot.players.some(p => p.playerId === id))
    || !Array.isArray(value.nextTurnOrder)
    || value.nextTurnOrder.length !== snapshot.proposedNextRoundOrder.length
    || value.nextTurnOrder.some((id, i) => id !== snapshot.proposedNextRoundOrder[i])
    || !Array.isArray(snapshot.grossSalaryQuotes)
    || snapshot.grossSalaryQuotes.length !== snapshot.players.length
    || snapshot.grossSalaryQuotes.some((q, i) =>
      !q || q.playerId !== snapshot.players[i].playerId)
    || !Array.isArray(value.grossSalaryQuotes)
    || value.grossSalaryQuotes.length !== snapshot.grossSalaryQuotes.length
    || value.grossSalaryQuotes.some((raw: unknown, i: number) => {
      if (!isRecord(raw)
        || Object.keys(raw).sort().join("|") !== quoteKeys) return true;
      const expected = snapshot.grossSalaryQuotes[i];
      return raw.playerId !== expected.playerId
        || !Number.isSafeInteger(raw.baseAtoms)
        || !Number.isSafeInteger(raw.standingActivityAtoms)
        || !Number.isSafeInteger(raw.grossAtoms)
        || raw.baseAtoms !== expected.baseAtoms
        || raw.standingActivityAtoms !== expected.standingActivityAtoms
        || raw.grossAtoms !== expected.grossAtoms
        || raw.baseAtoms !== 2
        || (raw.standingActivityAtoms as number) < 0
        || (raw.standingActivityAtoms as number) > 16
        || raw.grossAtoms !== (raw.baseAtoms as number)
          + (raw.standingActivityAtoms as number);
    })
    || !hasVerifiedHypotheticalSalaryScenarios(
      value.hypotheticalTaxScenarios, snapshot.grossSalaryQuotes))
    return false;
  return true;
}
