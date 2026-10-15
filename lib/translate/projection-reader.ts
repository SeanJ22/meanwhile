import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { TRANSLATION_SCOPE, translationScope, translationHash, translationRecordIssue, type TranslationRecord } from "./records.ts";
import { translationProjectionProblems, type TranslationProjection } from "./projection-contract.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
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
  const edgeContext = options.store === undefined ? currentReaderAuthorityEdge() : null;
  const results = await Promise.all(divisionsToRead.map(async division => {
    const scope = translationScope(division);
    const edge = edgeContext ? await edgeContext.translations?.load(division) : null;
    if (edgeContext && !edge) return null;
    return readTranslationProjection({ ...options, ...(edge ? { edge } : {}), scope });
  }));
  return results.flatMap(result => result?.kind === "PROMOTED" ? result.value.records : []);
}

/** Only the loaded ballot's exact subjects and currently held source hashes attach. */
export function withMeasureTranslations(ballot: BallotSet, records: readonly TranslationRecord[]): BallotSet {
  const current = ballot.measureRecords ?? [];
  const translated = current.flatMap(record => {
    const contest = ballot.contests.find(row => row.id === record.contestId && row.type === "MEASURE");
    const measure = ballot.measures?.find(measure => measure.contestId === record.contestId && measure.officialText);
    const translation = records.find(row => row.kind === "MEASURE" && row.subjectId === record.contestId && row.ocdId === contest?.ocdId &&
      row.sourceUrl === record.sourceUrl && row.sourceHash === record.sourceHash && !translationRecordIssue(row) &&
      (!measure || row.ballotQuestionHash === translationHash(JSON.stringify({ text: measure.questionText, sourceUrl: measure.provenance.sourceUrl }))));
    if (translation?.kind === "MEASURE") return [translation.measure];
    return measure ? [] : [record];
  });
  return translated.length !== current.length || translated.some((row, at) => row !== current[at]) ? { ...ballot, measureRecords: translated } : ballot;
}
