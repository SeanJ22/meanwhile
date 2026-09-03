import held from "../../data/states/az/meetings/notice-summaries.json" with { type: "json" };
/**
 * Hand-curated plain-language summaries of meeting notices (4d) — the
 * sibling of lib/ballot/measure-summary.ts, under the same rules:
 * written ONLY from the official text they cite, what-it-covers never
 * whether-it's-good, rendered ABOVE the official text and clearly labeled,
 * never replacing it.
 *
 * Keyed by meeting id AND the document's content hash: a summary describes
 * one exact version of one notice. When the body revises its page the hash
 * changes and the summary silently stops rendering — an out-of-date
 * summary above a changed notice would be the match-then-deny defect
 * inverted, so absence is the safe failure. tests/notice-summaries.test.ts
 * asserts every row's citation resolves against the committed snapshot.
 *
 * The generated-at-runtime version belongs to the natural-language track
 * and its A07 gates; these are curated rows.
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
