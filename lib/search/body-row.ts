import type { CoveredBody } from "@/lib/registry/coverage.ts";
import type { BodyClass, DivisionType } from "@/lib/registry/types.ts";
import { tierForOcdId, type Tier } from "@/lib/ocd/tiers.ts";

/**
 * Resolving an autocomplete body row to a body, so selecting a body anywhere opens that body's card.
 * `resolveBodyRow` tries the registry in order and says how it resolved:
 * - `exact`: the label equals the registry name.
 * - `normalised`: the same name written differently (see `sameName`).
 * - `only-body-on-division`: the only body on the division.
 * When none resolve, `bodyFromRow` builds a body from the row itself: the name the reader clicked, the
 * division the meeting was filed under. It carries no roster, homepage or contact (those render as named
 * gaps), is never written into the registry, and never reaches a count.
 */

/** How a row resolved. Named so a test can assert the matcher does real work. */
export type BodyRowMatch = "exact" | "normalised" | "only-body-on-division";

export interface ResolvedBodyRow {
  body: CoveredBody;
  how: BodyRowMatch;
}

/**
 * Two names for the same body, written differently: case, spacing and punctuation are dropped, as are a
 * trailing parenthetical (an acronym) and a leading `The`. A normaliser, not a fuzzy matcher: a fuzzy
 * match could open the wrong body's card.
 */
export function normaliseBodyName(raw: string): string {
  return raw
    .replace(/\s*\([^()]*\)\s*$/, "")
    .replace(/^\s*the\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Whether two body names are the same name written differently. */
export function sameName(a: string, b: string): boolean {
  const na = normaliseBodyName(a);
  const nb = normaliseBodyName(b);
  return na.length > 0 && na === nb;
}

/**
 * The registry body a row means, or null when the registry cannot say.
 *
 * Null is not a failure to be papered over — it is the honest state that
 * `bodyFromRow` then answers, and keeping the two apart is what lets a test see
 * which of the two paths a row took.
 */
export function resolveBodyRow(
  row: { label: string; ocdId: string | null },
  bodies: readonly CoveredBody[],
): ResolvedBodyRow | null {
  if (row.ocdId === null) return null;
  const onDivision = bodies.filter((b) => b.ocdId !== null && b.ocdId === row.ocdId);
  if (onDivision.length === 0) return null;

  const exact = onDivision.filter((b) => b.name === row.label);
  if (exact.length === 1) return { body: exact[0], how: "exact" };

  const normalised = onDivision.filter((b) => b.name !== null && sameName(b.name, row.label));
  if (normalised.length === 1) return { body: normalised[0], how: "normalised" };

  if (onDivision.length === 1) return { body: onDivision[0], how: "only-body-on-division" };
  return null;
}

/** The division layer an OCD-ID names, for a row the registry does not hold. */
function divisionTypeFor(ocdId: string): DivisionType {
  if (/\/school_district:/.test(ocdId)) return "school_district";
  if (/\/place:/.test(ocdId)) return "place";
  if (/\/cd:/.test(ocdId)) return "cd";
  if (/\/sldu:/.test(ocdId)) return "sldu";
  if (/\/sldl:/.test(ocdId)) return "sldl";
  return "county";
}

/**
 * A body built from the row the reader clicked, when the registry holds nothing on that division. Every
 * field is read, never inferred; `homepageUrl` and `agendaSourceRef` are null and `lookedAt` is false, so
 * the card renders them as gaps.
 */
export function bodyFromRow(row: {
  label: string;
  ocdId: string;
  jurisdiction: string;
}): CoveredBody {
  const divisionType = divisionTypeFor(row.ocdId);
  return {
    bodyId: `${row.ocdId}#row:${normaliseBodyName(row.label)}`,
    ocdId: row.ocdId,
    name: row.label,
    divisionLabel: row.jurisdiction,
    divisionType,
    // A search row carries no Census LSAD, so the definitions fall back to the generic municipality class.
    lsad: null,
    // This module is on the client graph, so it does not import the school-dependency table; the full
    // covered body carries the real value, stamped on the server in lib/registry/coverage.ts.
    schoolDependency: "UNCLASSIFIED",
    // The row's class is unknown, so it is what the division implies: a school district's meeting body is a
    // governing board; everything else stays ADVISORY, the weakest claim available.
    bodyClass: (divisionType === "school_district" ? "GOVERNING" : "ADVISORY") as BodyClass,
    // LIVE, because this row exists only because an adapter produced a meeting for it.
    coverageStatus: "LIVE",
    homepageUrl: null,
    agendaSourceRef: null,
    lookedAt: false,
    tier: tierForOcdId(row.ocdId) as Tier,
  };
}
