import { currentMeasureRecords, type MeasureRecord } from "./measure-records.ts";

export interface MeasureSummary {
  contestId: string;
  summary: string;
  yesMeans?: string | null;
  noMeans?: string | null;
  summarizesUrl: string;
  writtenAt: string;
  citation?: "azleg-analysis" | "measure-source";
}

function summary(record: MeasureRecord): MeasureSummary {
  return { contestId: record.contestId, summary: record.whatItDoes, yesMeans: record.yesMeans, noMeans: record.noMeans,
    summarizesUrl: record.sourceUrl, writtenAt: record.writtenAt, citation: record.citation };
}

export function summaryForContest(contestId: string, records: readonly MeasureRecord[] = currentMeasureRecords()): MeasureSummary | null {
  const record = records.find(record => record.contestId === contestId);
  return record ? summary(record) : null;
}
