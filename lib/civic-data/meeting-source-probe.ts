import { AsyncLocalStorage } from "node:async_hooks";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import { currentMeetingClock } from "./contracts.ts";
import { createHash } from "node:crypto";
import { artifactId, classifyAcquisition, defaultRetention, type Artifact } from "../control-plane/evidence/artifact.ts";
import { objectKey, putArtifact, type EvidenceStore } from "../control-plane/evidence/store.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { sourceContentHash, confirmSourceHashUnchanged } from "./source-hash.ts";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineCandidate } from "./types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";

type Request = NonNullable<RetainedSourceResponse["request"]>;
export interface MeetingSourcePage {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly rawHash: string;
  readonly request?: Request;
}
export interface MeetingSourceProbe {
  readonly formatVersion: 1;
  readonly complete: boolean;
  readonly normalizationInputHash: string;
  readonly sourceRawHash: string;
  readonly requests: readonly MeetingSourcePage[];
  readonly meetingIds: readonly string[];
  readonly bodyIds: readonly string[];
}
interface ProgressPage { readonly response: Omit<RetainedSourceResponse, "bytes">; readonly vaultKey: string }
interface MeetingSourceProgress { readonly context: string; readonly pages: Readonly<Record<string, ProgressPage>>; readonly deferred?: boolean }
const PROGRESS = "meeting-source-probe:v1";
const sourceIO = new AsyncLocalStorage<boolean>();
const requestKey = (page: Pick<MeetingSourcePage, "requestedUrl" | "request">) => canonicalCivicDataHash([page.requestedUrl,
  page.request?.method ?? "GET", page.request?.body ?? null, Object.keys(page.request?.headers ?? {}).length ? page.request!.headers : null]);

/** Door content, dependencies and the rolling day are inputs; observations of the same source are not. */
export function meetingSourceInputHash(partition: MeetingPartitionContract, now: string, dependencies: unknown = null): string {
  const wiring = partition.wiring;
  return canonicalCivicDataHash(["MEETING_SOURCE_PLAN_V1", partition.sourceId, partition.scope, partition.meetingSource, partition.bodyId, partition.ocdId,
    wiring ? [wiring.agendaSourceType, wiring.config, wiring.noticeUrl, wiring.publishingOrg] : null, dependencies, now.slice(0, 10),
    currentMeetingClock()]);
}

export function meetingSourceBudgetAvailable(): boolean { return Date.now() + 45_000 < passDeadlineFromEnv(); }

/** Actual source pages use the existing evidence vault and the job's existing continuation store. */
export async function meetingSourceSession(partition: MeetingPartitionContract, normalizationInputHash: string,
  store: Pick<RoutineDataStore, "readSourceHead">, now: string, vault: EvidenceStore,
  onSource?: (response: RetainedSourceResponse) => Promise<void>, initial?: RetainedSourceResponse,
  dependencies: { readonly checkpoint?: Pick<CivicReadCache, "readCheckpoint" | "checkpoint">; readonly fetchImpl?: typeof fetch } = {}) {
  const head = await store.readSourceHead("MEETING", partition.scope);
  const cache = dependencies.checkpoint ?? runtimeCivicReadCache().jobState(), context = canonicalCivicDataHash([partition.sourceId, partition.scope, normalizationInputHash]);
  const saved = await cache.readCheckpoint<MeetingSourceProgress>(PROGRESS, partition.scope);
  const pages: Record<string, ProgressPage> = saved?.context === context ? { ...saved.pages } : {};
  const responses = new Map<string, RetainedSourceResponse>();
  const failures = new Map<string, Response | Error>();
  const freshForMs = currentMeetingClock().hotEveryMs;
  const original = dependencies.fetchImpl ?? globalThis.fetch;
  let complete = true;
  const fetchSource = (async (input, init) => {
    if (sourceIO.getStore()) return original(input, init);
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestedUrl);
    if (url.protocol !== "https:" || /(?:^|\.)(?:neon\.tech|neon\.build|blob\.netlify\.com)$/.test(url.hostname) ||
      requestedUrl.startsWith(process.env.WTP_CIVIC_READ_CACHE_URL ?? "\u0000")) return original(input, init);
    if (!meetingSourceBudgetAvailable()) {
      await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: true }, context));
      throw new Error("MEETING_SOURCE_CONTINUATION_PENDING");
    }
    const method = (init?.method ?? (input instanceof globalThis.Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined;
    const headers = new Headers(init?.headers ?? (input instanceof globalThis.Request ? input.headers : undefined));
    const probeable = (!init?.body || body !== undefined) && !["authorization", "cookie", "x-api-key"].some(key => headers.has(key));
    if (!probeable) complete = false;
    const request: Request = { method, ...(body === undefined ? {} : { body }),
      headers: Object.fromEntries(["accept", "content-type", "referer", "origin"].flatMap(key => headers.has(key) ? [[key, headers.get(key)!]] : [])) };
    const key = requestKey({ requestedUrl, request }), prior = pages[key];
    const failed = failures.get(key);
    if (failed instanceof Error) throw failed;
    if (failed) return failed.clone();
    if (probeable && prior && Date.parse(prior.response.retrievedAt) > Date.parse(now) - freshForMs) {
      const held = await sourceIO.run(true, () => vault.get(prior.vaultKey));
      if (held && createHash("sha256").update(held.bytes).digest("hex") === prior.response.rawHash) {
        responses.set(key, { ...prior.response, bytes: held.bytes });
        await sourceIO.run(true, async () => onSource?.({ ...prior.response, bytes: held.bytes }));
        const response = new Response(new Uint8Array(held.bytes), { status: prior.response.httpStatus, headers: { "content-type": prior.response.contentType } });
        Object.defineProperty(response, "url", { value: prior.response.finalUrl }); return response;
      }
    }
    const deadline = AbortSignal.timeout(Math.max(1, Math.min(30_000, passDeadlineFromEnv() - Date.now() - 40_000)));
    const sourceSignal = init?.signal ?? (input instanceof globalThis.Request ? input.signal : undefined);
    let response: Response;
    try { response = await original(input, { ...init, signal: sourceSignal ? AbortSignal.any([sourceSignal, deadline]) : deadline }); }
    catch (error) {
      complete = false; failures.set(key, error instanceof Error ? error : new Error(String(error)));
      await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: !meetingSourceBudgetAvailable() }, context));
      throw error;
    }
    const finalUrl = response.url || requestedUrl;
    if (!response.ok || response.status === 206 || !finalUrl.startsWith("https://")) {
      complete = false; failures.set(key, response.clone());
      await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: false }, context));
      return response;
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer()), rawHash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length > 16 * 1024 * 1024) { complete = false; return response; }
    const retrievedAt = initial?.requestedUrl === requestedUrl && initial.finalUrl === finalUrl && initial.rawHash === rawHash
      ? initial.retrievedAt : new Date().toISOString();
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const retained: RetainedSourceResponse = { source: partition.meetingSource, requestedUrl, finalUrl, httpStatus: response.status,
      rawHash, byteCount: bytes.length, bytes, retrievedAt, contentType, request };
    const contentHash = `sha256-${rawHash}`, tier = classifyAcquisition(new TextDecoder().decode(bytes)).tier;
    const artifact: Artifact = { id: artifactId(tier, contentHash), tier, contentHash, byteLength: bytes.length, contentType,
      canonicalUrl: requestedUrl, retrievalUrl: finalUrl, retrievedAt, httpStatus: response.status, headers: {},
      sourceId: partition.sourceId, methodRouteId: partition.id, workItemId: `meeting-source:${partition.scope}:${canonicalCivicDataHash([key, finalUrl])}`,
      attemptId: `meeting-source:${context}:${retrievedAt}`, permission: "ALLOWED", transport: "REACHABLE", retentionPolicy: defaultRetention(tier) };
    const stored = await sourceIO.run(true, async () => {
      const key = objectKey("freshness", artifact), earlier = await vault.get(key);
      if (earlier?.meta.contentHash === contentHash && earlier.meta.custom?.canonicalUrl === requestedUrl &&
        earlier.meta.custom?.retrievalUrl === finalUrl && createHash("sha256").update(earlier.bytes).digest("hex") === rawHash) return { key };
      return putArtifact(vault, "freshness", artifact, bytes);
    });
    const { bytes: _bytes, ...metadata } = retained;
    pages[key] = { response: metadata, vaultKey: stored.key }; responses.set(key, retained);
    await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages }, context));
    await sourceIO.run(true, async () => onSource?.(retained));
    return response;
  }) as typeof fetch;
  return { head, responses, fetch: fetchSource, get complete() { return complete; },
    async probe(plan: MeetingSourceProbe) {
      for (const page of plan.requests) {
        const response = await fetchSource(page.requestedUrl, { method: page.request?.method ?? "GET", body: page.request?.body, headers: page.request?.headers });
        if (!response.ok) return false;
      }
      return plan.requests.every(page => responses.get(requestKey(page))?.rawHash === page.rawHash &&
        responses.get(requestKey(page))?.finalUrl === page.finalUrl);
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const prior = globalThis.fetch; globalThis.fetch = fetchSource;
      try { return await operation(); } finally { globalThis.fetch = prior; }
    },
    async clear() { await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages: {} }, context)); },
    async defer() { await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: true }, context)); },
    watchTermination() {
      const save = () => { void sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: true }, context)); };
      process.once("SIGTERM", save);
      const delay = passDeadlineFromEnv() - Date.now() - 40_000;
      const timer = Number.isFinite(delay) ? setTimeout(save, Math.max(0, delay)) : undefined;
      timer?.unref();
      return () => { if (timer) clearTimeout(timer); process.removeListener("SIGTERM", save); };
    },
  };
}

export async function probeMeetingSource(input: {
  readonly store: RoutineDataStore;
  readonly partition: MeetingPartitionContract;
  readonly normalizationInputHash: string;
  readonly now: string;
  readonly session: Awaited<ReturnType<typeof meetingSourceSession>>;
  readonly workRemains: (plan: MeetingSourceProbe) => Promise<boolean>;
}) {
  const head = input.session.head;
  const plan = head ? await input.store.readCandidatePath<MeetingSourceProbe>(head.versionId, ["normalizedPayload", "sourceProbe"]) : null;
  if (!head || head.rawHashBasis !== "SOURCE_CONTENT_V1" || !plan || plan.formatVersion !== 1 || !plan.complete || !plan.requests.length ||
    plan.normalizationInputHash !== input.normalizationInputHash || plan.sourceRawHash !== head.rawHash) return null;
  try { if (!await input.session.probe(plan) || await input.workRemains(plan)) return null; }
  catch (error) { if (!meetingSourceBudgetAvailable()) throw error; return null; }
  const pages = [...input.session.responses.values()], first = pages[0]!;
  return confirmSourceHashUnchanged({ store: input.store, sourceId: input.partition.sourceId, recordClass: "MEETING", scope: input.partition.scope,
    parserVersion: "meetings-composite/2", rawHash: plan.sourceRawHash, now: input.now, complete: true,
    retrieval: { requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, httpStatus: first.httpStatus,
      retrievedAt: pages.map(page => page.retrievedAt).sort()[0]!, rawHash: plan.sourceRawHash } });
}

export function withMeetingSourceProbe(candidate: RoutineCandidate, partition: MeetingPartitionContract, normalizationInputHash: string,
  responses: readonly RetainedSourceResponse[], complete: boolean): RoutineCandidate {
  const unique = [...new Map(responses.map(response => [requestKey(response), response])).values()];
  if (!unique.length || !candidate.retrieval.succeeded) return candidate;
  const sourceRawHash = candidate.retrieval.derived ? candidate.retrieval.rawHash!
    : sourceContentHash(unique.map(page => ({ ...page, capture: { rawHash: page.rawHash } })), { normalizationInputHash });
  const sourceProbe: MeetingSourceProbe = { formatVersion: 1, complete, normalizationInputHash, sourceRawHash,
    requests: unique.map(({ requestedUrl, finalUrl, rawHash, request }) => ({ requestedUrl, finalUrl, rawHash, request })),
    meetingIds: (candidate.readModel as { meetings: { id: string }[] }).meetings.map(meeting => meeting.id),
    bodyIds: [...new Set([...(partition.derivedFamily ? [] : [partition.bodyId]),
      ...(candidate.readModel as { meetings: { bodyId: string }[] }).meetings.map(meeting => meeting.bodyId)])] };
  const normalizedPayload = { ...(candidate.normalizedPayload as Record<string, unknown>), sourceProbe };
  const normalizedPayloadHash = canonicalCivicDataHash(normalizedPayload);
  return { ...candidate, id: `cv-${canonicalCivicDataHash([candidate.id, sourceRawHash, normalizedPayloadHash]).slice(0, 32)}`,
    retrieval: { ...candidate.retrieval, rawHash: sourceRawHash, rawHashBasis: "SOURCE_CONTENT_V1" }, normalizedPayload,
    normalization: { ...candidate.normalization, normalizedPayloadHash } };
}

/** A cut-off acquisition remains the same owed job, with its already captured pages held in the ordinary vault. */
export async function meetingSourceContinuationPending(scope: string,
  checkpoint: Pick<CivicReadCache, "readCheckpoint"> = runtimeCivicReadCache().jobState()): Promise<boolean> {
  const progress = await checkpoint.readCheckpoint<MeetingSourceProgress>(PROGRESS, scope);
  return progress?.deferred === true;
}
