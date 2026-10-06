import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { readMeteredUsage, priceMeteredUsage } from "../control-plane/model-cost.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { translateText } from "./worker.ts";
import { readTranslations, publishTranslation } from "./publication.ts";
import { translationHash } from "./records.ts";
import { recordTranslationHold, type TranslationLearning } from "./paid-result.ts";

/** The existing admitted worker supplies its guarded transport for both calls. */
export async function runTextTranslation(input: Omit<Parameters<typeof translateText>[0], "evidence"> & {
  readonly store: RoutineDataStore;
  readonly primary: WorkerPublicationCapture;
  readonly captures: readonly WorkerPublicationCapture[];
}) {
  const usage: { model: string; usage: ReturnType<typeof readMeteredUsage>; usd: number | null }[] = [];
  let stage: TranslationLearning["stage"] = "WRITER";
  try {
    if (!captureIntact(input.primary)) throw new Error("Text translation source is incomplete.");
    const evidence = input.primary.evidence;
    const verified = section3Page({ url: evidence.canonicalUrl, text: evidence.text, retrievedAt: evidence.retrievedAt,
      linkingPage: linkingPageFrom(evidence.canonicalUrl, input.captures.filter(captureIntact).map(row => row.evidence)), sourcePolicy: input.primary.sourcePolicy },
    input.subject.kind === "MEASURE_TEXT" ? "BALLOT_MEASURE" : input.subject.kind === "AGENDA" || input.subject.kind === "MINUTES" ? "MEETING" : "OFFICIAL_BOARD_DIRECTORY", input.now);
    if (!verified.ok) throw new Error("Text translation source is stale or lacks official standing.");
    const hash = (evidence.sourceDocument?.contentHash ?? evidence.contentHash).replace(/^sha256-/, "");
    const held = await readTranslations([input.subject.ocdId], { store: input.store, now: input.now, bypassCache: true });
    const current = held.find(row => row.kind === input.subject.kind && row.subjectId === input.subject.subjectId &&
      row.ocdId === input.subject.ocdId && row.sourceUrl === evidence.canonicalUrl && row.sourceHash === hash && row.sourceTextHash === translationHash(evidence.text) &&
      (!input.preservedText || row.text === input.preservedText.text && JSON.stringify(row.curatedOrigin) === JSON.stringify(input.preservedText.origin)));
    if (current) return { status: "REUSED" as const, record: current, usage, versionId: null };
    const { record } = await translateText({ ...input, evidence, transportFor: subject => {
      const send = input.transportFor(subject);
      return async request => {
        stage = request.tools[0]?.name === "check_measure_translation" ? "CHECKER" : "WRITER";
        const response = await send(request), metered = readMeteredUsage(response.usage, response.batch === true);
        usage.push({ model: response.model, usage: metered, usd: priceMeteredUsage(response.model, metered, "5m").usd });
        return response;
      };
    } });
    stage = "PUBLICATION";
    const published = await publishTranslation(input.store, { record, captures: input.captures, now: input.now });
    if (!published.promoted || published.readerReadback?.status !== "PASS") throw new Error(published.candidate.failureDetail ?? "Text translation has not reached its typed reader.");
    return { status: "PUBLISHED" as const, record, usage, versionId: published.promoted.versionId };
  } catch (error) {
    const detail = sanitizedErrorDiagnostic(error);
    const learned = await recordTranslationHold({ repos: input.repos, subjectId: input.subject.subjectId,
      ocdId: input.subject.ocdId, state: input.subject.state, sourceUrl: input.primary.evidence.canonicalUrl,
      sourceHash: (input.primary.evidence.sourceDocument?.contentHash ?? input.primary.evidence.contentHash).replace(/^sha256-/, ""),
      now: input.now, stage, reason: detail, calls: usage });
    return { status: "HELD" as const, record: null, usage, versionId: null, detail, ...learned };
  }
}
