import type { OfflinePublicAuditReview, OfflinePublicAuditTimelineStep } from "./verifyPublicAuditFile";

/**
 * Both inputs MUST come from buildOfflinePublicAuditReview (which first runs
 * the strict offline verifier). This comparison does not establish provenance:
 * either unsigned file can be forged, even when their histories agree.
 */
export type OfflinePublicAuditComparison = Readonly<{
  status: "identical" | "left-prefix" | "right-prefix" | "divergent" | "different-match";
  firstDifferentRevision: number | null;
  /** Explicit public-only copies from the FIRST mismatched verified revision. */
  firstDifference?: Readonly<{
    left: OfflinePublicAuditTimelineStep;
    right: OfflinePublicAuditTimelineStep;
  }>;
}>;

/** Never spread file data or retain unknown properties in comparison results. */
function copyPublicStep(step: OfflinePublicAuditTimelineStep): OfflinePublicAuditTimelineStep {
  return {
    revision: step.revision,
    kind: step.kind,
    actorId: step.actorId,
    fromStreetId: step.fromStreetId,
    toStreetId: step.toStreetId,
    phase: step.phase,
    activePlayerId: step.activePlayerId,
    players: step.players.map(player => ({
      playerId: player.playerId,
      streetId: player.streetId,
      freeMoveUsed: player.freeMoveUsed,
    })),
  };
}

function sameStep(left: OfflinePublicAuditTimelineStep, right: OfflinePublicAuditTimelineStep): boolean {
  if (left.revision !== right.revision || left.kind !== right.kind
    || left.actorId !== right.actorId
    || left.fromStreetId !== right.fromStreetId
    || left.toStreetId !== right.toStreetId
    || left.phase !== right.phase
    || left.activePlayerId !== right.activePlayerId
    || left.players.length !== right.players.length)
    return false;
  return left.players.every((player, i) => {
    const other = right.players[i];
    return player.playerId === other.playerId
      && player.streetId === other.streetId
      && player.freeMoveUsed === other.freeMoveUsed;
  });
}

export function compareOfflinePublicAuditReviews(
  left: OfflinePublicAuditReview,
  right: OfflinePublicAuditReview,
): OfflinePublicAuditComparison {
  // GUID strings are case-insensitive identifiers. Both validated inputs
  // may use mixed casing even though exports normally use lowercase.
  if (left.matchId.toLowerCase() !== right.matchId.toLowerCase())
    return { status: "different-match", firstDifferentRevision: null };

  const common = Math.min(left.steps.length, right.steps.length);
  for (let revision = 0; revision < common; revision++) {
    if (!sameStep(left.steps[revision], right.steps[revision])) {
      return {
        status: "divergent",
        firstDifferentRevision: revision,
        firstDifference: {
          left: copyPublicStep(left.steps[revision]),
          right: copyPublicStep(right.steps[revision]),
        },
      };
    }
  }
  if (left.steps.length === right.steps.length)
    return { status: "identical", firstDifferentRevision: null };
  return {
    status: left.steps.length < right.steps.length ? "left-prefix" : "right-prefix",
    firstDifferentRevision: null,
  };
}
