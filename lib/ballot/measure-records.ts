import { createHash } from "node:crypto";
import SEED from "../../data/ballot/measure-records-first-seed.json" with { type: "json" };
import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";
import type { BallotSet } from "./types.ts";

import { measureRecordIssue, type MeasureRecord } from "./measure-record-contract.ts";
export { measureRecordIssue } from "./measure-record-contract.ts";
export type { MeasureRecord, ProvisionKind } from "./measure-record-contract.ts";

/** Immutable migration evidence; production records override it, including []. */
export const MEASURE_RECORD_FIRST_SEED = SEED as readonly MeasureRecord[];

export function explicitVoteMeanings(text: string): { yesMeans: string | null; noMeans: string | null } {
  text = text.trim();
  const result: { yesMeans: string | null; noMeans: string | null } = { yesMeans: null, noMeans: null };
  for (const vote of ["YES", "NO"] as const) {
    const pattern = new RegExp(`\\b(?:A\\s+)?["“']?${vote}["”']?\\s+vote\\s+(?:shall|will|would|means?|has|adopts?|approves?|pass(?:es)?|keeps?|retains?|rejects?|leaves?|continues?)\\b[\\s\\S]*?(?:\\.(?=\\s+[A-Z]|$)|[!?](?=\\s|$))`, "gi");
    const sentences = [...text.matchAll(pattern)].map(match => match[0].trim());
    if (sentences.length === 1) result[vote === "YES" ? "yesMeans" : "noMeans"] = sentences[0];
  }
  return result;
}

export function measureRecordsForBallot(ballot: BallotSet): readonly MeasureRecord[] {
  const measures = new Set(ballot.contests.filter(c => c.type === "MEASURE").map(c => c.id));
  const records = ballot.measureRecords ?? [];
  const seen = new Set<string>();
  return records.filter(record => {
    if (!measures.has(record.contestId) || seen.has(record.contestId) || measureRecordIssue(record)) return false;
    seen.add(record.contestId);
    return true;
  }).map(record => {
    if (record.yesMeans && record.noMeans) return record;
    const measure = ballot.measures.find(row => row.contestId === record.contestId);
    // Only replay the exact text whose source identity the record carries.
    // Other sources and translated meanings remain independent held facts.
    if (!measure || record.sourceHashKind !== "HELD_TEXT" || measure.provenance.sourceUrl !== record.sourceUrl ||
        createHash("sha256").update(`${measure.questionText}\n${measure.officialStatement ?? ""}`).digest("hex") !== record.sourceHash) return record;
    const meanings = explicitVoteMeanings(measure.questionText);
    return { ...record, yesMeans: record.yesMeans ?? meanings.yesMeans, noMeans: record.noMeans ?? meanings.noMeans };
  });
}

export function seedMeasureRecords(ballot: BallotSet, analyses: readonly {
  readonly contestId: string; readonly analysisUrl: string; readonly contentHash: string;
}[] = []): BallotSet {
  if (ballot.measureRecords !== undefined) return ballot;
  const measureRecords = MEASURE_RECORD_FIRST_SEED.filter(record => {
    if (record.sourceHashKind !== "HELD_TEXT") {
      return analyses.some(a => a.contestId === record.contestId &&
        a.analysisUrl === record.sourceUrl && a.contentHash === record.sourceHash);
    }
    const measure = ballot.measures.find(m => m.contestId === record.contestId);
    return measure?.provenance.sourceUrl === record.sourceUrl &&
      createHash("sha256").update(`${measure.questionText}\n${measure.officialStatement ?? ""}`).digest("hex") === record.sourceHash;
  });
  return { ...ballot, measureRecords };
}

export function currentMeasureRecords(): readonly MeasureRecord[] {
  const projection = currentAzBallotProjection();
  return measureRecordsForBallot(seedMeasureRecords(projection.ballot, projection.measureAnalyses.analyses));
}
