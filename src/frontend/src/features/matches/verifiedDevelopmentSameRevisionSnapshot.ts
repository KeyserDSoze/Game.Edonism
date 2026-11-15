/**
 * #121: Development public snapshot equivalence at one authoritative
 * revision. Match, actor and audit provenance are checked separately.
 *
 * Compare ONLY a public JSON snapshot, never tokens, hands or session
 * credentials. Object key insertion order is irrelevant; ordered arrays
 * (players, cards, events, routes) must match exactly. Reject any value
 * outside the JSON data model and bound the work for untrusted HTTP data.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MaxNodes = 12000;
const MaxDepth = 24;

function sameJson(
  previous: unknown, incoming: unknown,
  depth: number, remaining: { count: number },
): boolean {
  remaining.count--;
  if (remaining.count < 0 || depth > MaxDepth) return false;
  if (previous === null || incoming === null)
    return previous === null && incoming === null;
  if (typeof previous !== typeof incoming) return false;

  if (typeof previous === "string" || typeof previous === "boolean")
    return previous === incoming;
  if (typeof previous === "number")
    return Number.isFinite(previous) && previous === incoming;
  if (Array.isArray(previous) || Array.isArray(incoming)) {
    if (!Array.isArray(previous) || !Array.isArray(incoming)
      || previous.length !== incoming.length) return false;
    for (let index = 0; index < previous.length; index++)
      if (!sameJson(previous[index], incoming[index], depth + 1, remaining))
        return false;
    return true;
  }

  if (!isRecord(previous) || !isRecord(incoming)) return false;
  const left = Object.keys(previous).sort();
  const right = Object.keys(incoming).sort();
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]
      || !sameJson(previous[left[index]], incoming[right[index]],
        depth + 1, remaining)) return false;
  }
  return true;
}

export function hasSameDevelopmentPublicSnapshotAtRevision(
  current: unknown, candidate: unknown, expectedMatchId: string,
): boolean {
  if (!isRecord(current) || !isRecord(candidate)
    || typeof expectedMatchId !== "string" || !expectedMatchId.trim()
    || current.matchId !== expectedMatchId
    || candidate.matchId !== expectedMatchId
    || typeof current.revision !== "number"
    || !Number.isSafeInteger(current.revision) || current.revision < 0
    || candidate.revision !== current.revision)
    return false;
  return sameJson(current, candidate, 0, { count: MaxNodes });
}
