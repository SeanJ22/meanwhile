import {
  committeeTypeLabelFor,
  type CommitteeTypeLabel,
} from "./committee-types.ts";
import type { ContributionRow } from "./types.ts";

/**
 * **What kind of money one contribution row is — the single derivation.**
 *
 * The plain suffix for a contributor row, mechanically derived from the
 * FEC's own entity typing — never from the name (2a, 2026-08-19). A
 * candidate lending or giving to their own campaign files as entity CAN
 * (or line 13A for candidate loans), and that renders as what it is: the
 * candidate's own money. Unknown codes fall back to the honest generic
 * rather than a guess; individuals get no suffix, as before.
 *
 * Lives in its own module — NOT display.ts — because the client-side
 * funding section renders these labels and display.ts sits on the
 * node:fs snapshot graph. The first placement broke the browser build
 * exactly the way lib/meetings/constants.ts warns about.
 *
 * ## Why the ladder is a function and not two copies (2026-08-19, g20)
 *
 * D06's concentration bands needed the same question answered — "what kind
 * of filer is this?" — and the first draft asked `committeeTypeLabelFor`
 * directly, skipping the two steps above it. Reading the real snapshot is
 * what caught it, and what it caught was not cosmetic:
 *
 * - **Seven of twenty-one candidates** had rows land in the unfiled bucket.
 * - Lily Tang Williams' **$80,000 of her own money** (entity CAN, line 13A)
 *   would have rendered as "a committee whose filing doesn't state its
 *   type" — a false claim about a filing that states its type perfectly
 *   well, attached to the largest number on her card.
 * - ActBlue, WinRed, the Camden County Republican Committee and a
 *   candidate's own second committee file entity types (ORG, COM, CCM) and
 *   no committee type. The FEC classified them; only the committee table
 *   does not reach them.
 *
 * So the ladder lives here once, `contributorBand` is what both surfaces
 * call, and `plainContributorLabel` is the same ladder's label. A second
 * implementation of this question is the defect, not the fix.
 */

/** The band id for a candidate's own money — not a committee category. */
export const OWN_MONEY_BAND_ID = "candidates-own-money";
/** The band id for a row whose filing carries no typing the FEC published. */
export const UNFILED_BAND_ID = "unfiled-typing";

/**
 * One rung of the ladder: a stable id and the label as rendered, lowercase,
 * to sit inside a sentence.
 */
export interface ContributorBand {
  id: string;
  label: string;
}

/**
 * The FEC's own entity-type codes, and the plain words for each. These are
 * the rung BELOW the committee table: a filer the FEC typed as an
 * organization, a committee or a candidate's committee, but for which no
 * `committee_type` was filed. Rendering these as "not stated" would be our
 * gap wearing the filing's clothes.
 */
const ENTITY_TYPE_BANDS: Readonly<Record<string, ContributorBand>> = {
  CCM: { id: "entity-ccm", label: "a candidate's campaign committee" },
  PAC: { id: "entity-pac", label: "a political action committee" },
  PTY: { id: "entity-pty", label: "a party committee" },
  ORG: { id: "entity-org", label: "an organization" },
  COM: { id: "entity-com", label: "a committee" },
};

/** Every id `contributorBand` can return that is not a committee-table id. */
export const NON_TABLE_BAND_IDS: readonly string[] = [
  OWN_MONEY_BAND_ID,
  UNFILED_BAND_ID,
  ...Object.values(ENTITY_TYPE_BANDS).map((b) => b.id),
];

/**
 * **The ladder.** Read in order; each rung reads filed fields and nothing
 * else. Returns null only for an individual donor with no committee typing
 * — a person, who gets no suffix and belongs in no committee band.
 */
export function contributorBand(row: {
  kind?: ContributionRow["kind"];
  entityType?: string | null;
  lineNumber?: string | null;
  committeeType?: string | null;
  organizationType?: string | null;
  designation?: string | null;
}): ContributorBand | null {
  // 1. The candidate's own money. Filed as entity CAN, or as a line 13A
  //    candidate loan. This is not a committee category and must never be
  //    typed by the committee table.
  if (row.entityType === "CAN" || row.lineNumber === "13A") {
    return { id: OWN_MONEY_BAND_ID, label: "the candidate's own money" };
  }

  // 2. The contributing committee's own filed typing, where it filed one.
  //    Every label this can return lives in COMMITTEE_TYPE_LABELS.
  if (row.entityType !== "IND") {
    const typed = committeeTypeLabelFor({
      committeeType: row.committeeType ?? null,
      organizationType: row.organizationType ?? null,
      designation: row.designation ?? null,
    });
    if (typed) return { id: typed.id, label: typed.label };
  }

  // 3. An individual person. No suffix, no band.
  if (row.entityType === "IND") return null;

  // 4. The FEC's entity typing, where the committee typing is absent. This
  //    is where ActBlue, WinRed and a county party committee live.
  const byEntity = row.entityType ? ENTITY_TYPE_BANDS[row.entityType] : undefined;
  if (byEntity) return byEntity;

  // 5. Nothing filed at all. On the committee side that is a named gap; on
  //    the individual side it is just a person, and the caller's `kind`
  //    says which. A row with no typing and no kind is treated as the gap,
  //    because asserting "a person" from an absence would be the same
  //    manufactured claim in the other direction.
  if (row.kind === "INDIVIDUAL") return null;
  return {
    id: UNFILED_BAND_ID,
    // The gap's own register: a fact about the filing, not about the filer.
    label: "a committee whose filing doesn't state its type",
  };
}

/**
 * The plain suffix beside a contributor's name. The ladder above, rendered
 * — with one difference the surface needs: a committee-side row with no
 * typing at all keeps the pre-2a generic ("committee or organization")
 * rather than the band's longer sentence, because it sits inline after a
 * name rather than in a list of categories.
 */
export function plainContributorLabel(row: {
  kind: ContributionRow["kind"];
  entityType: string | null;
  lineNumber: string | null;
  committeeType?: string | null;
  organizationType?: string | null;
  designation?: string | null;
}): string | null {
  const band = contributorBand(row);
  if (!band) return null;
  if (band.id === UNFILED_BAND_ID) {
    return row.kind === "COMMITTEE_OR_ORGANIZATION"
      ? "committee or organization"
      : null;
  }
  return band.label;
}

/**
 * The typed label for a contributing committee, or null when the filing
 * carries no typing (individuals, and rows from before item 6's capture).
 *
 * Exported separately from the string above because the surface needs the
 * whole record — the label to render AND the two-sentence explainer with
 * its FEC source — and a bare string cannot carry those.
 */
export function contributorTypeLabel(row: {
  entityType?: string | null;
  committeeType?: string | null;
  organizationType?: string | null;
  designation?: string | null;
}): CommitteeTypeLabel | null {
  // A candidate's own money is not a committee type; it is answered above
  // and must never be relabeled by the committee table.
  if (row.entityType === "IND" || row.entityType === "CAN") return null;
  return committeeTypeLabelFor({
    committeeType: row.committeeType ?? null,
    organizationType: row.organizationType ?? null,
    designation: row.designation ?? null,
  });
}
