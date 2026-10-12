/**
 * Donor rendering is aggregate only. No individual donor name or address
 * reaches public DTOs, for FEC or state data: filing totals and the source
 * reported small-donor share only. This is a serialization boundary;
 * filings are held with provenance intact. Organizations (committees, PACs,
 * parties, corporations) render as filed. Rows are folded, not anonymised: an
 * amount, a city and a date are re-identifiable without a name.
 *
 * Client-safe: types and arithmetic only.
 */

import type { ContributorGroup } from "./grouping.ts";

/** Is this group allowed to render with its filed name? Both render sites ask this. */
export function mayRenderFiledName(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}

/**
 * Is this group allowed to render a place? Asked separately: a city plus an
 * amount plus a date is re-identifiable without a name.
 */
export function mayRenderFiledLocation(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}
