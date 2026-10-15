import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import { translationHash, translationRecordIssue, type TranslationRecord } from "./records.ts";

export function translationPackage(input: {
  record: TranslationRecord; captures: readonly WorkerPublicationCapture[]; now: string;
}): ManualProjectionPackage {
  const { record, now } = input;
  const primary = input.captures.find(capture => capture.evidence.canonicalUrl === record.sourceUrl &&
    translationHash(capture.evidence.text) === record.sourceTextHash && (record.kind === "MEASURE" ? capture.evidence.contentHash : capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${record.sourceHash}`);
  if (!primary || !captureIntact(primary) || primary.evidence.retrievedAt !== record.retrievedAt) throw new Error("Translation has no complete saved source capture.");
  const issue = translationRecordIssue(record, primary.evidence.text);
  if (issue) throw new Error(issue);
  if (record.kind === "MEASURE" && JSON.stringify(primary.sourceReference) !== JSON.stringify(record.sourceReference)) throw new Error("Translation source reference differs from its verified capture.");
  const linkingPage = linkingPageFrom(record.sourceUrl, input.captures.filter(captureIntact).map(capture => capture.evidence));
  const verified = section3Page({ url: record.sourceUrl, text: primary.evidence.text, retrievedAt: record.retrievedAt, linkingPage, sourcePolicy: primary.sourcePolicy },
    record.kind === "MEASURE" ? "BALLOT_MEASURE" : record.kind === "AGENDA" || record.kind === "MINUTES" ? "MEETING" : "OFFICIAL_BOARD_DIRECTORY", now);
  if (!verified.ok || !isOfficialSource(record.sourceUrl) && !linkingPage) throw new Error("Translation source is stale or not an official document.");
  // The review clock orders this open fact set; subject IDs and source hashes
  // cannot order unrelated subjects. The v2 prefix sorts after "translation:".
  return { contractId: "plain-english-translations", version: `translations-v2:${new Date(record.writtenAt).toISOString()}`,
    sourceThrough: record.retrievedAt, sourceReceipt: section3SourceReceipt(input.captures, now, record.checkerModel,
      "Writer and independent checker compared every translated sentence with the saved official source; code confirmed every supporting passage."),
    payload: { kind: "plain-english-translations", records: [record] } };
}

/** One checked fact publishes through the existing Slide and typed readback. */
export const measureTranslationPackage = translationPackage;
export async function publishTranslation(store: RoutineDataStore, input: Parameters<typeof translationPackage>[0]) {
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(translationPackage(input), store, input.now);
  return processRegisteredManualCandidate(store, "plain-english-translations", candidate, input.now, expectedBaseVersionId);
}
export const publishMeasureTranslation = publishTranslation;

export { translationProjectionProblems, type TranslationProjection } from "./projection-contract.ts";
export { readTranslationProjection, readTranslations, withMeasureTranslations } from "./projection-reader.ts";
