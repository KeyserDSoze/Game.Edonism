import { verifiedPublicHistory, type PublicHistory, type PublicHistoryMatch } from "./verifiedPublicHistory";
import type { PublicMatchEvent } from "./publicAudit";
import type { PublicHistoryFrame } from "./verifiedPublicHistory";

/**
 * A portable, UNSIGNED, public-only first-round evidence file.
 * Never export the complete Development session, bearer, hand or raw API data.
 * The public snapshots and every frame must agree before exporting anything.
 */
export type VerifiedPublicAuditExport = Readonly<{
  format: "edonism-public-audit-v1";
  matchId: string;
  round: 1;
  verifiedRevision: number;
  events: readonly PublicMatchEvent[];
  frames: readonly PublicHistoryFrame[];
}>;

export function buildVerifiedPublicAuditExport(
  state: PublicHistoryMatch,
  history: PublicHistory | null,
): VerifiedPublicAuditExport | null {
  const verified = verifiedPublicHistory(state, history);
  if (!verified || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(state.matchId))
    return null;

  // Explicit field-by-field copies: future public snapshot / frame fields may
  // contain private data. Never spread or JSON.stringify the source objects.
  return {
    format: "edonism-public-audit-v1",
    matchId: state.matchId,
    round: 1,
    verifiedRevision: verified.verifiedRevision,
    events: state.events.map(event => ({
      revision: event.revision,
      round: event.round,
      kind: event.kind,
      actorId: event.actorId,
      fromStreetId: event.fromStreetId,
      toStreetId: event.toStreetId,
    })),
    frames: verified.frames.map(frame => ({
      revision: frame.revision,
      kind: frame.kind,
      actorId: frame.actorId,
      phase: frame.phase,
      activePlayerId: frame.activePlayerId,
      players: frame.players.map(player => ({
        playerId: player.playerId,
        streetId: player.streetId,
        freeMoveUsed: player.freeMoveUsed,
      })),
    })),
  };
}
