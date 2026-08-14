import billSummaries from "../../data/votes/bill-summaries.json" with { type: "json" };

/**
 * Curated plain-language bill summaries (item 4, 2026-08-16) — the Prop 142
 * pattern applied to the vote window. Each summary paraphrases the CRS
 * summary its `basis` cites; the official record stays one click away on
 * the vote row. A bill in `pending` renders the honest coming state with
 * its reason recorded in the data file — the vote row is never blocked.
 *
 * Refresh discipline: the window rolls with `pnpm votes:fetch`, which
 * prints every bill in the new window that has no summary here. New bills
 * are curated by hand — never generated, never filled from anything but a
 * CRS summary that matches the text voted on (H.R. 5334 is the case that
 * makes the match check load-bearing: its number was reused as a vehicle
 * and the on-file CRS summary describes a different act).
 */

export interface BillSummary {
  legisNum: string;
  title: string;
  summary: string;
  basis: string;
  curatedAt: string;
}

interface BillSummariesFile {
  curatedAt: string;
  summaries: Record<string, BillSummary>;
  pending: { billUrl: string; legisNum: string; title: string; reason: string }[];
}

const data = billSummaries as unknown as BillSummariesFile;

export function summaryForBill(billUrl: string | null): BillSummary | null {
  if (!billUrl) return null;
  return data.summaries[billUrl] ?? null;
}

/** True when the bill is known and its summary is honestly still pending. */
export function summaryPendingForBill(billUrl: string | null): boolean {
  if (!billUrl) return false;
  return data.pending.some((p) => p.billUrl === billUrl);
}

export function allBillSummaries(): BillSummariesFile {
  return data;
}
