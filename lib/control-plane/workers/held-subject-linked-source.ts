import { performance } from "node:perf_hooks";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { heldCaptureReader } from "../../civic-data/worker-publication-context.ts";
import type { WorkerPublicationCapture } from "../../civic-data/worker-roster-publication.ts";
import { FleetSafetyController } from "../fleet-safety.ts";
import { EMPTY_SPEND } from "../spend-window.ts";
import { ZERO_COST, type AttemptCost, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability } from "../capability.ts";
import type { Artifact } from "../evidence/artifact.ts";
import { putArtifact } from "../evidence/store.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import { contentHash, fingerprint } from "../ids.ts";
import type { RouteTask } from "../route-task.ts";
import type { DeclaredExecutor, WorkArtifact } from "../scheduler/dispatch.ts";
import { routeExecutor } from "../scheduler/route-executor.ts";
import { websiteSizeFromHoldings, type WebsiteSizeForUrl } from "../scheduler/host-supervision.ts";
import { RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import { readHeldSubjectDetails } from "../scheduler/providers/held-subject-loader.ts";
import { publishHeldSubjectDetails } from "../scheduler/providers/held-subject-publication.ts";
import { heldStatementLinks, heldStatementFacts } from "../scheduler/providers/held-official-details.ts";
import type { HeldSubjectDetails } from "../scheduler/providers/held-subject-enrichment.ts";
import { enqueueWorkerTask, FLEET_POLICY_VERSION } from "./runtime.ts";
import { assertFleetResult } from "./types.ts";
import type { AcquirerResult } from "./research-types.ts";
import type { HeldSubjectWorkerRuntime } from "./held-subject-worker.ts";
import { readHeldSubjectSource, readHeldSubjectSourceCapture } from "./held-subject-source.ts";

const CLASS = "HELD_SUBJECT_DETAILS", VERSION = "held-subject-linked-statement/1";
export interface HeldLinkedSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly websiteSize?: WebsiteSizeForUrl;
  /** The existing safety gate's clock/sleep seams, for tests without publisher delays. */
  readonly sleep?: (ms: number) => Promise<unknown>;
}

export function isHeldSubjectLinkedSourceTask(task: RouteTask): boolean {
  return task.workerTask?.role === "ACQUIRER" && task.workerTask.contract.schemaVersion === 2 &&
    task.workerTask.contract.recordClass === CLASS && task.workerTask.contract.identity.namespace === VERSION;
}

/** The existing own-profile worker queues each exact dated statement link separately, on the same held official. */
export async function enqueueHeldSubjectLinkedSources(repos: ControlPlaneRepositories, input: {
  readonly workItemId: string; readonly sourceRouteTaskId: string; readonly artifactId: string;
  readonly subject: HeldSubjectDetails; readonly capture: WorkerPublicationCapture;
  readonly state: string; readonly methodVersion: number; readonly now: string;
}): Promise<readonly RouteTask[]> {
  const held = await readHeldSubjectSource(repos, input.workItemId, input.sourceRouteTaskId, input.artifactId);
  if (!held || held.item.subject !== input.subject.subjectId || input.capture.evidence.artifactId !== input.artifactId ||
    input.capture.evidence.contentHash !== held.record.contentHash || input.capture.evidence.acquiredByAttemptId !== held.record.attemptId ||
    input.capture.observedAt !== held.record.recordedAt || !/^[A-Z]{2}$/.test(input.state)) return [];
  const tasks: RouteTask[] = [];
  for (const link of heldStatementLinks(input.subject, input.capture)) {
    const start = input.capture.evidence.text.indexOf(link.quote);
    if (start < 0) continue;
    tasks.push(await enqueueWorkerTask(repos, { workItemId: input.workItemId, artifactId: input.artifactId, role: "ACQUIRER", now: input.now,
      contract: { schemaVersion: 2, recordClass: CLASS, subjectId: held.item.subject,
        jurisdiction: { country: "US", state: input.state, canonicalId: held.item.subject },
        identity: { namespace: VERSION, keyFields: ["subjectId", "canonicalUrl"] },
        sourceScope: { sourceId: VERSION, publisher: new URL(link.url).hostname, routeIds: [input.sourceRouteTaskId],
          canonicalUrls: [...new Set([held.sourceUrl, held.record.canonicalUrl, link.url])], observationArtifactIds: [input.artifactId] },
        methodVersion: input.methodVersion, requiredFields: [], expectedSourceDate: held.record.recordedAt,
        completenessScope: "One source explicitly linked by this held official's own captured profile; article speaker and date require their own evidence.",
        extraction: { format: "HTML_PROFILE", fields: {} }, verification: { required: false, authorities: [] } },
      acquisition: { route: { id: `${VERSION}:${fingerprint([link.url])}`, subjectId: held.item.subject, jurisdiction: input.state,
        recordClass: CLASS, sourceId: new URL(link.url).hostname, publisher: new URL(link.url).hostname,
        url: link.url, observedLocator: link.url, observedAt: input.capture.observedAt, firstObservedAt: input.capture.observedAt,
        // This is the date written by the referrer. It is never passed as the article's publication date.
        sourcePublishedAt: link.postedOn, methodVersion: input.methodVersion, permission: "ALLOWED", retrieval: "fetch_public",
        observation: { artifactId: input.artifactId, contentHash: held.record.contentHash, start, end: start + link.quote.length,
          quote: link.quote, offsetUnit: "UTF16_CODE_UNITS" }, publisherSubjectEvidence: [], nextRouteIds: [],
        applicableBecause: `The held official's own profile explicitly links ${link.title}.` }, held: [] } }));
  }
  return tasks;
}

/** One leased linked source uses the normal HTTP acquisition, vault and independent fact publisher. */
export function heldSubjectLinkedSourceExecutor(runtime: HeldSubjectWorkerRuntime & HeldLinkedSourceOptions, task: RouteTask, holder: string): DeclaredExecutor {
  if (!isHeldSubjectLinkedSourceTask(task)) throw new Error("HELD_LINK_TASK_REQUIRED");
  const spec = task.workerTask!, contract = spec.contract;
  if (contract.schemaVersion !== 2) throw new Error("HELD_LINK_CONTRACT_REQUIRED");
  const worker: WorkerRef = { role: "ACQUIRER", provider: "we-the-people", version: VERSION, instance: holder };
  return { lane: "DETERMINISTIC", workerFor: () => worker, run: async request => {
    const started = performance.now(), usage = { requestCount: 0, bytesFetched: 0 };
    let acquired: { artifact: Artifact; key: string } | null = null;
    const artifacts = (): WorkArtifact[] => acquired ? [{ artifactId: acquired.artifact.id, tier: acquired.artifact.tier,
      contentHash: acquired.artifact.contentHash, byteLength: acquired.artifact.byteLength, contentType: acquired.artifact.contentType,
      canonicalUrl: acquired.artifact.canonicalUrl, partial: false, recordedAt: acquired.artifact.retrievedAt }] : [];
    const cost = (): AttemptCost => ({ ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0,
      durationMs: Math.round(performance.now() - started), ...usage });
    try {
      const route = spec.acquisition?.route;
      if (request.workItemId !== task.workItemId || request.routeTaskId !== task.id || !route || route.subjectId !== contract.subjectId ||
        contract.sourceScope.routeIds.length !== 1 || contract.sourceScope.observationArtifactIds.length !== 1 ||
        contract.sourceScope.observationArtifactIds[0] !== spec.artifactId || route.observation.artifactId !== spec.artifactId ||
        !contract.sourceScope.canonicalUrls.includes(route.url)) throw new Error("HELD_LINK_TASK_BINDING_REFUSED");
      const held = await readHeldSubjectSource(runtime.repos, request.workItemId, contract.sourceScope.routeIds[0]!, spec.artifactId);
      if (!held || held.item.subject !== contract.subjectId || held.record.recordedAt !== contract.expectedSourceDate ||
        route.observation.contentHash !== held.record.contentHash || route.observedAt !== held.record.recordedAt ||
        contract.sourceScope.canonicalUrls[0] !== held.sourceUrl) throw new Error("HELD_LINK_REFERRER_RECEIPT_REFUSED");
      const referrer = await readHeldSubjectSourceCapture(runtime.vault, held);
      const subject = await readHeldSubjectDetails(runtime.db.query, contract.jurisdiction.state, contract.subjectId, runtime.now());
      if (!subject || subject.subjectKind !== "official" || !subject.profileUrls.includes(held.sourceUrl)) throw new Error("HELD_LINK_KNOWN_OFFICIAL_REFUSED");
      const boundSubject = { ...subject, sourceUrls: [...new Set([...subject.sourceUrls, held.record.canonicalUrl])],
        profileUrls: [...new Set([...subject.profileUrls, held.record.canonicalUrl])] };
      const link = heldStatementLinks(boundSubject, referrer).find(link => link.url === route.url && link.postedOn === route.sourcePublishedAt &&
        link.quote === route.observation.quote && referrer.evidence.text.slice(route.observation.start, route.observation.end) === link.quote);
      if (!link) throw new Error("HELD_LINK_NOT_IN_ORIGINAL_PROFILE");
      const originalUrl = assertPublicUrl(link.url), origin = new URL(held.record.canonicalUrl).origin;
      if (originalUrl.origin !== origin) throw new Error("HELD_LINK_ORIGIN_REFUSED");
      const attempt = await runtime.repos.attempts.mustRead(request.attemptId);
      if (attempt.value.workItemId !== request.workItemId || attempt.value.routeTaskId !== task.id || attempt.value.outcome !== null) throw new Error("HELD_LINK_ATTEMPT_BINDING_REFUSED");
      const grant = defaultGrant({ role: worker.role, project: held.item.project, policyVersion: FLEET_POLICY_VERSION, grantedAt: attempt.value.startedAt });
      await runtime.repos.attempts.compareAndSet(request.attemptId, attempt.revision, { ...attempt.value, capabilityGrant: grant }, runtime.now());
      requireCapability(grant, "NETWORK_PUBLIC_READ"); requireCapability(grant, "VAULT_WRITE"); requireCapability(grant, "VAULT_READ_SANITIZED");
      let finalUrl = link.url;
      const safety = new FleetSafetyController({ now: runtime.now(), clock: () => Date.parse(runtime.now()),
        // This worker performs public HTTP only; no paid service participates in its admission.
        spend: EMPTY_SPEND,
        websitePacing: runtime.repos.websitePacing, websiteSize: runtime.websiteSize ?? websiteSizeFromHoldings([contract.jurisdiction.state]),
        ...(runtime.sleep ? { sleep: runtime.sleep } : {}) });
      const deadline = Date.now() + Math.max(1, Math.floor(request.bound.maxWallMs - (performance.now() - started)));
      const fetchImpl: typeof fetch = async (resource, init) => {
        request.assertLeaseHealthy?.();
        const url = assertPublicUrl(String(resource));
        if (url.origin !== origin) throw new Error("HELD_LINK_REDIRECT_ORIGIN_REFUSED");
        if (usage.requestCount >= RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost) throw new Error("HELD_LINK_REDIRECT_REQUEST_LIMIT");
        if (Date.now() >= deadline) throw new Error("HELD_LINK_DEADLINE");
        usage.requestCount++;
        const response = await (runtime.fetchImpl ?? fetch)(url.href, { ...init, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        finalUrl = response.url || url.href;
        if (assertPublicUrl(finalUrl).origin !== origin) throw new Error("HELD_LINK_REDIRECT_ORIGIN_REFUSED");
        const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
          usage.bytesFetched += chunk.byteLength; controller.enqueue(chunk);
        } })) ?? null;
        const measured = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        Object.defineProperty(measured, "url", { value: finalUrl });
        return measured;
      };
      const read = routeExecutor({ routeFor: id => id === request.obligation.obligation.id ? { routeId: task.routeId,
        label: "Held official's explicitly linked statement", executorClass: "DETERMINISTIC", executorReason: "Exact original profile link, one held official.",
        open: { kind: "HTTP_GET", url: link.url }, citation: `artifact:${referrer.evidence.artifactId}` } : null,
      openOne: safety.guardedOpenOne("public-web", contract.subjectId, fetchImpl),
      timeoutMs: Math.max(1, deadline - Date.now()), now: runtime.now, vault: async (artifact, text) => {
        const actual = { ...artifact, canonicalUrl: finalUrl, retrievalUrl: finalUrl };
        const saved = await putArtifact(runtime.vault, held.item.project, actual, Buffer.from(text));
        acquired = { artifact: actual, key: saved.key };
        return { stored: true, where: saved.key, why: saved.written ? "written" : "same immutable source already held" };
      } });
      const outcome = await read(request);
      request.assertLeaseHealthy?.();
      if (outcome.kind !== "DISPOSED" || outcome.disposition?.disposition !== "INGESTED" || !acquired) throw new Error(`HELD_LINK_ACQUISITION_FAILED:${outcome.detail}`);
      const saved = acquired as { artifact: Artifact; key: string }, artifact = saved.artifact;
      const record: ArtifactRecord = { ...artifacts()[0]!, workItemId: task.workItemId, routeTaskId: task.id, attemptId: request.attemptId };
      const capture = await heldCaptureReader(runtime.vault, held.item.project)(record);
      if (!capture) throw new Error("HELD_LINK_NEW_CAPTURE_UNREADABLE");
      const linkedSubject = { ...boundSubject, sourceUrls: [...new Set([...boundSubject.sourceUrls, artifact.canonicalUrl])] };
      if (!heldStatementFacts(linkedSubject, capture).length) throw new Error("HELD_LINK_ARTICLE_SPEAKER_OR_DATE_NOT_VERIFIED");
      const publication = await publishHeldSubjectDetails({ subject: linkedSubject, capture, db: runtime.db, clocks: runtime.clocks,
        now: new Date(runtime.now()), purge: runtime.purge, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      if (publication.refused) throw new Error(publication.refused);
      request.assertLeaseHealthy?.();
      const published = publication.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "PUBLISH").length;
      const confirmed = publication.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "CONFIRM").length;
      const dependencies = [...new Set(publication.readerDependencies.map(row => row.ownerChange))];
      const detail = `Read one linked source for the same held official; ${published} new facts stored and ${confirmed} confirmations; ${publication.readerSupportedNewFacts} new facts have an existing reader path. ` +
        `Referrer ${referrer.evidence.artifactId} (${referrer.evidence.contentHash}), acquired ${referrer.observedAt}; source acquired ${capture.observedAt}. Remaining details stay owed.` +
        (dependencies.length ? ` Missing reader edges remain owed: ${dependencies.join(" ")}` : "");
      const measured = cost(), endedAt = runtime.now(), quote = capture.evidence.text.slice(0, 300);
      const result: AcquirerResult = { role: "ACQUIRER", attemptId: request.attemptId, verdict: "ACQUIRED", source: {
        ...route, id: task.routeId, url: artifact.canonicalUrl, sourceId: artifact.sourceId, observedAt: capture.observedAt, firstObservedAt: capture.observedAt,
        sourcePublishedAt: null, observation: { artifactId: artifact.id, contentHash: artifact.contentHash, start: 0, end: quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" },
        publisherSubjectEvidence: [route.observation] }, artifacts: [{ artifactId: artifact.id, sourceRouteId: task.routeId,
        sourceObservationArtifactId: artifact.id, canonicalUrl: artifact.canonicalUrl, sourceId: artifact.sourceId,
        acquisitionAttemptId: request.attemptId, retrievedAt: artifact.retrievedAt, contentHash: artifact.contentHash,
        byteCount: artifact.byteLength, contentType: artifact.contentType, tier: artifact.tier, completeness: "COMPLETE",
        vaultKey: saved.key, transport: "REACHABLE", httpStatus: artifact.httpStatus!, reused: false }], artifactIds: [artifact.id], blockers: [],
        findings: [{ code: "HELD_LINKED_STATEMENT_CHECKED", severity: "INFO", detail }], walk: [{ sequence: 0, at: endedAt, worker,
          attemptId: request.attemptId, routeId: task.routeId, rung: "fetch_public", target: artifact.canonicalUrl,
          applicableBecause: route.applicableBecause, permission: "ALLOWED", transport: "REACHABLE", observed: detail,
          returnedCount: publication.facts.length, artifactIds: [artifact.id], nextRouteIds: [], outcome: "WALKED_AND_FOUND", pass: "INITIAL" }],
        walkState: { state: "OPEN", nextRouteIds: [] }, ...usage };
      assertFleetResult(result, "ACQUIRER", request.attemptId);
      return { kind: "RESULT_RECORDED", ranAs: "DETERMINISTIC", cost: measured, detail, artifacts: artifacts(), workerResult: {
        id: `wr-${fingerprint([request.attemptId])}`, schemaVersion: 1, workItemId: task.workItemId, routeTaskId: task.id,
        attemptId: request.attemptId, worker, grant, methodVersion: attempt.value.methodVersion, policyVersion: attempt.value.policyVersion,
        startedAt: attempt.value.startedAt, endedAt, executionMode: "DETERMINISTIC", cost: measured,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, uncachedInputTokens: 0 },
        inputArtifactIds: [referrer.evidence.artifactId], inputResultIds: [], semanticHash: contentHash(canonicalJson(result)), result } };
    } catch (error) {
      return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: runtime.now(), cost: cost(), artifacts: artifacts(),
        detail: error instanceof Error ? error.message : String(error) };
    }
  } };
}
