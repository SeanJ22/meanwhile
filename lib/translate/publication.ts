import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { TRANSLATION_SCOPE, translationScope, translationRecordIssue, type MeasureTranslation } from "./records.ts";
import type { BallotSet } from "../ballot/types.ts";
import { currentReaderAuthorityEdge, currentPromotedEdge } from "../registry/runtime-edge.ts";

export interface TranslationProjection { readonly kind: "plain-english-translations"; readonly records: readonly MeasureTranslation[] }

export function translationProjectionProblems(payload: TranslationProjection): string[] {
  if (!payload || payload.kind !== "plain-english-translations" || !Array.isArray(payload.records)) return ["Translation records are missing."];
  const problems = payload.records.flatMap(record => { const issue = translationRecordIssue(record); return issue ? [issue] : []; });
  if (new Set(payload.records.map(record => record.id)).size !== payload.records.length) problems.push("Translation repeats a subject identity.");
  if (new Set(payload.records.map(record => record.ocdId)).size > 1) problems.push("Translation batch must belong to one exact place or district.");
  return problems;
}

export function measureTranslationPackage(input: {
  record: MeasureTranslation; captures: readonly WorkerPublicationCapture[]; now: string;
}): ManualProjectionPackage {
  const { record, now } = input;
  const issue = translationRecordIssue(record);
  if (issue) throw new Error(issue);
  const primary = input.captures.find(capture => capture.evidence.canonicalUrl === record.sourceUrl &&
    capture.evidence.text === record.sourceText && (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${record.sourceHash}`);
  if (!primary || !captureIntact(primary) || primary.evidence.retrievedAt !== record.retrievedAt) throw new Error("Translation has no complete saved source capture.");
  const linkingPage = linkingPageFrom(record.sourceUrl, input.captures.filter(captureIntact).map(capture => capture.evidence));
  const verified = section3Page({ url: record.sourceUrl, text: record.sourceText, retrievedAt: record.retrievedAt, linkingPage }, "BALLOT_MEASURE", now);
  if (!verified.ok || !isOfficialSource(record.sourceUrl) && !linkingPage) throw new Error("Translation source is stale or not an official measure document.");
  return { contractId: "plain-english-translations", version: `${record.id}:${record.sourceHash}:${record.writtenAt}`,
    sourceThrough: record.retrievedAt, sourceReceipt: section3SourceReceipt(input.captures, now, record.checkerModel,
      "Writer and independent checker compared every translated sentence with the saved official source; code confirmed every supporting passage."),
    payload: { kind: "plain-english-translations", records: [record] } };
}

/** One checked fact publishes through the existing Slide and typed readback. */
export async function publishMeasureTranslation(store: RoutineDataStore, input: Parameters<typeof measureTranslationPackage>[0]) {
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(measureTranslationPackage(input), store, input.now);
  return processRegisteredManualCandidate(store, "plain-english-translations", candidate, input.now, expectedBaseVersionId);
}

export async function readTranslationProjection(options: PromotedCivicDataReadOptions & { scope?: string } = {}) {
  const { scope = TRANSLATION_SCOPE, ...readOptions } = options;
  const result = await readPromotedCivicData<TranslationProjection>("CURATED_READER_RECORD", scope, readOptions);
  if (result.kind === "PROMOTED" && (translationProjectionProblems(result.value).length ||
    result.value.records.some(row => translationScope(row.ocdId) !== scope))) throw new Error("Published translations have invalid source support or jurisdiction scope.");
  return result;
}

export async function readTranslations(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<readonly MeasureTranslation[]> {
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

/** Only the loaded ballot's exact subjects and currently held source hashes attach. */
export function withMeasureTranslations(ballot: BallotSet, records: readonly MeasureTranslation[]): BallotSet {
  const current = ballot.measureRecords ?? [];
  const translated = current.map(record => {
    const contest = ballot.contests.find(row => row.id === record.contestId && row.type === "MEASURE");
    const translation = records.find(row => row.subjectId === record.contestId && row.ocdId === contest?.ocdId &&
      row.sourceUrl === record.sourceUrl && (row.sourceHash === record.sourceHash || Date.parse(row.retrievedAt) >= Date.parse(record.writtenAt)) && !translationRecordIssue(row));
    return translation?.measure ?? record;
  });
  return translated.some((row, at) => row !== current[at]) ? { ...ballot, measureRecords: translated } : ballot;
}
