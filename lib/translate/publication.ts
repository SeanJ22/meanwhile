import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import { PromotionBaseChangedError, type RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { rawCaptureKey } from "../civic-data/raw-capture-vault.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import { translationRecordIssue, translationSourceContains, type TranslationRecord } from "./records.ts";

export function translationPackage(input: {
  record: TranslationRecord; additionalRecords?: readonly TranslationRecord[]; captures: readonly WorkerPublicationCapture[]; now: string;
}): ManualProjectionPackage {
  const { now } = input;
  const records = [input.record, ...(input.additionalRecords ?? [])];
  if (records.some(record => record.ocdId !== input.record.ocdId)) throw new Error("Translation publication must stay inside one division.");
  for (const record of records) {
    const issue = translationRecordIssue(record);
    if (issue) throw new Error(issue);
    const primary = input.captures.find(capture => capture.evidence.canonicalUrl === record.sourceUrl && capture.evidence.retrievedAt === record.retrievedAt &&
      (record.kind === "MEASURE" && record.sourceCapture
        ? capture.evidence.contentHash === `sha256-${record.sourceCapture.rawHash}` &&
          record.sourceCapture.byteLength === Buffer.byteLength(capture.evidence.text) &&
          (capture.evidence.sourceCapture ? record.sourceCapture.vaultKey === capture.evidence.sourceCapture.vaultKey
            // DB-05 files raw responses by fingerprint; earlier captures keep their host path.
            : [rawCaptureKey(record.sourceCapture.rawHash),
              `project/freshness/source/${new URL(record.sourceUrl).hostname}/raw/${record.sourceCapture.rawHash}`].includes(record.sourceCapture.vaultKey)) &&
          record.sentences.every(sentence => translationSourceContains(capture.evidence.text, sentence.quote)) &&
          (!record.subjectQuote || translationSourceContains(capture.evidence.text, record.subjectQuote))
        : capture.evidence.text === record.sourceText) && (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${record.sourceHash}`);
    if (!primary || !captureIntact(primary) || primary.evidence.retrievedAt !== record.retrievedAt) throw new Error("Translation has no complete saved source capture.");
    const linkingPage = linkingPageFrom(record.sourceUrl, input.captures.filter(captureIntact).map(capture => capture.evidence));
    const verified = section3Page({ url: record.sourceUrl, text: primary.evidence.text, retrievedAt: record.retrievedAt, linkingPage, sourcePolicy: primary.sourcePolicy },
      record.kind === "MEASURE" ? "BALLOT_MEASURE" : record.kind === "AGENDA" || record.kind === "MINUTES" ? "MEETING" : "OFFICIAL_BOARD_DIRECTORY", now);
    if (!verified.ok || !isOfficialSource(record.sourceUrl) && !linkingPage) throw new Error("Translation source is stale or not an official document.");
  }
  // Several explanations can cite the same immutable guide on different dates.
  // Validate each capture above, then retain one source proof for those bytes.
  const sources = new Map<string, WorkerPublicationCapture>();
  for (const capture of input.captures) {
    const key = JSON.stringify([capture.evidence.canonicalUrl, capture.evidence.contentHash, capture.evidence.sourceDocument?.contentHash]);
    const prior = sources.get(key);
    if (!prior || Date.parse(capture.evidence.retrievedAt) > Date.parse(prior.evidence.retrievedAt)) sources.set(key, capture);
  }
  // The review clock orders this open fact set; subject IDs and source hashes
  // cannot order unrelated subjects. The v2 prefix sorts after "translation:".
  return { contractId: "plain-english-translations", version: `translations-v2:${new Date(now).toISOString()}`,
    sourceThrough: records.map(record => record.retrievedAt).sort().at(-1)!, sourceReceipt: section3SourceReceipt([...sources.values()], now, input.record.checkerModel,
      "Writer and independent checker compared every translated sentence with the saved official source; code confirmed every supporting passage."),
    payload: { kind: "plain-english-translations", records } };
}

/** One checked fact publishes through the existing Slide and typed readback. */
export async function publishTranslation(store: RoutineDataStore, input: Parameters<typeof translationPackage>[0]) {
  const packet = translationPackage(input);
  for (;;) {
    const { candidate: prepared, expectedBaseVersionId } = await prepareManualProjectionSuccessor(packet, store, input.now);
    const records = (prepared.readModel as import("./projection-contract.ts").TranslationProjection).records;
    // The projection holds several independently captured documents. Adding an
    // older capture must retain the newest held source date; each sentence's
    // own retrieval date remains on its unchanged translation record.
    const sourceThrough = records.map(record => record.retrievedAt)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    const candidate = { ...prepared, temporal: { ...prepared.temporal, sourceThrough } };
    try {
      const outcome = await processRegisteredManualCandidate(store, "plain-english-translations", candidate, input.now, expectedBaseVersionId, { confirmUnchanged: false });
      if (outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED") continue;
      return outcome;
    } catch (error) {
      // Another measure in this district published first. Merge the already
      // checked sentence evidence into that version without another model call.
      if (!(error instanceof PromotionBaseChangedError)) throw error;
    }
  }
}

;
export {  readTranslations, withMeasureTranslations } from "./projection-reader.ts";
