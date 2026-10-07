import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { TRANSLATION_SCOPE, translationScope, translationRecordIssue, type TranslationRecord } from "./records.ts";
import { translationProjectionProblems, type TranslationProjection } from "./projection-contract.ts";
import { currentReaderAuthorityEdge, currentPromotedEdge } from "../registry/runtime-edge.ts";
import type { BallotSet } from "../ballot/types.ts";

export async function readTranslationProjection(options: PromotedCivicDataReadOptions & { scope?: string } = {}) {
  const { scope = TRANSLATION_SCOPE, ...readOptions } = options;
  const result = await readPromotedCivicData<TranslationProjection>("CURATED_READER_RECORD", scope, readOptions);
  if (result.kind === "PROMOTED" && (translationProjectionProblems(result.value).length ||
    result.value.records.some(row => translationScope(row.ocdId) !== scope))) throw new Error("Published translations have invalid source support or jurisdiction scope.");
  return result;
}

export async function readTranslations(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<readonly TranslationRecord[]> {
  const divisionsToRead = [...new Set(divisions)].filter(division => /^ocd-division\/country:us\/(state|district|territory):/.test(division));
  const edgeContext = options.store === undefined && currentReaderAuthorityEdge() !== null;
  // Request bundles that do not name this family keep their held ballot records
  // without adding optional database reads on every cold visit.
  const results = await Promise.all(divisionsToRead.flatMap(division => {
    const scope = translationScope(division), served = edgeContext ? currentPromotedEdge("CURATED_READER_RECORD", scope) : null;
    if (edgeContext && !served) return [];
    return [readTranslationProjection({ ...options, ...(served ? { edge: served.value } : {}), scope })];
  }));
  return results.flatMap(result => result.kind === "PROMOTED" ? result.value.records : []);
}

/** Only the loaded ballot's exact subjects and currently held source hashes attach. */
export function withMeasureTranslations(ballot: BallotSet, records: readonly TranslationRecord[]): BallotSet {
  const current = ballot.measureRecords ?? [];
  const translated = current.map(record => {
    const contest = ballot.contests.find(row => row.id === record.contestId && row.type === "MEASURE");
    const translation = records.find(row => row.kind === "MEASURE" && row.subjectId === record.contestId && row.ocdId === contest?.ocdId &&
      row.sourceUrl === record.sourceUrl && (row.sourceHash === record.sourceHash || Date.parse(row.retrievedAt) >= Date.parse(record.writtenAt)) && !translationRecordIssue(row));
    return translation?.kind === "MEASURE" ? translation.measure : record;
  });
  return translated.some((row, at) => row !== current[at]) ? { ...ballot, measureRecords: translated } : ballot;
}
