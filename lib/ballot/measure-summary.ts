import { currentMeasureRecords, MEASURE_RECORD_FIRST_SEED, type MeasureRecord } from "./measure-records.ts";

export interface MeasureSummary {
  contestId: string;
  /** The 15-year-old register: what the measure would do. */
  summary: string;
  /** The official text this was written from — the citation. */
  summarizesUrl: string;
  writtenAt: string;
  /**
   * WHICH store the citation resolves against (BAL-46, 2026-09-02).
   *
   * The eleven statewide propositions are written from the Arizona Legislative
   * Council's adopted analysis, and `az-analyses-2026.json` is where that text
   * lives — the default. The LOCAL measures — a county expenditure-base
   * adjustment, three school-district budget overrides — have no Legislative
   * Council analysis and never will; their authority is a county board and
   * three school boards. Their summary is written from the measure's OWN held
   * authority text (the ballot question and the authority's published
   * statement, in `data/states/az/ballot/az-pima-2026.json`), so its citation resolves
   * against the measure's provenance, not the analyses store. The neutrality
   * rules are identical for both — describe, never advocate; write only from
   * the cited text — which is why this is one store with two citation sources
   * rather than two stores.
   */
  citation?: "azleg-analysis" | "measure-source";
}

function summary(record: MeasureRecord): MeasureSummary {
  return { contestId: record.contestId, summary: record.whatItDoes,
    summarizesUrl: record.sourceUrl, writtenAt: record.writtenAt, citation: record.citation };
}

/** First-seed export retained for migration checks. Runtime readers use the loaded records. */
export const MEASURE_SUMMARIES: MeasureSummary[] = MEASURE_RECORD_FIRST_SEED.map(summary);

export function summaryForContest(contestId: string, records: readonly MeasureRecord[] = currentMeasureRecords()): MeasureSummary | null {
  const record = records.find(record => record.contestId === contestId);
  return record ? summary(record) : null;
}
