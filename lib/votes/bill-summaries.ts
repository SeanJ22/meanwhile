import { getFederalVotesReadModel } from "./snapshot.ts";

/** Reviewed explanatory content carried beside the promoted official bill identity. */
export interface BillSummary {
  readonly legisNum: string;
  readonly title: string;
  readonly summary: string;
  readonly basis: string;
  readonly curatedAt: string;
}

export interface BillSummariesFile {
  readonly curatedAt: string;
  readonly note?: string;
  readonly summaries: Record<string, BillSummary>;
  readonly pending: readonly { readonly billUrl: string; readonly legisNum: string; readonly title: string; readonly reason: string }[];
}

/** The lookup is over the initialized canonical projection, never tracked JSON. */
export function summaryForBill(billUrl: string | null): BillSummary | null {
  if (!billUrl) return null;
  return getFederalVotesReadModel().billSummaries.summaries[billUrl] ?? null;
}

export function summaryPendingForBill(billUrl: string | null): boolean {
  if (!billUrl) return false;
  return getFederalVotesReadModel().billSummaries.pending.some((pending) => pending.billUrl === billUrl);
}
