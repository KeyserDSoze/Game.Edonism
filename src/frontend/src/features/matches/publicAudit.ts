import { streetById } from "@/features/city/board";

/** This is a deliberately narrow, public view of the current four event kinds. */
export type PublicMatchEvent = Readonly<{
  revision: number;
  round: number;
  kind: string;
  actorId: string;
  fromStreetId: string | null;
  toStreetId: string | null;
}>;


/**
 * #113: Minimal public JSON event shape, NOT an audit replay verifier.
 * Unknown well-formed future kinds are admitted to the transport envelope
 * but hidden by the independently guarded public audit presentation.
 */
export function isPublicMatchEventRecord(value: unknown): value is PublicMatchEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.revision === "number"
    && Number.isSafeInteger(entry.revision) && entry.revision >= 0
    && typeof entry.round === "number"
    && Number.isSafeInteger(entry.round) && entry.round >= 1
    && typeof entry.kind === "string" && entry.kind.trim().length > 0
    && typeof entry.actorId === "string" && entry.actorId.trim().length > 0
    && (entry.fromStreetId === null || typeof entry.fromStreetId === "string")
    && (entry.toStreetId === null || typeof entry.toStreetId === "string");
}

/**
 * Only render the printed first-round move/turn subset. Unknown future events
 * might contain private game data; fail closed until explicitly reviewed.
 * This is NOT a verifier: only .NET MatchAuditReplay checks event consistency.
 */
export function visiblePublicAuditEvents(
  events: readonly PublicMatchEvent[],
  players: readonly string[],
): PublicMatchEvent[] {
  // An untyped record invalidates the ENTIRE feed; do not display a
  // plausible partial audit or throw during the React render pass.
  if (!Array.isArray(events) || !Array.isArray(players)
    || !players.every(id => typeof id === "string" && id.trim())
    || !events.every(isPublicMatchEventRecord)) return [];
  const knownPlayers = new Set(players);
  return events.filter((entry) => {
    if (!Number.isInteger(entry.revision) || entry.revision < 0 || entry.round !== 1)
      return false;
    if (entry.kind === "match-created") {
      return entry.revision === 0 && entry.actorId === "system"
        && entry.fromStreetId == null && entry.toStreetId == null;
    }
    if (!knownPlayers.has(entry.actorId)) return false;
    if (entry.kind === "free-move") {
      return Boolean(entry.fromStreetId && entry.toStreetId
        && streetById(entry.fromStreetId) && streetById(entry.toStreetId));
    }
    return (entry.kind === "turn-ended" || entry.kind === "round-settlement-pending")
      && entry.fromStreetId == null && entry.toStreetId == null;
  });
}
