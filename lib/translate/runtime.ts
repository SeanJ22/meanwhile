import type { ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { translationHash } from "./records.ts";
import { translateMeasure, type MeasureTranslationRepos } from "./worker.ts";
import { publishTranslation, readTranslations } from "./publication.ts";
import { priceMeteredUsage, readMeteredUsage } from "../control-plane/model-cost.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";

/** Called inside an admitted worker with that worker's Fleet/area transport. */
export async function runMeasureTranslation(input: {
  readonly batchPriority?: import("../control-plane/model-batch.ts").BatchPriority;
  readonly repos: MeasureTranslationRepos;
  readonly store: RoutineDataStore;
  readonly subject: Parameters<typeof translateMeasure>[0]["subject"];
  readonly primary: WorkerPublicationCapture;
  readonly captures: readonly WorkerPublicationCapture[];
  readonly transportFor: (subject: { subjectId: string; state: string }) => ModelTransport;
  readonly now: string;
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
    const held = await readTranslations([input.subject.ocdId], { store: input.store, now: input.now, bypassCache: true });
    const current = held.find(row => row.kind === "MEASURE" && row.subjectId === input.subject.contestId && row.ocdId === input.subject.ocdId &&
      row.sourceUrl === evidence.canonicalUrl && row.sourceHash === hash && row.sourceTextHash === translationHash(evidence.text));
    if (current) return { status: "REUSED" as const, record: current, usage: [], versionId: null };
    const prior = held.find(row => row.kind === "MEASURE" && row.subjectId === input.subject.contestId && row.ocdId === input.subject.ocdId);
    const translated = await translateMeasure({ ...input, evidence, subject: { ...input.subject, prior: prior?.kind === "MEASURE" ? prior.measure : input.subject.prior },
      transportFor: subject => {
        const send = input.transportFor(subject);
        return async request => {
          const response = await send(request);
          const metered = readMeteredUsage(response.usage, response.batch === true);
          usage.push({ model: response.model, usage: metered, usd: priceMeteredUsage(response.model, metered, "1h").usd });
          return response;
        };
      } });
    const published = await publishTranslation(input.store, { record: translated.record, captures: input.captures, now: input.now });
    if (!published.promoted || published.readerReadback?.status !== "PASS") throw new Error(published.candidate.failureDetail ?? "Translation has not reached its typed reader.");
    return { status: "PUBLISHED" as const, record: translated.record, usage, versionId: published.promoted.versionId };
  } catch (error) {
    return { status: "HELD" as const, detail: sanitizedErrorDiagnostic(error), record: null, usage, versionId: null };
  }
}
