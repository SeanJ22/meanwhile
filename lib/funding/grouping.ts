import type { ContributionRow } from "./types.ts";

/**
 * The money's own order: rows grouped by kind (committees and organizations;
 * individual itemized donors), each sorted by amount descending. Repeated
 * filings from one contributor fold into one row with the summed amount and
 * a count; the filings are kept. A joint-fundraising transfer stays a
 * transfer: the count noun comes from the FEC form line, never a guess.
 *
 * Client-safe: types and arithmetic only.
 */

/** FEC Form 3, line 12 — "Transfers From Other Authorized Committees". */
const TRANSFER_LINE = "12";

export interface ContributorGroup {
  /** Stable across renders and asserted in tests; never shown to a reader. */
  key: string;
  contributorName: string;
  city: string | null;
  state: string | null;
  kind: ContributionRow["kind"];
  /** The summed amount across `filings` — plain addition, never rounded. */
  amount: number;
  /** How many filings folded in. 1 means nothing was collapsed. */
  count: number;
  /**
   * The noun the count line uses, derived from the FEC form line and
   * nothing else: every folded filing on line 12 makes these transfers;
   * anything else is contributions.
   */
  countNoun: "transfers" | "contributions";
  /** The filings as filed, largest first. Never dropped, only folded. */
  filings: ContributionRow[];
  entityType: string | null;
  lineNumber: string | null;
  committeeType: string | null;
  organizationType: string | null;
  designation: string | null;
  /** The contributing committee's own FEC id, when it filed as a committee. */
  contributorCommitteeId: string | null;
}

export interface ContributorGroups {
  /** Committees and organizations, amount descending. */
  organizations: ContributorGroup[];
  /** Individual itemized donors, amount descending. */
  individuals: ContributorGroup[];
}

/** Identity for folding: the same filer, at the same filed address. */
function identityKey(row: ContributionRow): string {
  const name = row.contributorName.trim().toUpperCase().replace(/\s+/g, " ");
  return [row.kind, name, row.city ?? "", row.state ?? ""].join("|");
}

/** Amount descending, with a deterministic tiebreak so the rendered order is reproducible. */
function byAmountDesc<T extends { amount: number; contributorName: string }>(
  a: T,
  b: T,
): number {
  if (b.amount !== a.amount) return b.amount - a.amount;
  return a.contributorName.localeCompare(b.contributorName);
}

export function groupContributions(rows: ContributionRow[]): ContributorGroups {
  const byIdentity = new Map<string, ContributionRow[]>();
  for (const row of rows) {
    const key = identityKey(row);
    const list = byIdentity.get(key);
    if (list) list.push(row);
    else byIdentity.set(key, [row]);
  }

  const groups: ContributorGroup[] = [];
  for (const [key, filings] of byIdentity) {
    const sorted = [...filings].sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return (b.receiptDate ?? "").localeCompare(a.receiptDate ?? "");
    });
    const lead = sorted[0];
    groups.push({
      key,
      contributorName: lead.contributorName,
      city: lead.city,
      state: lead.state,
      kind: lead.kind,
      amount: sorted.reduce((sum, r) => sum + r.amount, 0),
      count: sorted.length,
      countNoun: sorted.every((r) => r.lineNumber === TRANSFER_LINE)
        ? "transfers"
        : "contributions",
      filings: sorted,
      entityType: lead.entityType,
      lineNumber: lead.lineNumber,
      committeeType: lead.committeeType,
      organizationType: lead.organizationType,
      designation: lead.designation,
      contributorCommitteeId: lead.contributorCommitteeId ?? null,
    });
  }

  return {
    organizations: groups
      .filter((g) => g.kind === "COMMITTEE_OR_ORGANIZATION")
      .sort(byAmountDesc),
    individuals: groups.filter((g) => g.kind === "INDIVIDUAL").sort(byAmountDesc),
  };
}
