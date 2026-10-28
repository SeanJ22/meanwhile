import { holdRawCapture, readRawCaptureText, type RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import type { ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { needsMeasureRewrite, translationEvidenceVault } from "./source-evidence.ts";
import { translationHash, type TranslationRecord } from "./records.ts";
import { translateMeasure, translationModelUsage, translationRepairDraft, type MeasureTranslationRepos } from "./worker.ts";
import { publishTranslation, readTranslations } from "./publication.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";

/** Called inside an admitted worker with that worker's Fleet/area transport. */
export async function runMeasureTranslation(input: {
  readonly priorFeedback?: string;
  readonly priorDraft?: Parameters<typeof translateMeasure>[0]["priorDraft"];
  readonly priorRepairCapture?: RawCaptureRef;
  readonly vault?: import("../control-plane/evidence/store.ts").EvidenceStore;
  readonly batchPriority?: import("../control-plane/model-batch.ts").BatchPriority;
  readonly repos: MeasureTranslationRepos;
  readonly store: RoutineDataStore;
  readonly subject: Parameters<typeof translateMeasure>[0]["subject"];
  readonly primary: WorkerPublicationCapture;
  readonly captures: readonly WorkerPublicationCapture[];
  readonly transportFor: (subject: { subjectId: string; state: string }) => ModelTransport;
  readonly now: string;
  /** The division's checked records this pass already read. Each measure otherwise
   * re-reads the division projection. */
  readonly held?: readonly TranslationRecord[];
}) {
  const usage: Awaited<ReturnType<typeof translateMeasure>>["usage"] = [];
  try {
    if (!captureIntact(input.primary)) throw new Error("Translation source capture is incomplete.");
    const evidence = input.primary.evidence;
    const admitted = section3Page({ url: evidence.canonicalUrl, text: evidence.text, retrievedAt: evidence.retrievedAt,
      linkingPage: linkingPageFrom(evidence.canonicalUrl, input.captures.filter(captureIntact).map(row => row.evidence)),
      sourcePolicy: input.primary.sourcePolicy }, "BALLOT_MEASURE", input.now);
    if (!admitted.ok) throw new Error(admitted.reason ?? "Translation source is not admitted.");
    const hash = (evidence.sourceDocument?.contentHash ?? evidence.contentHash).replace(/^sha256-/, "");
    const held = input.held ?? await readTranslations([input.subject.ocdId], { store: input.store, now: input.now });
    const current = held.find(row => row.kind === "MEASURE" && row.subjectId === input.subject.contestId && row.ocdId === input.subject.ocdId &&
      row.sourceUrl === evidence.canonicalUrl && row.sourceHash === hash && (row.sourceCapture?.rawHash ?? row.sourceTextHash) === translationHash(evidence.text) && !needsMeasureRewrite(row));
    if (current) return { status: "REUSED" as const, record: current, usage: [], versionId: null };
    const prior = held.find(row => row.kind === "MEASURE" && row.subjectId === input.subject.contestId && row.ocdId === input.subject.ocdId);
    const priorDraft = input.priorDraft ?? (input.priorRepairCapture
      ? JSON.parse(await readRawCaptureText(translationEvidenceVault(input.vault), input.priorRepairCapture)) as Parameters<typeof translateMeasure>[0]["priorDraft"] : undefined);
    const translated = await translateMeasure({ ...input, priorDraft, evidence, subject: { ...input.subject, prior: prior?.kind === "MEASURE" ? prior.measure : input.subject.prior },
      transportFor: subject => {
        const send = input.transportFor(subject);
        return async request => {
          const response = await send(request);
          usage.push(translationModelUsage(request, response));
          return response;
        };
      } });
    const published = await publishTranslation(input.store, { record: translated.record, captures: input.captures, now: input.now });
    if (!published.promoted || published.readerReadback?.status !== "PASS") throw new Error(published.candidate.failureDetail ?? "Translation has not reached its typed reader.");
    return { status: "PUBLISHED" as const, record: translated.record, usage, versionId: published.promoted.versionId };
  } catch (error) {
    const repairDraft = translationRepairDraft(error);
    let repairCapture: RawCaptureRef | undefined, detail = sanitizedErrorDiagnostic(error);
    if (repairDraft) try {
      repairCapture = await holdRawCapture(translationEvidenceVault(input.vault), "translation-repair", JSON.stringify(repairDraft), "application/json");
    } catch (retentionError) { detail += ` Repair draft retention failed: ${sanitizedErrorDiagnostic(retentionError)}`; }
    return { status: "HELD" as const, ...(repairCapture ? { repairCapture } : {}), detail, record: null, usage, versionId: null };
  }
}
