import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";

/**
 * The retrieved official measure analyses — the Legislative Council's
 * adopted (or, where the Legislature's own adopted link is broken, draft)
 * impartial analyses, verbatim. Written by scripts/fetch-measure-analyses.mts;
 * read here for the server-rendered ballot page.
 *
 * The 2b rule this store exists for: data in hand may never be displayed
 * as missing. If the analysis text is here, the surface renders it.
 */

export interface MeasureAnalysis {
  contestId: string;
  measureTitle: string;
  analysisUrl: string;
  sourceOrg: string;
  retrievedAt: string;
  contentHash: string;
  extraction: "pdf" | "failed";
  extractionNote: string | null;
  text: string | null;
}

export interface AnalysesFile {
  readonly generatedAt: string;
  readonly counts: { readonly measures: number; readonly fetched: number; readonly extracted: number; readonly failed: number };
  readonly analyses: readonly MeasureAnalysis[];
}

/** The analysis set embedded in the exact promoted Arizona ballot projection. */
export function getMeasureAnalyses(): AnalysesFile | null {
  return currentAzBallotProjection().measureAnalyses;
}

export function analysisForContest(contestId: string): MeasureAnalysis | null {
  // Arizona's Legislative Council cannot supply another state's analysis.
  if (!contestId.startsWith("ballot-az-")) return null;
  return (
    getMeasureAnalyses()?.analyses.find((a) => a.contestId === contestId) ?? null
  );
}
