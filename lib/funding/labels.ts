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
}): string | null {
  if (row.entityType === "CAN" || row.lineNumber === "13A") {
    return "the candidate's own money";
  }
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
