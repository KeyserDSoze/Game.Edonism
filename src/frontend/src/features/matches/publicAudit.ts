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
 * Only render the printed first-round move/turn subset. Unknown future events
 * might contain private game data; fail closed until explicitly reviewed.
 * This is NOT a verifier: only .NET MatchAuditReplay checks event consistency.
 */
export function visiblePublicAuditEvents(
  events: readonly PublicMatchEvent[],
  players: readonly string[],
): PublicMatchEvent[] {
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
