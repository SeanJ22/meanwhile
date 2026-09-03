import { readFileSync } from "node:fs";
import { join } from "node:path";

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

interface AnalysesFile {
  generatedAt: string;
  counts: { measures: number; fetched: number; extracted: number; failed: number };
  analyses: MeasureAnalysis[];
}

let cache: AnalysesFile | null = null;

/** Null when the file is absent — an honest empty, never a throw at render. */
export function getMeasureAnalyses(): AnalysesFile | null {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "states", "az", "ballot", "az-analyses-2026.json"),
        "utf8",
      ),
    ) as AnalysesFile;
    return cache;
  } catch {
    return null;
  }
}

export function analysisForContest(contestId: string): MeasureAnalysis | null {
  return (
    getMeasureAnalyses()?.analyses.find((a) => a.contestId === contestId) ?? null
  );
}
