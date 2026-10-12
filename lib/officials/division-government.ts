import type { BodyDivisionType } from "./body-description.ts";

/** Whether a body is the government of the division it sits on: a string comparison and a three-row table, kept as a leaf module. */

/** The suffix the registry gives a body it derived from a division; a type absent here has no derived body. */
export const DERIVED_BODY_SUFFIX: Partial<Record<BodyDivisionType, string>> = {
  place: "governing",
  county: "governing",
  school_district: "board",
};

/**
 * Whether this body is the government of the division it sits on. Everything division-derived is gated on this. An
 * unknown division type returns false.
 */
export function isDivisionsOwnGovernment(
  bodyId: string,
  ocdId: string | null,
  divisionType: BodyDivisionType,
): boolean {
  if (ocdId === null) return false;
  const suffix = DERIVED_BODY_SUFFIX[divisionType];
  if (suffix === undefined) return false;
  return bodyId === `${ocdId}#${suffix}`;
}
