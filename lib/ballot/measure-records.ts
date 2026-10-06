import { createHash } from "node:crypto";
import SEED from "../../data/ballot/measure-records-first-seed.json" with { type: "json" };
import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";
import type { BallotSet } from "./types.ts";

export type ProvisionKind = "FUNDING" | "PROGRAM" | "OVERSIGHT" | "SUNSET" | "START";

/** Stored inside the ballot's civic-data projection, with stable reaction keys. */
export interface MeasureRecord {
  readonly contestId: string;
  readonly whatItDoes: string;
  readonly yesMeans: string | null;
  readonly noMeans: string | null;
  readonly parts: readonly {
    readonly id: string;
    /** The source's own number; null when the held row does not record it. */
    readonly number: string | null;
    readonly kind: ProvisionKind;
    readonly label: string;
    readonly what: string;
  }[];
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly sourceHashKind?: "CAPTURE_BYTES" | "HELD_TEXT";
  readonly writtenAt: string;
  readonly citation?: "azleg-analysis" | "measure-source";
}

/** Immutable migration evidence; production records override it, including []. */
export const MEASURE_RECORD_FIRST_SEED = SEED as readonly MeasureRecord[];

/** Keep an explicit vote sentence exactly as the publisher wrote it. */
export function explicitVoteMeanings(text: string): { yesMeans: string | null; noMeans: string | null } {
  const result: { yesMeans: string | null; noMeans: string | null } = { yesMeans: null, noMeans: null };
  for (const vote of ["YES", "NO"] as const) {
    const pattern = new RegExp(`\\b(?:A\\s+)?["“']?${vote}["”']?\\s+vote\\s+(?:shall|will|would|means?|has)\\b[\\s\\S]*?(?:\\.(?=\\s+[A-Z]|$)|[!?](?=\\s|$))`, "gi");
    const sentences = [...text.matchAll(pattern)].map(match => match[0].trim());
    if (sentences.length === 1) result[vote === "YES" ? "yesMeans" : "noMeans"] = sentences[0];
  }
  return result;
}

export function measureRecordIssue(record: MeasureRecord): string | null {
  if (!record || typeof record.contestId !== "string" || !record.contestId || typeof record.whatItDoes !== "string" || !record.whatItDoes.trim() ||
      !/^https:\/\//.test(record.sourceUrl) || !/^[a-f0-9]{64}$/.test(record.sourceHash) ||
      !Number.isFinite(Date.parse(record.writtenAt)) || !Array.isArray(record.parts) ||
      ![record.yesMeans, record.noMeans].every(value => value === null || typeof value === "string")) {
    return "Measure record lacks its text or source identity.";
  }
  const ids = new Set<string>();
  for (const part of record.parts) {
    if (!part || typeof part.id !== "string" || !part.id.startsWith(`${record.contestId}#`) || ids.has(part.id) ||
        !["FUNDING", "PROGRAM", "OVERSIGHT", "SUNSET", "START"].includes(part.kind) ||
        typeof part.label !== "string" || !part.label.trim() || typeof part.what !== "string" || !part.what.trim() ||
        !(part.number === null || typeof part.number === "string" && part.number.trim())) {
      return "Measure part lacks its stable identity or source text.";
    }
    ids.add(part.id);
  }
  return null;
}

/** Filter records through the exact ballot the reader loaded, never a country-wide list. */
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

/** Compatibility for already-promoted ballots, only while their exact source still matches. */
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
