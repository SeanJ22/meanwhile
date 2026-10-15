import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import type { TranslationBallotSource } from "./projection-contract.ts";
import type { MeasureSourceReference } from "../ballot/types.ts";
import { translationHash, translationRecordIssue, type TranslationRecord } from "./records.ts";

export function translationPackage(input: {
  record: TranslationRecord; captures: readonly WorkerPublicationCapture[]; now: string; sourceBallot?: TranslationBallotSource;
}): ManualProjectionPackage {
  const { record, now } = input;
  const primary = input.captures.find(capture => capture.evidence.canonicalUrl === record.sourceUrl &&
    translationHash(capture.evidence.text) === record.sourceTextHash && (record.kind === "MEASURE" ? capture.evidence.contentHash : capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${record.sourceHash}`);
  if (!primary || !captureIntact(primary) || primary.evidence.retrievedAt !== record.retrievedAt) throw new Error("Translation has no complete saved source capture.");
  const issue = translationRecordIssue(record, primary.evidence.text);
  if (issue) throw new Error(issue);
  if (record.kind === "MEASURE" && canonicalCivicDataJson(primary.sourceReference) !== canonicalCivicDataJson(record.sourceReference)) throw new Error("Translation source reference differs from its verified capture.");
  const linkingPage = linkingPageFrom(record.sourceUrl, input.captures.filter(captureIntact).map(capture => capture.evidence));
  const verified = section3Page({ url: record.sourceUrl, text: primary.evidence.text, retrievedAt: record.retrievedAt, linkingPage, sourcePolicy: primary.sourcePolicy },
    record.kind === "MEASURE" ? "BALLOT_MEASURE" : record.kind === "AGENDA" || record.kind === "MINUTES" ? "MEETING" : "OFFICIAL_BOARD_DIRECTORY", now);
  if (!verified.ok || !isOfficialSource(record.sourceUrl) && !linkingPage) throw new Error("Translation source is stale or not an official document.");
  let sourceReceipt = section3SourceReceipt(input.captures, now, record.checkerModel,
    "Writer and independent checker compared every translated sentence with the saved official source; code confirmed every supporting passage.");
  if (record.kind === "MEASURE") {
    const originals = new Map<string, MeasureSourceReference>();
    const pending = [...record.sourceReference.originals ?? []];
    for (const original of pending) {
      originals.set(`${original.sourceUrl}\n${original.sourceHash}`, original);
      pending.push(...original.originals ?? []);
    }
    const receipts = primary.originalSourceReceipts ?? [];
    if (receipts.length !== originals.size || receipts.some(receipt => {
      const original = originals.get(`${receipt.finalUrl}\n${receipt.rawHash}`);
      return !original || receipt.requestedUrl !== original.sourceUrl || receipt.publisher !== original.publisher ||
        receipt.retrievedAt !== original.retrievedAt || receipt.httpStatus !== 200 || receipt.sourceClass !== "OFFICIAL_PUBLISHER" ||
        receipt.reviewOutcome !== "SUPPORTED" || !receipt.reviewedEvidence.trim();
    }) || new Set(receipts.map(receipt => `${receipt.finalUrl}\n${receipt.rawHash}`)).size !== originals.size) {
      throw new Error("Translation originals lack their exact verified source receipts.");
    }
    const sources = new Map(sourceReceipt.sources.map(receipt => [`${receipt.finalUrl}\n${receipt.rawHash}`, receipt]));
    for (const receipt of receipts) sources.set(`${receipt.finalUrl}\n${receipt.rawHash}`, receipt);
    sourceReceipt = { ...sourceReceipt, sources: [...sources.values()] };
  }
  // The review clock orders the place fact set independently of each sentence’s original check.
  return { contractId: "plain-english-translations", version: `translations-v2:${new Date(now).toISOString()}`,
    sourceThrough: record.retrievedAt, sourceReceipt,
    payload: { kind: "plain-english-translations", records: [record], ...(input.sourceBallot ? { sourceBallot: input.sourceBallot } : {}) } };
}

export async function publishTranslation(store: RoutineDataStore, input: Parameters<typeof translationPackage>[0]) {
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(translationPackage(input), store, input.now);
  return processRegisteredManualCandidate(store, "plain-english-translations", candidate, input.now, expectedBaseVersionId);
}

export { translationProjectionProblems, type TranslationProjection } from "./projection-contract.ts";
export { readTranslationProjection, readTranslations, withMeasureTranslations } from "./projection-reader.ts";
