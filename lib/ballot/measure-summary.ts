import HOLDINGS from "../../data/states/az/ballot/measure-summaries.json" with { type: "json" };

/**
 * Hand-curated plain-language summaries of ballot measures (4d).
 *
 * The rules, each of them load-bearing:
 * - **Written ONLY from the official source text on the page** — the
 *   Legislative Council analysis each row cites. Nothing here came from
 *   news coverage, advocacy material, or general knowledge.
 * - **What it does, never whether it's good.** No advocacy vocabulary; a
 *   test holds this mechanically (tests/measure-summaries.test.ts).
 * - **Rendered ABOVE the official text, clearly labeled, never replacing
 *   it.** The label on the surface says "read the official text below".
 * - **Every row cites the text it summarizes** — `summarizesUrl` must
 *   match the analysis record for the same contest, asserted in tests.
 *
 * The generated-at-runtime version of this belongs to the natural-language
 * track and its A07 gates; these are curated data, reviewed like any other
 * curated row.
 */

export interface MeasureSummary {
  contestId: string;
  /** The 15-year-old register: what the measure would do. */
  summary: string;
  /** The official text this was written from — the citation. */
  summarizesUrl: string;
  writtenAt: string;
}



export const MEASURE_SUMMARIES: MeasureSummary[] = HOLDINGS.records.MEASURE_SUMMARIES;

export function summaryForContest(contestId: string): MeasureSummary | null {
  return MEASURE_SUMMARIES.find((s) => s.contestId === contestId) ?? null;
}
