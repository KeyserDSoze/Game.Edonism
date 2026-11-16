import { isPublicMatchEventRecord } from "./publicAudit";
import { hasValidDevelopmentPublicEnvelope } from "./verifiedDevelopmentPublicEnvelope";

/**
 * #119: Narrow runtime chronology contract for the implemented .NET first
 * round. Every accepted command adds ONE public event and ONE revision.
 *
 * This does not replay actions, verify movement adjacency, assert legal turns
 * or infer powers/settlement. Only the .NET Domain can do those things.
 * Future well-shaped PUBLIC event kinds remain transport-compatible, but
 * all first-round event records must be in the same contiguous timeline.
 * #134: genesis is unique. Later public entries cannot claim the reserved
 * system principal or repeat the match-created event kind.
 */
export function hasValidDevelopmentPublicAuditChronology(
  value: unknown, expectedMatchId: string,
): boolean {
  if (!hasValidDevelopmentPublicEnvelope(value, expectedMatchId)
    || value.round !== 1 || value.events.length === 0
    || value.events.length !== value.revision + 1) return false;

  const genesis = value.events[0];
  if (!isPublicMatchEventRecord(genesis)
    || genesis.revision !== 0 || genesis.round !== 1
    || genesis.kind !== "match-created" || genesis.actorId !== "system"
    || genesis.fromStreetId !== null || genesis.toStreetId !== null)
    return false;

  for (let i = 1; i < value.events.length; i++) {
    const event = value.events[i];
    // Check the real wire record, never trust a TypeScript-only cast.
    if (!isPublicMatchEventRecord(event)
      || event.revision !== i || event.round !== 1
      || event.actorId === "system" || event.kind === "match-created")
      return false;
  }
  return true;
}
