import { cityBoard } from "./board";
import { selectVerifiedPublicUncontrolledActivities } from "./publicUncontrolledActivityFilters";

/**
 * #151: all seven printed streets in their canonical board order, with
 * counts of only FULLY VERIFIED, face-up public uncontrolled activities.
 * No movement, capture, purchase or PvP authority can be inferred from it.
 */
export type PublicFreeActivityStreetCount = Readonly<{
  streetId: string;
  streetName: string;
  count: number;
}>;

export function verifiedPublicFreeActivityStreetDistribution(
  snapshot: unknown,
): readonly PublicFreeActivityStreetCount[] {
  // Only the entire fail-closed #149 verified full-board set may contribute.
  // Requesting "all/all" here bypasses local UI facet preferences and keeps
  // total counts stable when the user filters visible cards (#150).
  const all = selectVerifiedPublicUncontrolledActivities(snapshot, {
    streetId: "", category: "",
  }).all;
  if (!all.length) return [];

  const counts = new Map<string, number>(
    cityBoard.streets.map(street => [street.id, 0]),
  );
  for (const card of all) {
    if (!counts.has(card.streetId)) return [];
    counts.set(card.streetId, counts.get(card.streetId)! + 1);
  }
  const rows = cityBoard.streets.map(street => ({
    streetId: street.id,
    streetName: street.name,
    count: counts.get(street.id)!,
  }));
  return rows.reduce((sum, row) => sum + row.count, 0) === all.length
    ? rows : [];
}
