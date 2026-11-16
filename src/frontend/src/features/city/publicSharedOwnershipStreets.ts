import { cityBoard } from "./board";
import {
  verifiedPublicStreetControlMatrix,
  type PublicStreetOwnerControl,
} from "./publicStreetControlMatrix";

/** #157 — Public co-ownership does NOT imply combat, capture or victory. */
export type PublicSharedOwnershipStreet = Readonly<{
  streetId: string;
  streetName: string;
  freeLots: number;
  controlledLots: number;
  standing: number;
  fallen: number;
  ownerCount: number;
  owners: readonly PublicStreetOwnerControl[];
}>;

/**
 * null: invalid/partial public snapshot; []: VERIFIED zero shared streets.
 * Reuses only the full 30-card, 7-road fail-closed #152 matrix.
 * Preserve original street and server player ordering.
 */
export function verifiedPublicSharedOwnershipStreets(
  snapshot: unknown,
): readonly PublicSharedOwnershipStreet[] | null {
  const matrix = verifiedPublicStreetControlMatrix(snapshot);
  if (matrix.length !== cityBoard.streets.length) return null;
  return matrix.flatMap((street) => {
    const owners = street.owners.filter(owner => owner.controlled > 0);
    return owners.length >= 2 ? [{
      streetId: street.streetId,
      streetName: street.streetName,
      freeLots: street.freeLots,
      controlledLots: street.controlledLots,
      standing: street.standing,
      fallen: street.fallen,
      ownerCount: owners.length,
      owners,
    }] : [];
  });
}
