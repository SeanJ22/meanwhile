/** A reader's reply address never leaves this module: the view is told only whether one was left. No delete or edit path. */
import { readFeedback, type FeedbackSite } from "../../db/feedback.ts";

export interface ReportRow {
  readonly id: string;
  readonly receivedAt: string;
  readonly site: FeedbackSite;
  readonly message: string;
  readonly surface: string;
  readonly origin: "reader" | "owner test" | "automated test" | "unclassified";
  readonly about: string | null;
  readonly zip: string | null;
  readonly recordId: string | null;
  readonly suspectReason: string | null;
  readonly hasReplyAddress: boolean;
}

export type SiteReports =
  | { readonly site: FeedbackSite; readonly kind: "READ"; readonly rows: readonly ReportRow[]; readonly total: number }
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
        const found = await readFeedback({ since: "1970-01-01T00:00:00.000Z", site });
        const rows = found.slice(0, REPORTS_SHOWN_PER_SITE).map((row): ReportRow => {
          const extra = row as unknown as Record<string, unknown>;
          return {
            id: String(row.id),
            receivedAt: new Date(row.receivedAt as string | Date).toISOString(),
            site,
            message: String(row.message ?? ""),
            surface: String(row.surface ?? ""),
            origin: ORIGIN_WORDS[String(row.runClass ?? "")] ?? "unclassified",
            about: text(extra.about),
            zip: text(extra.zip),
            recordId: text(extra.recordId),
            suspectReason: text(row.suspectReason),
            hasReplyAddress: text(row.replyAddress) !== null,
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
