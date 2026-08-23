import dependency from "@/data/derived/school-district-dependency.json";

/**
 * **INDEPENDENT DISTRICT, DEPENDENT SYSTEM, OR NOT YET CLASSIFIED.**
 * (DEF-2, 2026-08-22, the author's 8/22 walkthrough, item 11.)
 *
 * The read side of `pnpm schools:classify`. It answers one question and it has
 * three answers, which is the whole point:
 *
 * - **`INDEPENDENT`** — a government in its own right, with an elected board
 *   and its own budget.
 * - **`DEPENDENT`** — a department of a city, county or state government. It
 *   has **no board you elect**, and telling a reader otherwise would send them
 *   to vote in an election that does not exist.
 * - **`UNCLASSIFIED`** — the Census classification has no match for this
 *   district. It renders NO class definition rather than the likelier of the
 *   two, because a base rate is not evidence about a reader's own schools.
 *
 * The stamp comes from the 2022 Census of Governments' own classification via
 * `data/derived/census-nces-crosswalk.csv`, never from the district's name.
 */
export type SchoolDependency = "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";

const STAMP = (dependency as { stamp: Record<string, SchoolDependency> }).stamp;

export const SCHOOL_DEPENDENCY_TOTALS = (
  dependency as {
    totals: {
      total: number;
      independent: number;
      dependent: number;
      unclassified: number;
      pseudoEntitiesSkipped: number;
    };
  }
).totals;

/**
 * A district with no entry reads `UNCLASSIFIED`, which is the same answer a
 * district that failed to match gets — and deliberately so. Both mean *we have
 * not established what kind of school system this is*, and neither is a licence
 * to assume.
 */
export function schoolDependency(ocdId: string | null): SchoolDependency {
  if (!ocdId) return "UNCLASSIFIED";
  return STAMP[ocdId] ?? "UNCLASSIFIED";
}
