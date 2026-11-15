import { isPublicMatchEventRecord } from "./publicAudit";

/**
 * #112: a deliberately NARROW public Development snapshot envelope guard.
 *
 * A JSON response is not type-safe just because responseJson<T> cast it.
 * This guard runs BEFORE match revision/session/ETag changes; the domain and
 * .NET audit replay are still authoritative for moves and event semantics.
 * Every public audit event record must have a safe runtime shape, because
 * the event feed runs during React render after a snapshot is accepted.
 * Intentionally DO NOT validate each board card / lot / quote value here:
 * independent #105/#108/#111 view projections must fail closed without
 * suppressing other valid public information and server command permissions.
 */
type PublicSeatEnvelope = Readonly<{
  playerId: string;
  streetId: string;
  freeMoveUsed: boolean;
}>;
type PublicDevelopmentSnapshotEnvelope = Readonly<{
  matchId: string;
  revision: number;
  round: number;
  phase: number;
  activePlayerId: string | null;
  players: readonly PublicSeatEnvelope[];
  turnOrder: readonly string[];
  proposedNextRoundOrder: readonly string[];
  events: readonly unknown[];
  boardActivities: readonly unknown[];
  controlledActivities: readonly unknown[];
  grossSalaryQuotes: readonly unknown[];
}>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasValidDevelopmentPublicEnvelope(
  value: unknown, expectedMatchId: string,
): value is PublicDevelopmentSnapshotEnvelope {
  if (!isRecord(value) || typeof expectedMatchId !== "string"
    || value.matchId !== expectedMatchId
    || typeof value.revision !== "number"
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.round !== "number"
    || !Number.isSafeInteger(value.round) || value.round < 1
    || (value.phase !== 0 && value.phase !== 1)
    // #116: In .NET GameMatch the only PlayerTurns (0) state always has
    // an active seat, while pending first-round settlement (1) has none.
    // Reject contradictory public JSON BEFORE revision/session/ETag mutation.
    || (value.phase === 0
      && (typeof value.activePlayerId !== "string" || !value.activePlayerId.trim()))
    || (value.phase === 1 && value.activePlayerId !== null)
    || !Array.isArray(value.players)
    || value.players.length < 2 || value.players.length > 8
    || !Array.isArray(value.turnOrder)
    || !Array.isArray(value.proposedNextRoundOrder)
    || !Array.isArray(value.events)
    || !Array.isArray(value.boardActivities)
    || !Array.isArray(value.controlledActivities)
    || !Array.isArray(value.grossSalaryQuotes)
    || !value.events.every(isPublicMatchEventRecord)) return false;

  const ids = new Set<string>();
  for (const player of value.players) {
    if (!isRecord(player) || typeof player.playerId !== "string"
      || !player.playerId.trim() || ids.has(player.playerId)
      || typeof player.streetId !== "string"
      || !player.streetId.trim()
      || typeof player.freeMoveUsed !== "boolean") return false;
    ids.add(player.playerId);
  }

  const sameSeatSet = (order: readonly unknown[]) => {
    if (order.length !== ids.size) return false;
    const checked = new Set<string>();
    for (const item of order) {
      if (typeof item !== "string" || !ids.has(item) || checked.has(item))
        return false;
      checked.add(item);
    }
    return checked.size === ids.size;
  };
  return sameSeatSet(value.turnOrder)
    && sameSeatSet(value.proposedNextRoundOrder)
    && (value.activePlayerId === null || (typeof value.activePlayerId === "string"
      && ids.has(value.activePlayerId)));
}
