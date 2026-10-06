import { curatedMeasureRecordFor } from "./curated-measure-values.ts";
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
  // The translator's edge publication hook is part of its rollout. Existing
  // request bundles do not name this new family; they keep their held ballot
  // records without adding optional database reads on every cold visit.
  const results = await Promise.all(divisionsToRead.flatMap(division => {
    const scope = translationScope(division), served = edgeContext ? currentPromotedEdge("CURATED_READER_RECORD", scope) : null;
    if (edgeContext && !served) return [];
    return [readTranslationProjection({ ...options, ...(served ? { edge: served.value } : {}), scope })];
  }));
  return results.flatMap(result => result.kind === "PROMOTED" ? result.value.records : []);
}

/** Only the loaded ballot's exact subjects attach. Existing records keep their
 * source-hash guard; a complete preserved set also survives static retirement. */
export function withMeasureTranslations(ballot: BallotSet, records: readonly TranslationRecord[]): BallotSet {
  const current = ballot.measureRecords ?? [];
  const translated = current.map(record => {
    const contest = ballot.contests.find(row => row.id === record.contestId && row.type === "MEASURE");
    const translation = records.find(row => row.kind === "MEASURE" && row.subjectId === record.contestId && row.ocdId === contest?.ocdId &&
      row.sourceUrl === record.sourceUrl && (row.sourceHash === record.sourceHash || Date.parse(row.retrievedAt) >= Date.parse(record.writtenAt)) && !translationRecordIssue(row));
    if (translation?.kind === "MEASURE") return translation.measure;
    const preserved = contest && curatedMeasureRecordFor(records, record.contestId, contest.ocdId);
    return preserved && preserved.sourceUrl === record.sourceUrl && preserved.sourceHash === record.sourceHash ? { ...preserved, yesMeans: preserved.yesMeans ?? record.yesMeans, noMeans: preserved.noMeans ?? record.noMeans } : record;
  });
  const subjects = new Set(current.map(record => record.contestId));
  for (const contest of ballot.contests) {
    if (contest.type !== "MEASURE" || subjects.has(contest.id) ||
        ballot.contests.filter(row => row.id === contest.id).length !== 1) continue;
    const preserved = curatedMeasureRecordFor(records, contest.id, contest.ocdId);
    if (preserved) { translated.push(preserved); subjects.add(contest.id); }
  }
  if (translated.length !== current.length) return { ...ballot, measureRecords: translated };
  return translated.some((row, at) => row !== current[at]) ? { ...ballot, measureRecords: translated } : ballot;
}
