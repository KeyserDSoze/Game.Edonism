/**
 * #178: exact raw .NET public tactical wire contract.
 *
 * Scope (#100), route semantics (#101), and current browser bearer/revision
 * checks remain independent and mandatory. This rejects unexpected keys on
 * the WHOLE raw HTTP object before it enters the tacticalLease.
 */
const overviewKeys = [
  "matchId", "playerId", "round", "verifiedRevision", "fromStreetId",
  "uncontrolled", "otherPlayers", "opponentControlledLots",
];
const scopedRoutesKeys = [
  "matchId", "playerId", "round", "verifiedRevision", "fromStreetId", "routes",
];
const scopedOthersKeys = [
  "matchId", "playerId", "round", "verifiedRevision", "fromStreetId", "others",
];
const uncontrolledRowKeys = [
  "slotId", "cardId", "category", "streetId", "streetSteps", "streetPath",
];
const otherPlayerRowKeys = [
  "otherPlayerId", "streetId", "streetSteps", "streetPath",
  "controlledActivities", "standingHenchmen",
];
const opponentLotRowKeys = [
  "slotId", "ownerPlayerId", "posture", "streetId", "streetSteps", "streetPath",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnKeys(value: unknown, expected: readonly string[]):
  value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function exactRows(value: unknown, keys: readonly string[]): boolean {
  return Array.isArray(value) && value.every(row => hasExactOwnKeys(row, keys));
}

/**
 * Shape only: the real JSON serializer's public DTO members, including each
 * row (not just the outer scope). Empty arrays are legal when no cards/lots
 * exist; existing #101 validators enforce the required roster and counts.
 * Never sanitize or mutate a candidate with forbidden/private metadata.
 */
export function hasExactPublicTacticalOverviewWire(value: unknown): boolean {
  if (!hasExactOwnKeys(value, overviewKeys)
    || !hasExactOwnKeys(value.uncontrolled, scopedRoutesKeys)
    || !hasExactOwnKeys(value.otherPlayers, scopedOthersKeys)
    || !hasExactOwnKeys(value.opponentControlledLots, scopedRoutesKeys))
    return false;

  return exactRows(value.uncontrolled.routes, uncontrolledRowKeys)
    && exactRows(value.otherPlayers.others, otherPlayerRowKeys)
    && exactRows(value.opponentControlledLots.routes, opponentLotRowKeys);
}
