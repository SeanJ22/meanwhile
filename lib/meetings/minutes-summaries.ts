/**
 * Curated plain-language "what happened" summaries for CONCLUDED meetings
 * (6a, 2026-08-17) — the past-meeting card's dropdown.
 *
 * Rules, same as every curated register:
 * - a summary exists ONLY where the body's published minutes were read;
 *   every entry cites the minutes document it paraphrases and the date it
 *   was read;
 * - the summary is ours and labeled ours; it paraphrases, never evaluates;
 * - a concluded meeting with no entry renders the honest state instead
 *   ("minutes not posted yet" / "not yet summarized"), never a guess.
 *
 * Keyed by the source-namespaced meeting id from the snapshot.
 */

export interface MinutesSummary {
  meetingId: string;
  /** Our paraphrase of the minutes — plain words, no evaluation. */
  summary: string;
  /** The minutes document this paraphrases. */
  minutesUrl: string;
  sourceOrg: string;
  readAt: string;
}

export const MINUTES_SUMMARIES: MinutesSummary[] = [
  // Curation backlog (2026-08-17): the shape ships ahead of its first
  // entries — concluded meetings render "minutes not posted yet / not yet
  // summarized" honestly. Summaries are added as minutes are read; the
  // five most recent concluded meetings per the cut order are the seed
  // worklist, and the browser phase picks up documents the pipeline's
  // clients cannot reach.
];

export function minutesSummaryForMeeting(
  meetingId: string,
): MinutesSummary | null {
  return MINUTES_SUMMARIES.find((s) => s.meetingId === meetingId) ?? null;
}
