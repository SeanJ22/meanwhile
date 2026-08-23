import type { CoveredBody } from "@/lib/registry/coverage.ts";
import type { BodyClass, DivisionType } from "@/lib/registry/types.ts";
import { tierForOcdId, type Tier } from "@/lib/ocd/tiers.ts";

/**
 * **RESOLVING AN AUTOCOMPLETE BODY ROW TO A BODY.** (`PU02` / `M135`, NJ Hunt 4
 * item 3, 2026-08-22.)
 *
 * ## The defect, measured rather than described
 *
 * M135's rule is that selecting a body ANYWHERE opens that body's large card.
 * The handler in `components/map/map-entry.tsx` resolved a row by matching the
 * row's label against `CoveredBody.name` on the same division, and opened
 * nothing when that failed — deliberately, because opening one body's card from
 * another body's row is a false claim about a government.
 *
 * The refusal was right. The MATCHER was far too narrow, and the walk found the
 * symptom (the first body row opens nothing) rather than the size. Read off
 * production on 2026-08-22, first five body rows per zip:
 *
 * | zip | rows that opened a card |
 * | --- | --- |
 * | `07866` | 5 of 5 |
 * | `85641` | 2 of 5 |
 * | `85701` | 1 of 5 |
 * | `03255` | **0 of 5** |
 *
 * The name match itself succeeded **once** across all twenty. Everything that
 * opened, opened through the `candidates.length === 1` fallback — which is to
 * say the name comparison was doing no work at all. Three distinct causes:
 *
 * 1. **The two strings are the same name written differently.** The row label
 *    comes from the meetings snapshot (`Meeting.bodyName`, whatever the portal
 *    published); the registry name comes from a hunt that read the body's own
 *    page. `Board of Adjustment` against `Board of Adjustment (BAJ)`;
 *    `Selectboard` against `Select Board`. A reader would call those identical.
 * 2. **The division carries many bodies and none matched.** `place:tucson`
 *    carries 58, `place:newbury_town` 18. Ambiguous, so nothing opened.
 * 3. **The division carries NO coverage body at all** — Sutton, Wilmot, Warner,
 *    Amphitheater Unified, Sunnyside Unified. The meeting is held, the row is
 *    offered, and the registry has no body row on that division to open.
 *
 * Cause 3 is the one that shows the fix cannot live in the matcher. There is
 * nothing to match against, and there is still a body: the reader clicked a row
 * naming it, and this product holds its meetings.
 *
 * ## What this module does
 *
 * `resolveBodyRow` tries the registry, in order, and says HOW it resolved so a
 * caller and a test can tell a strict match from a normalised one:
 *
 * - `exact` — the label equals the registry name.
 * - `normalised` — they are the same name written differently (see `sameName`).
 * - `only-body-on-division` — one body on the division, so the row can only
 *   mean that one. This is the pre-existing fallback, kept and named.
 *
 * When none of those resolve, `bodyFromRow` builds a body **out of the row
 * itself**. That is not a guess and it is not the wrong card: the name is the
 * name the reader clicked, the division is the division the meeting was filed
 * under, and the meetings are that body's meetings. What it does NOT carry is a
 * roster, a homepage or a contact — and those render as their named gaps,
 * exactly as they do for any body the registry holds but has not hunted.
 *
 * The row-built body is deliberately NOT written into the registry and never
 * reaches a count: it exists for the duration of one card, so no coverage
 * denominator can be inflated by a reader clicking something.
 */

/** How a row resolved. Named so a test can assert the matcher does real work. */
export type BodyRowMatch = "exact" | "normalised" | "only-body-on-division";

export interface ResolvedBodyRow {
  body: CoveredBody;
  how: BodyRowMatch;
}

/**
 * Two names for the same body, written differently.
 *
 * Case, spacing and punctuation are dropped; a TRAILING PARENTHETICAL is
 * dropped, because Tucson's registry names carry the board's acronym after the
 * name (`Board of Adjustment (BAJ)`) and the portal's do not; a leading `The`
 * is dropped. Nothing else — this is a normaliser, not a fuzzy matcher, and a
 * fuzzy matcher here would open the wrong body's card, which is the failure the
 * refusal exists to prevent.
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
 * A body built from the row the reader clicked, for the case where the registry
 * holds nothing on that division.
 *
 * **Every field here is READ, never inferred.** The name is the row's label, the
 * division is the row's OCD-ID, the label is the jurisdiction the meeting was
 * published under, and the tier is computed from the OCD-ID by the same function
 * every other surface uses. Nothing is filled in: `homepageUrl`,
 * `agendaSourceRef` are null and `lookedAt` is false, so the card renders those
 * as the gaps they are rather than as findings.
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
    // A search row carries no Census LSAD — the row came from a search index,
    // not from a boundary file. Null is the honest value and it means the
    // definitions library falls back to the generic municipality class rather
    // than claiming this is a township.
    lsad: null,
    /*
     * `BodyClass` has no "we are not saying" member, and every member it does
     * have is a CLAIM: GOVERNING, ADVISORY, COMMISSION, REGIONAL and
     * PRIVATE_ASSOCIATION each say something specific about a real body. This
     * row's class is genuinely unknown — the meetings snapshot does not carry
     * one — so the least-claiming member that is true of anything with a public
     * meeting is ADVISORY... which is still a claim, and a wrong one for a
     * school board.
     *
     * So the honest resolution is COMMISSION-free: the class is carried as
     * whatever the DIVISION implies, which is a fact about the division rather
     * than an assertion about the body. A school district's meeting body is a
     * governing board; everything else stays ADVISORY, the weakest claim
     * available, and the card's Type row reads from `BODY_TYPE_LABEL` which
     * leads with the division type in both cases.
     */
    bodyClass: (divisionType === "school_district" ? "GOVERNING" : "ADVISORY") as BodyClass,
    /*
     * LIVE, and it is READ rather than assumed: this row exists BECAUSE an
     * adapter produced a meeting for it in the committed snapshot. Saying
     * NOT_ATTEMPTED next to a list of that body's sittings would be the render
     * default manufacturing a claim in the other direction.
     */
    coverageStatus: "LIVE",
    homepageUrl: null,
    agendaSourceRef: null,
    lookedAt: false,
    tier: tierForOcdId(row.ocdId) as Tier,
  };
}
