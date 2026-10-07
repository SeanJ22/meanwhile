/**
 * A Census placeholder is geography, never a government. TIGER writes one placeholder per state into
 * each school-district layer (LEA code 99997, "School District Not Defined"). The division stays, but no
 * body may be minted on it. Identified by the Census code; the committed slug is the fallback for a row
 * with no GEOID.
 */
export const CENSUS_PLACEHOLDER_BODY_ISSUE = "BODY_ON_CENSUS_PLACEHOLDER_DIVISION";

/**
 * The Census placeholder names seen so far, in plain words. Extend only when a new one is seen. A
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

/**
 * A registry as anything that counts or emits bodies must read it: every division stays (a placeholder
 * is real geography), and no body minted on a Census placeholder survives.
 */
export function withoutPlaceholderBodies<
  R extends {
    readonly divisions: readonly { readonly ocdId: string; readonly divisionType?: string | null; readonly geoid?: string | null }[];
    readonly bodies: readonly { readonly ocdId: string | null }[];
  },
>(registry: R): R {
  const placeholders = new Set(registry.divisions.filter((division) => isCensusPlaceholderDivision(division)).map((division) => division.ocdId));
  return { ...registry, bodies: registry.bodies.filter((body) => body.ocdId === null || !placeholders.has(body.ocdId)) };
}
