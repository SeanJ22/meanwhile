import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { TRANSLATION_SCOPE, translationScope, translationRecordIssue, type TranslationRecord } from "./records.ts";
import { translationProjectionProblems, type TranslationProjection } from "./projection-contract.ts";
import { currentReaderAuthorityEdge, ensurePromotedEdge } from "../registry/runtime-edge.ts";
import type { BallotSet } from "../ballot/types.ts";
import { measureLabels, pageNamesMeasure } from "./routine-measure-pages.ts";

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
  const results = await Promise.all(divisionsToRead.map(async division => {
    const scope = translationScope(division), served = edgeContext ? await ensurePromotedEdge("CURATED_READER_RECORD", scope) : null;
    if (edgeContext && !served) return null;
    return readTranslationProjection({ ...options, ...(served ? { edge: served.value } : {}), scope });
  }));
  return results.flatMap(result => result?.kind === "PROMOTED" ? result.value.records : []);
}

/** Only the loaded ballot's exact subjects and currently held source hashes attach. */
export function withMeasureTranslations(ballot: BallotSet, records: readonly TranslationRecord[]): BallotSet {
  const current = ballot.measureRecords ?? [];
  const translated = [...current];
  for (const contest of ballot.contests.filter(row => row.type === "MEASURE")) {
    const at = translated.findIndex(row => row.contestId === contest.id), prior = translated[at];
    const measure = ballot.measures?.find(row => row.contestId === contest.id);
    const analysis = ballot.measureAnalyses?.analyses.find(row => row.contestId === contest.id);
    // These are the sources the existing ballot card links. Keep the explainer
    // attached to the exact contest and a source readers can follow there.
    const sources = new Set([contest.measureTextUrl, prior?.sourceUrl, measure?.provenance.sourceUrl, analysis?.analysisUrl, contest.provenance?.sourceUrl].filter(Boolean));
    // A page found on the election office's own site is not linked by the ballot card. Its saved text
    // must name this exact measure, as it had to when the explainer was written and checked.
    const names = measureLabels({ title: contest.title, questionText: measure?.questionText, officialNumber: measure?.officialNumber, analysisText: analysis?.text });
    const translation = records.filter(row => row.kind === "MEASURE" && row.subjectId === contest.id && row.ocdId === contest.ocdId &&
      (sources.has(row.sourceUrl) || pageNamesMeasure(row.sourceText, names)) && (!prior || row.sourceHash === prior.sourceHash || Date.parse(row.retrievedAt) >= Date.parse(prior.writtenAt)) &&
      !translationRecordIssue(row)).sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt) || Date.parse(b.writtenAt) - Date.parse(a.writtenAt))[0];
    if (translation?.kind !== "MEASURE") continue;
    // Legacy reaction targets remain available while the summary and vote
    // meanings acquire independent sentence checks.
    const parts = prior?.parts.filter(part => !translation.measure.parts.some(row => row.id === part.id)) ?? [];
    const record = parts.length ? { ...translation.measure, parts: [...translation.measure.parts, ...parts] } : translation.measure;
    if (at < 0) translated.push(record);
    else translated[at] = record;
  }
  return translated.length !== current.length || translated.some((row, at) => row !== current[at]) ? { ...ballot, measureRecords: translated } : ballot;
}
