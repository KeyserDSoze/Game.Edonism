import { cityBoard } from "./board";

/**
 * #130: A strictly public DISPLAY helper. Server-only .NET validation is
 * authoritative; no route, owner, turn permission, economy, faction, token,
 * or private card can be reconstructed from the immutable starting lot.
 *
 * The whole legend's origin badges fail closed if any input is malformed,
 * duplicated or outside the one versioned printed 30-slot board.
 */
const printedSlotIds = new Set(cityBoard.slots.map(slot => slot.id));

export function verifiedPublicStartingLots(value: unknown): ReadonlyMap<string, string> {
  const noOrigins = () => new Map<string, string>();
  if (!Array.isArray(value) || value.length < 2 || value.length > 8)
    return noOrigins();

  const byPlayer = new Map<string, string>();
  const usedSlots = new Set<string>();
  for (const player of value) {
    if (player === null || typeof player !== "object" || Array.isArray(player))
      return noOrigins();
    const p = player as Record<string, unknown>;
    if (typeof p.playerId !== "string" || !p.playerId.trim()
      || byPlayer.has(p.playerId)
      || typeof p.startingSlotId !== "string"
      || !printedSlotIds.has(p.startingSlotId)
      || usedSlots.has(p.startingSlotId))
      return noOrigins();

    byPlayer.set(p.playerId, p.startingSlotId);
    usedSlots.add(p.startingSlotId);
  }
  return byPlayer;
}
