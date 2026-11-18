import { hasValidDevelopmentPublicEnvelope } from "./verifiedDevelopmentPublicEnvelope";

/**
 * #172: read-only, server-replayed Development first-round turn progress.
 * This is an audit-verified hint, NOT permission to end/skip a turn,
 * infer presence, collect salary, run election day or start another round.
 */
export type VerifiedDevelopmentFirstRoundTurnProgress = Readonly<{
  matchId: string;
  round: number;
  verifiedRevision: number;
  phase: number;
  activePlayerId: string | null;
  totalTurns: number;
  completedTurns: number;
  completedPlayerIds: readonly string[];
  remainingPlayerIds: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Existing .NET MatchFirstRoundTurnProgress record: exactly 9 JSON keys.
const progressKeys = "activePlayerId|completedPlayerIds|completedTurns|matchId|phase|remainingPlayerIds|round|totalTurns|verifiedRevision";

/**
 * Validate the ENTIRE raw HTTP 200 against an independently verified public
 * match snapshot before retaining it as a progress lease. A single extra
 * property (even null), missing list entry or unknown actor invalidates
 * the whole optional projection; never strip values and accept the rest.
 */
export function hasValidDevelopmentFirstRoundTurnProgress(
  value: unknown, publicState: unknown,
): value is VerifiedDevelopmentFirstRoundTurnProgress {
  if (!isRecord(publicState) || typeof publicState.matchId !== "string"
    || !hasValidDevelopmentPublicEnvelope(publicState, publicState.matchId)
    || !isRecord(value)
    || Object.keys(value).sort().join("|") !== progressKeys
    || value.matchId !== publicState.matchId
    || value.round !== publicState.round
    || value.verifiedRevision !== publicState.revision
    || value.phase !== publicState.phase
    || value.activePlayerId !== publicState.activePlayerId
    || !Number.isSafeInteger(value.totalTurns)
    || !Number.isSafeInteger(value.completedTurns)
    || !Array.isArray(value.completedPlayerIds)
    || !Array.isArray(value.remainingPlayerIds)
    || (publicState.phase !== 0 && publicState.phase !== 1)) return false;

  const turnOrder = publicState.turnOrder;
  if (!Array.isArray(turnOrder) || turnOrder.length < 2 || turnOrder.length > 8
    || new Set(turnOrder).size !== turnOrder.length
    || turnOrder.some((id: unknown) => typeof id !== "string")
    || value.totalTurns !== turnOrder.length) return false;

  const completed = publicState.phase === 1 ? turnOrder.length
    : turnOrder.indexOf(publicState.activePlayerId);
  if (publicState.phase === 1
    ? publicState.activePlayerId !== null
    : completed < 0 || completed >= turnOrder.length) return false;

  if (value.completedTurns !== completed
    || value.completedPlayerIds.length !== completed
    || value.remainingPlayerIds.length !== turnOrder.length - completed
    || value.completedPlayerIds.some((id, index) => id !== turnOrder[index])
    || value.remainingPlayerIds.some((id, index) => id !== turnOrder[completed + index]))
    return false;
  return true;
}
