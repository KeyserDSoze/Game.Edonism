/**
 * #164: private actor-scoped card KIND inspection, not a card ID, action,
 * election trigger or query about the other hands / undealt draw pile.
 *
 * A legacy v1 checkpoint has NO typed marker: null ownHandIndex with
 * classificationAvailable=false means UNKNOWN, never "not in my hand".
 */
export type OwnElectionDayInspection = Readonly<{
  matchId: string;
  playerId: string;
  verifiedRevision: number;
  classificationAvailable: boolean;
  ownHandIndex: number | null;
}>;

type Hand = Readonly<{
  matchId: string; playerId: string; cardIds: readonly string[];
}>;

export function hasVerifiedOwnElectionDayInspection(
  candidate: unknown,
  matchId: string,
  playerId: string,
  revision: number,
  hand: Hand | null,
): candidate is OwnElectionDayInspection {
  if (!candidate || typeof candidate !== "object"
    || Array.isArray(candidate)
    || !hand || hand.matchId !== matchId || hand.playerId !== playerId
    || !Array.isArray(hand.cardIds) || hand.cardIds.length !== 4
    || hand.cardIds.some(id => typeof id !== "string" || !id.trim())
    || new Set(hand.cardIds).size !== 4)
    return false;

  const row = candidate as Record<string, unknown>;
  // Fail closed even for an unexpected raw marker or another player's
  // card IDs in a forged HTTP 200. These five keys are the entire DTO.
  const keys = Object.keys(row).sort().join("|");
  if (keys !== [
    "classificationAvailable", "matchId", "ownHandIndex",
    "playerId", "verifiedRevision",
  ].sort().join("|")) return false;

  if (row.matchId !== matchId || row.playerId !== playerId
    || !Number.isSafeInteger(revision) || row.verifiedRevision !== revision
    || typeof row.classificationAvailable !== "boolean")
    return false;

  const index = row.ownHandIndex;
  if (!row.classificationAvailable) return index === null;
  return index === null || (Number.isInteger(index)
    && typeof index === "number" && index >= 0 && index < hand.cardIds.length);
}
