import held from "../../data/states/az/meetings/notice-summaries.json" with { type: "json" };
/**
 * Curated plain-language summaries of meeting notices, written only from the official text they cite. Keyed by meeting
 * id and the document's content hash, so a revised notice stops rendering its stale summary.
 */

export interface NoticeSummary {
  meetingId: string;
  /** SHA-256 of the summarized document version — the exact-text citation. */
  contentHash: string;
  /** Where that document lives. */
  summarizesUrl: string;
  /** The 15-year-old register: what the notice says will happen. */
  summary: string;
  writtenAt: string;
}

export const NOTICE_SUMMARIES: NoticeSummary[] = held.records.NOTICE_SUMMARIES;

export function noticeSummaryFor(
  meetingId: string,
  contentHash: string,
): NoticeSummary | null {
  return (
    NOTICE_SUMMARIES.find(
      (s) => s.meetingId === meetingId && s.contentHash === contentHash,
    ) ?? null
  );
}
