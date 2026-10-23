import { performance } from "node:perf_hooks";
import { datePath, extensionFor, type EvidenceStore } from "../evidence/store.ts";
import { ZERO_COST, type AttemptCost, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability } from "../capability.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { contentHash, fingerprint } from "../ids.ts";
import type { RouteTask } from "../route-task.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { readHeldSubjectDetails } from "../scheduler/providers/held-subject-loader.ts";
import { publishHeldSubjectDetails, type HeldSubjectPublicationInput } from "../scheduler/providers/held-subject-publication.ts";
import { enqueueWorkerTask, FLEET_POLICY_VERSION } from "./runtime.ts";
import { assertFleetResult } from "./types.ts";
import type { AcquirerResult } from "./research-types.ts";
import { readHeldSubjectSource, readHeldSubjectSourceCapture } from "./held-subject-source.ts";
import { enqueueHeldSubjectLinkedSources, heldSubjectLinkedSourceExecutor, isHeldSubjectLinkedSourceTask, type HeldLinkedSourceOptions } from "./held-subject-linked-source.ts";

export const HELD_SUBJECT_DETAILS_CLASS = "HELD_SUBJECT_DETAILS";
const VERSION = "held-subject-details/1";

export function isHeldSubjectDetailsTask(task: RouteTask): boolean {
  return task.workerTask?.role === "ACQUIRER" && task.workerTask.contract.schemaVersion === 2 &&
    task.workerTask.contract.recordClass === HELD_SUBJECT_DETAILS_CLASS;
}

/** Enqueue one already acquired page for one held subject. Admin ordering stays on its existing work item. */
export async function enqueueHeldSubjectDetails(repos: ControlPlaneRepositories, input: {
  readonly workItemId: string; readonly sourceRouteTaskId: string; readonly artifactId: string;
  readonly state: string; readonly methodVersion: number; readonly now: string;
}): Promise<RouteTask | null> {
  const state = input.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const held = await readHeldSubjectSource(repos, input.workItemId, input.sourceRouteTaskId, input.artifactId);
  if (!held) return null;
  return enqueueWorkerTask(repos, { workItemId: input.workItemId, artifactId: input.artifactId, role: "ACQUIRER", now: input.now,
    contract: { schemaVersion: 2, recordClass: HELD_SUBJECT_DETAILS_CLASS, subjectId: held.item.subject,
      jurisdiction: { country: "US", state, canonicalId: held.item.subject }, identity: { namespace: VERSION, keyFields: ["subjectId"] },
      sourceScope: { sourceId: VERSION, publisher: new URL(held.record.canonicalUrl).hostname,
        routeIds: [input.sourceRouteTaskId], canonicalUrls: [...new Set([held.sourceUrl, held.record.canonicalUrl])], observationArtifactIds: [input.artifactId] },
      methodVersion: input.methodVersion, requiredFields: [], expectedSourceDate: held.record.recordedAt,
      completenessScope: "Only independently verified owed details for this exact held subject; every unsupported fact remains owed.",
      extraction: { format: "HTML_PROFILE", fields: {} }, verification: { required: false, authorities: [] } } });
}

export interface HeldSubjectWorkerRuntime extends Pick<HeldSubjectPublicationInput, "db" | "clocks" | "purge" | "storePortrait">, HeldLinkedSourceOptions {
  readonly repos: ControlPlaneRepositories;
  readonly vault: EvidenceStore;
  readonly now: () => string;
  /** Counters for the injected image reader only; a saved page makes no source request. */
  readonly portraitUsage?: () => Pick<AttemptCost, "requestCount" | "bytesFetched">;
}

/** Saved bytes enter the existing fact checker/publisher; this worker performs no page discovery or model work. */
export function heldSubjectDetailsExecutor(runtime: HeldSubjectWorkerRuntime, task: RouteTask, holder: string): DeclaredExecutor {
  if (isHeldSubjectLinkedSourceTask(task)) return heldSubjectLinkedSourceExecutor(runtime, task, holder);
  if (!isHeldSubjectDetailsTask(task)) throw new Error("HELD_DETAIL_TASK_REQUIRED");
  const spec = task.workerTask!, contract = spec.contract;
  if (contract.schemaVersion !== 2) throw new Error("HELD_DETAIL_CONTRACT_REQUIRED");
  const worker: WorkerRef = { role: "ACQUIRER", provider: "we-the-people", version: VERSION, instance: holder };
  return { lane: "DETERMINISTIC", workerFor: () => worker, run: async ({ workItemId, routeTaskId, attemptId, bound, assertLeaseHealthy }) => {
    const start = performance.now(), before = runtime.portraitUsage?.();
    let portraitAttempted = false;
    const cost = (): AttemptCost => {
      const after = runtime.portraitUsage?.();
      const delta = (field: "requestCount" | "bytesFetched") => before?.[field] != null && after?.[field] != null
        ? Math.max(0, after[field]! - before[field]!) : portraitAttempted ? null : 0;
      return { ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, durationMs: Math.round(performance.now() - start),
        requestCount: delta("requestCount"), bytesFetched: delta("bytesFetched") };
    };
    try {
      if (workItemId !== task.workItemId || routeTaskId !== task.id || contract.sourceScope.routeIds.length !== 1 ||
        contract.sourceScope.observationArtifactIds.length !== 1 || contract.sourceScope.observationArtifactIds[0] !== spec.artifactId) {
        throw new Error("HELD_DETAIL_TASK_BINDING_REFUSED");
      }
      const held = await readHeldSubjectSource(runtime.repos, workItemId, contract.sourceScope.routeIds[0]!, spec.artifactId);
      if (!held || held.item.subject !== contract.subjectId || held.record.recordedAt !== contract.expectedSourceDate ||
        contract.sourceScope.canonicalUrls[0] !== held.sourceUrl ||
        !contract.sourceScope.canonicalUrls.includes(held.record.canonicalUrl)) throw new Error("HELD_DETAIL_SOURCE_RECEIPT_REFUSED");
      const attempt = await runtime.repos.attempts.mustRead(attemptId);
      if (attempt.value.workItemId !== workItemId || attempt.value.routeTaskId !== routeTaskId || attempt.value.outcome !== null) {
        throw new Error("HELD_DETAIL_ATTEMPT_BINDING_REFUSED");
      }
      const grant = defaultGrant({ role: worker.role, project: held.item.project, policyVersion: FLEET_POLICY_VERSION, grantedAt: attempt.value.startedAt });
      await runtime.repos.attempts.compareAndSet(attemptId, attempt.revision, { ...attempt.value, capabilityGrant: grant }, runtime.now());
      requireCapability(grant, "VAULT_READ_SANITIZED");
      const subject = await readHeldSubjectDetails(runtime.db.query, contract.jurisdiction.state, contract.subjectId, runtime.now());
      if (!subject || !subject.sourceUrls.includes(held.sourceUrl)) throw new Error("HELD_DETAIL_KNOWN_SUBJECT_SOURCE_REFUSED");
      const capture = await readHeldSubjectSourceCapture(runtime.vault, held);
      assertLeaseHealthy?.();
      const result = await publishHeldSubjectDetails({ subject: { ...subject,
        sourceUrls: [...new Set([...subject.sourceUrls, held.record.canonicalUrl])],
        profileUrls: subject.profileUrls.includes(held.sourceUrl)
          ? [...new Set([...subject.profileUrls, held.record.canonicalUrl])] : subject.profileUrls }, capture, db: runtime.db, clocks: runtime.clocks,
        now: new Date(runtime.now()), purge: runtime.purge,
        signal: AbortSignal.timeout(Math.max(1, Math.round(bound.maxWallMs - (performance.now() - start)))),
        ...(runtime.storePortrait ? { storePortrait: async (...args: Parameters<NonNullable<HeldSubjectPublicationInput["storePortrait"]>>) => {
          portraitAttempted = true;
          assertLeaseHealthy?.();
          return runtime.storePortrait!(...args);
        } } : {}) });
      assertLeaseHealthy?.();
      if (result.refused) throw new Error(result.refused);
      let linkedNote = "";
      try {
        const linked = await enqueueHeldSubjectLinkedSources(runtime.repos, { workItemId, sourceRouteTaskId: held.route.id,
          artifactId: spec.artifactId, state: contract.jurisdiction.state, methodVersion: contract.methodVersion,
          subject: { ...subject, sourceUrls: [...new Set([...subject.sourceUrls, held.record.canonicalUrl])],
            profileUrls: subject.profileUrls.includes(held.sourceUrl) ? [...new Set([...subject.profileUrls, held.record.canonicalUrl])] : subject.profileUrls },
          capture, now: runtime.now() });
        if (linked.length) linkedNote = ` ${linked.length} explicitly linked statements remain queued as separate one-source workers.`;
      } catch (error) { linkedNote = ` Linked statement work remains owed: ${error instanceof Error ? error.message : String(error)}.`; }

      const published = result.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "PUBLISH").length + (result.roster?.live ?? 0);
      const confirmed = result.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "CONFIRM").length + (result.roster?.confirmed ?? 0);
      const found = result.facts.length + (result.roster ? result.roster.live + result.roster.confirmed + result.roster.held + result.roster.blanks : 0);
      const dependencies = [...new Set(result.readerDependencies.map(row => row.ownerChange))];
      const note = `Read saved artifact ${held.record.artifactId}, originally acquired ${capture.observedAt}; ${published} new facts stored and ${confirmed} confirmations; ${result.readerSupportedNewFacts} new facts have an existing reader path. ` +
        `Each fact passed its own check; remaining checklist items stay owed. No page was fetched again.${linkedNote}` +
        (dependencies.length ? ` Missing reader edges remain owed: ${dependencies.join(" ")}` : "");
      const endedAt = runtime.now(), measured = cost(), evidence = capture.evidence;
      const quote = evidence.text.slice(0, 300);
      const resultRecord: AcquirerResult = { role: "ACQUIRER", attemptId, verdict: "ACQUIRED",
        source: { id: held.route.routeId, subjectId: subject.subjectId, jurisdiction: contract.jurisdiction.state,
          recordClass: HELD_SUBJECT_DETAILS_CLASS, sourceId: evidence.sourceId, publisher: contract.sourceScope.publisher,
          url: evidence.canonicalUrl, observedLocator: held.sourceUrl, observedAt: capture.observedAt, firstObservedAt: capture.observedAt,
          methodVersion: contract.methodVersion, permission: "ALLOWED", retrieval: "fetch_public", nextRouteIds: [],
          applicableBecause: "This held subject already names this source; only its exact saved receipt was read.",
          observation: { artifactId: evidence.artifactId, contentHash: evidence.contentHash, start: 0, end: quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" },
          publisherSubjectEvidence: [] },
        artifacts: [{ artifactId: evidence.artifactId, sourceRouteId: held.route.routeId, sourceObservationArtifactId: evidence.artifactId,
          canonicalUrl: evidence.canonicalUrl, sourceId: evidence.sourceId, acquisitionAttemptId: evidence.acquiredByAttemptId,
          retrievedAt: evidence.retrievedAt, contentHash: evidence.contentHash, byteCount: held.record.byteLength, contentType: held.record.contentType,
          tier: held.record.tier, completeness: "COMPLETE", transport: "REACHABLE", httpStatus: capture.httpStatus!, reused: true,
          vaultKey: `project/${held.item.project}/source/${evidence.sourceId}/${datePath(evidence.retrievedAt)}/${workItemId}/${evidence.contentHash}.${extensionFor(held.record.contentType)}` }],
        artifactIds: [evidence.artifactId], blockers: [], findings: [{ code: "HELD_DETAILS_CHECKED_AND_PUBLISHED", severity: "INFO", detail: note }],
        walk: [{ sequence: 0, at: endedAt, worker, attemptId, routeId: held.route.routeId, rung: "saved_capture", target: evidence.canonicalUrl,
          applicableBecause: "Read one exact held subject's saved source for its owed details.", permission: "ALLOWED", transport: "REACHABLE",
          observed: note, returnedCount: found, artifactIds: [evidence.artifactId], nextRouteIds: [], outcome: "WALKED_AND_FOUND", pass: "INITIAL" }],
        // Production meters portrait reads too. The existing result validator below
        // refuses an unmetered injected reader rather than record its usage as zero.
        walkState: { state: "OPEN", nextRouteIds: [] }, requestCount: measured.requestCount!, bytesFetched: measured.bytesFetched! };
      assertFleetResult(resultRecord, "ACQUIRER", attemptId);
      return { kind: "RESULT_RECORDED", ranAs: "DETERMINISTIC", cost: measured, detail: note,
        workerResult: { id: `wr-${fingerprint([attemptId])}`, schemaVersion: 1, workItemId, routeTaskId, attemptId, worker, grant,
          methodVersion: attempt.value.methodVersion, policyVersion: attempt.value.policyVersion, startedAt: attempt.value.startedAt,
          endedAt, executionMode: "DETERMINISTIC", cost: measured,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, uncachedInputTokens: 0 },
          inputArtifactIds: [evidence.artifactId], inputResultIds: [], semanticHash: contentHash(canonicalJson(resultRecord)), result: resultRecord } };
    } catch (error) {
      return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: runtime.now(), cost: cost(),
        detail: error instanceof Error ? error.message : String(error) };
    }
  } };
}
