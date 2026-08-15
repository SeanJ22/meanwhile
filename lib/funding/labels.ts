import {
  committeeTypeLabelFor,
  type CommitteeTypeLabel,
} from "./committee-types.ts";
import type { ContributionRow } from "./types.ts";

/**
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
 */
export function plainContributorLabel(row: {
  kind: ContributionRow["kind"];
  entityType: string | null;
  lineNumber: string | null;
  committeeType?: string | null;
  organizationType?: string | null;
  designation?: string | null;
}): string | null {
  if (row.entityType === "CAN" || row.lineNumber === "13A") {
    return "the candidate's own money";
  }
  // Item 6 (2026-08-14): where the contributing committee filed its own
  // typing, that is the more specific true thing and it wins. Every label
  // it can return lives in COMMITTEE_TYPE_LABELS and nowhere else.
  const typed = contributorTypeLabel(row);
  if (typed) return typed.label;
  switch (row.entityType) {
    case "IND":
      return null;
    case "CCM":
      return "a candidate's campaign committee";
    case "PAC":
      return "a political action committee";
    case "PTY":
      return "a party committee";
    case "ORG":
      return "an organization";
    case "COM":
      return "a committee";
    default:
      // No entity typing on the row (older snapshot or unfiled) — keep the
      // pre-2a generic for the non-individual bucket.
      return row.kind === "COMMITTEE_OR_ORGANIZATION"
        ? "committee or organization"
        : null;
  }
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
