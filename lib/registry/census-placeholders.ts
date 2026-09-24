/**
 * **A CENSUS PLACEHOLDER IS GEOGRAPHY, NEVER A GOVERNMENT.** (2026-09-23.)
 *
 * TIGER writes one placeholder per state into each school-district layer: LEA
 * code 99997, named "School District Not Defined" — land that lies inside no
 * district of that kind. The division is a true fact about the place and stays
 * (item 6b, 2026-08-15, relabelled it "No unified school district here"). But
 * no board meets for it, so no body may ever be minted on it: the registry
 * once held `…/school_district:school_district_not_defined#board` for Arizona
 * and New Hampshire, counted as registered bodies everywhere a body is counted.
 *
 * Identified by the Census's own code, not by a label someone may later
 * rewrite; the slug the committed geometry gave it is the fallback for a row
 * with no GEOID.
 */
export const CENSUS_PLACEHOLDER_BODY_ISSUE = "BODY_ON_CENSUS_PLACEHOLDER_DIVISION";

/**
 * The Census placeholder names we have actually seen, and what each means in
 * plain words (item 6b, 2026-08-15). Extended only when a new one is SEEN —
 * a mapping for a string nobody has met is a guess. The committed geometry's
 * labels are rewritten by `scripts/normalize-census-placeholders.mts`; a
 * registry promotion translates a division's label the same way.
 */
export const CENSUS_PLACEHOLDER_LABELS: Readonly<Record<string, string>> = {
  "School District Not Defined": "No unified school district here",
};

export function isCensusPlaceholderDivision(division: { readonly ocdId: string; readonly divisionType?: string | null; readonly geoid?: string | null }): boolean {
  if (division.divisionType !== undefined && division.divisionType !== null && division.divisionType !== "school_district") return false;
  if (typeof division.geoid === "string") return /^\d{2}99997$/.test(division.geoid);
  return /\/school_district:school_district_not_defined$/.test(division.ocdId);
}
