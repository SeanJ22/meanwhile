import {
  committeeTypeLabelFor,
  type CommitteeTypeLabel,
} from "./committee-types.ts";
import type { ContributionRow } from "./types.ts";

/**
 * What kind of money one contribution row is: the single derivation, from the
 * FEC's own entity and committee typing, never from the name. A candidate's
 * own money (entity CAN, or a line 13A loan) renders as such; unknown codes
 * fall to the honest generic; individuals get no suffix. `contributorBand`
 * and `plainContributorLabel` both read this one ladder.
 *
 * Client-safe: kept out of display.ts, which is on the node:fs graph.
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
 * The FEC's own entity-type codes, for a filer typed as an organization, a
 * committee or a candidate's committee with no `committee_type` filed.
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
  //    is where conduit platforms and county party committees live.
  const byEntity = row.entityType ? ENTITY_TYPE_BANDS[row.entityType] : undefined;
  if (byEntity) return byEntity;

  // 5. Nothing filed at all: on the committee side a named gap, on the
  //    individual side a person, as the caller's `kind` says. No typing and no
  //    kind is treated as the gap.
  if (row.kind === "INDIVIDUAL") return null;
  return {
    id: UNFILED_BAND_ID,
    // The gap's own register: a fact about the filing, not about the filer.
    label: "a committee whose filing doesn't state its type",
  };
}

/**
 * The plain suffix beside a contributor's name: the ladder above, except that
 * a committee-side row with no typing keeps the short generic ("committee or
 * organization"), since it sits inline after a name.
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
/**
 * The typed label for a contributing committee, or null when the filing
 * carries no typing. Returns the whole record (label, explainer, FEC source).
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
