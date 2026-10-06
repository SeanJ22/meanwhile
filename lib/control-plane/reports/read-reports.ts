/**
 * **"REPORT A PROBLEM" SUBMISSIONS, FOR THE COMMAND CENTER'S REPORTS VIEW.**
 *
 * Reads one bounded page per site from S6's feedback store, (the feedback store,
 * `FEEDBACK_DATABASE_URL` when set), labeled by the site each came from. A reader's
 * reply address is contact data and is never selected: the view is told only
 * whether one was left. There is no delete or edit path anywhere in this reading.
 *
 * `about`, `zip` and `recordId` are the card the reader reported (S6, #490); a store
 * that does not carry them yet answers `null` for each and the view says so.
 */
import { feedbackConnection, type FeedbackSite } from "../../db/feedback.ts";

import { neon } from "@neondatabase/serverless";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { Sql } from "../repository/pg-store.ts";

export interface ReportRow {
  readonly id: string;
  readonly receivedAt: string;
  readonly site: FeedbackSite;
  readonly message: string;
  readonly surface: string;
  /** Who wrote it: a reader, or one of our own test runs. */
  readonly origin: "reader" | "owner test" | "automated test" | "unclassified";
  readonly about: string | null;
  readonly zip: string | null;
  readonly recordId: string | null;
  readonly suspectReason: string | null;
  readonly hasReplyAddress: boolean;
}

export type SiteReports =
  | { readonly site: FeedbackSite; readonly kind: "READ"; readonly rows: readonly ReportRow[]; /** Visible rows plus at most one older-row sentinel; never a full-store count. */ readonly total: number }
  | { readonly site: FeedbackSite; readonly kind: "UNREADABLE"; readonly says: string };

export interface ReportsReading {
  readonly observedAt: string;
  readonly sites: readonly SiteReports[];
}

/** The newest this many per site; the rest are in the store. */
export const REPORTS_SHOWN_PER_SITE = 100;

const ORIGIN_WORDS: Readonly<Record<string, ReportRow["origin"]>> = {
  ORGANIC: "reader",
  AUTHOR: "owner test",
  SYNTHETIC: "automated test",
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export async function readReports(observedAt: string): Promise<ReportsReading> {
  const sites: FeedbackSite[] = ["live", "tester"];
  const reads = await Promise.all(
    sites.map(async (site): Promise<SiteReports> => {
      try {
        const connection=feedbackConnection();if(!connection)throw new Error("The reader reports store is not configured.");
        // One page and a sentinel, with no address or contact handle leaving the store.
        const found=await boundedQuery(neon(connection) as Sql,{operation:"feedback.admin_recent",callClass:"PAGE"},
          `SELECT id, received_at AS "receivedAt", message, surface, site, run_class AS "runClass", about, zip, record_id AS "recordId", suspect_reason AS "suspectReason", (contact_ref IS NOT NULL) AS "hasReplyAddress" FROM feedback WHERE site=$1 ORDER BY received_at DESC,id DESC LIMIT ${REPORTS_SHOWN_PER_SITE+1}`,[site]) as readonly Record<string,unknown>[];
        const rows = found.slice(0, REPORTS_SHOWN_PER_SITE).map((row): ReportRow => {
          const extra = row as unknown as Record<string, unknown>;
          return {
            id: String(row.id),
            receivedAt: new Date(row.receivedAt as string).toISOString(),
            site,
            message: String(row.message ?? ""),
            surface: String(row.surface ?? ""),
            origin: ORIGIN_WORDS[String(row.runClass ?? "")] ?? "unclassified",
            about: text(extra.about),
            zip: text(extra.zip),
            recordId: text(extra.recordId),
            suspectReason: text(row.suspectReason),
            hasReplyAddress: row.hasReplyAddress === true,
          };
        });
        return { site, kind: "READ", rows, total: found.length };
      } catch (error) {
        return { site, kind: "UNREADABLE", says: `The ${site} reports could not be read (${error instanceof Error ? error.message : "error"}).` };
      }
    }),
  );
  return { observedAt, sites: reads };
}
