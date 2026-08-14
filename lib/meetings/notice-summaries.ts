/**
 * Hand-curated plain-language summaries of meeting notices (4d) — the
 * sibling of lib/ballot/measure-summaries.ts, under the same rules:
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

export const NOTICE_SUMMARIES: NoticeSummary[] = [
  {
    meetingId: "diligent:tusd1:493",
    contentHash:
      "afbbca07a6910525e545c94156982a078aeed9f8e8e9ec31d48114c052457e58",
    summarizesUrl: "https://govboard.tusd1.org/",
    summary:
      "The TUSD Governing Board holds a special meeting Tuesday, August 25 at the Duffy Community Center. The closed-door (executive) session starts at 4:30 p.m.; the public part is scheduled to start at 5:30 p.m. The meeting includes a public hearing — a set time when anyone can speak — on changing the instructional time model for Palo Verde High Magnet School starting with the 2026–2027 school year. To speak, submit a Request to Address Board form to the Board office by noon the day of the meeting.",
    writtenAt: "2026-08-13",
  },
];

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
