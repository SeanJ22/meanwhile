import { currentGenericBallotProjection } from "./generic-projection.ts";

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

function getMeasureAnalyses(state: string): AnalysesFile | null {
  return Object.values(currentGenericBallotProjection(state).ballots).find(ballot => ballot.measureAnalyses)?.measureAnalyses ?? null;
}

/** Null when the ballot projection holding it cannot be read in this process. */
export function analysisForContest(state: string, contestId: string): MeasureAnalysis | null {
  let records: readonly MeasureAnalysis[] | undefined;
  try {
    records = getMeasureAnalyses(state)?.analyses;
  } catch {
    return null;
  }
  return records?.find(record => record.contestId === contestId) ?? null;
}
