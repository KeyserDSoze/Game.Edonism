import type { OfflinePublicAuditReview, OfflinePublicAuditTimelineStep } from "./verifyPublicAuditFile";

/**
 * Both inputs MUST come from buildOfflinePublicAuditReview (which first runs
 * the strict offline verifier). This comparison does not establish provenance:
 * either unsigned file can be forged, even when their histories agree.
 */
/** Only allowlisted schema keys and verified 0-based seat indices, never raw values. */
export type PublicAuditChangedField = Readonly<{
  field: "kind" | "actorId" | "fromStreetId" | "toStreetId"
    | "phase" | "activePlayerId" | "playerId" | "streetId" | "freeMoveUsed";
  seatIndex: number | null;
}>;

export type OfflinePublicAuditComparison = Readonly<{
  status: "identical" | "left-prefix" | "right-prefix" | "divergent" | "different-match";
  firstDifferentRevision: number | null;
  /** Explicit public-only copies from the FIRST mismatched verified revision. */
  firstDifference?: Readonly<{
    left: OfflinePublicAuditTimelineStep;
    right: OfflinePublicAuditTimelineStep;
    changedFields: readonly PublicAuditChangedField[];
  }>;
}>;

function changedPublicFields(
  left: OfflinePublicAuditTimelineStep,
  right: OfflinePublicAuditTimelineStep,
): PublicAuditChangedField[] {
  const differences: PublicAuditChangedField[] = [];
  // The strict verifier guarantees each step's revision equals its array
  // position. Compare only public event/turn keys, in canonical schema order.
  const fields = [
    "kind", "actorId", "fromStreetId", "toStreetId", "phase", "activePlayerId",
  ] as const;
  for (const field of fields) {
    if (left[field] !== right[field])
      differences.push({ field, seatIndex: null });
  }

  const playerFields = ["playerId", "streetId", "freeMoveUsed"] as const;
  for (let i = 0; i < Math.max(left.players.length, right.players.length); i++) {
    const a = left.players[i];
    const b = right.players[i];
    if (!a || !b) {
      // Unlike a raw array dump, the missing-seat marker carries no player
      // data. The first difference is the seat identity at that index.
      differences.push({ field: "playerId", seatIndex: i });
      continue;
    }
    for (const field of playerFields) {
      if (a[field] !== b[field])
        differences.push({ field, seatIndex: i });
    }
  }
  return differences;
}

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
          changedFields: changedPublicFields(left.steps[revision], right.steps[revision]),
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
