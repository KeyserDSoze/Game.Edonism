import { cityBoard } from "./board";
import { printedActivityCategoryQuotas } from "./activityMarkers";
import {
  verifiedPublicUncontrolledBoardActivities,
  type PublicUncontrolledBoardActivity,
} from "./publicUncontrolledBoardActivities";

/**
 * #150 — DISPLAY-ONLY filters applied AFTER the all-or-nothing complete
 * public board validation (#149). Invalid local filter preferences resolve
 * to "all", not to a guessed or selectively suppressed opponent card.
 */
export type PublicUncontrolledActivityFilters = Readonly<{
  streetId: unknown;
  category: unknown;
}>;

export type FilteredPublicUncontrolledActivities = Readonly<{
  all: readonly PublicUncontrolledBoardActivity[];
  visible: readonly PublicUncontrolledBoardActivity[];
  streetId: string;
  category: string;
  totalCount: number;
  visibleCount: number;
}>;

const printedStreets = new Set(cityBoard.streets.map(street => street.id));

export function selectVerifiedPublicUncontrolledActivities(
  snapshot: unknown,
  filters: PublicUncontrolledActivityFilters,
): FilteredPublicUncontrolledActivities {
  // Never accept caller-injected "verified" entries: validation is performed
  // on the entire original snapshot BEFORE applying either display filter.
  const all = verifiedPublicUncontrolledBoardActivities(snapshot);
  const streetId = typeof filters?.streetId === "string"
    && printedStreets.has(filters.streetId) ? filters.streetId : "";
  const category = typeof filters?.category === "string"
    && printedActivityCategoryQuotas.has(filters.category) ? filters.category : "";
  const visible = all.filter(card =>
    (!streetId || card.streetId === streetId)
    && (!category || card.category === category));
  return {
    all,
    visible,
    streetId,
    category,
    totalCount: all.length,
    visibleCount: visible.length,
  };
}
