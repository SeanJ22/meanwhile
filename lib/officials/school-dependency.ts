import dependency from "@/data/derived/school-district-dependency.json";

/** Independent district, dependent system, or not yet classified; a dependent system has no board you elect. */
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

/** A district with no entry reads `UNCLASSIFIED`, never a licence to assume. */
export function schoolDependency(ocdId: string | null): SchoolDependency {
  if (!ocdId) return "UNCLASSIFIED";
  return STAMP[ocdId] ?? "UNCLASSIFIED";
}
