import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
import { meetingFetchPass } from "../meetings/shared-fetch.ts";
import { DOOR_KIND_SPECS } from "./derived-door-kinds.ts";

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
  /** A complete public adapter session may use ephemeral cookies that are never persisted for replay. */
  readonly acquisitionComplete?: boolean;
  readonly normalizationInputHash: string;
  readonly sourceRawHash: string;
  readonly sourceHashKind: "REQUESTS" | "DERIVED_INPUTS";
  readonly requests: readonly MeetingSourcePage[];
  readonly meetingIds: readonly string[];
  readonly bodyIds: readonly string[];
}
interface ProgressPage { readonly response: Omit<RetainedSourceResponse, "bytes">; readonly vaultKey: string }
interface MeetingSourceProgress { readonly context: string; readonly pages: Readonly<Record<string, ProgressPage>>; readonly deferred?: boolean }
const PROGRESS = "meeting-source-probe:v1";
const sourceIO = new AsyncLocalStorage<boolean>();
const requestedInOperation = new AsyncLocalStorage<Set<string>>();
const requestKey = (page: Pick<MeetingSourcePage, "requestedUrl" | "request">) => canonicalCivicDataHash([page.requestedUrl,
  page.request?.method ?? "GET", page.request?.body ?? null, Object.keys(page.request?.headers ?? {}).length ? page.request!.headers : null]);

/** Door content, dependencies and the rolling day are inputs; observations of the same source are not. */
const implementationHashes = new Map<string, string>();
/** The executing adapter and agenda parser, including their local runtime imports, are normalization inputs. */
export function meetingSourceImplementationHash(partition: MeetingPartitionContract): string {
  const sourceNames = partition.derivedFamily ? ["ical", "official-page-events", "diligent", ...Object.values(DOOR_KIND_SPECS).map(spec => spec.sourceName)] : [partition.meetingSource];
  const key = [...new Set(sourceNames)].sort().join(",");
  const held = implementationHashes.get(key); if (held) return held;
  const root = process.cwd(), seen = new Map<string, string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    const text = readFileSync(join(root, path), "utf8"); seen.set(path, text);
    for (const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\bimport\s*\()\s*["'](\.[^"']+)["']/g)) {
      const base = resolve(root, dirname(path), match[1]);
      const target = [base, `${base}.ts`, `${base}.mts`, `${base}.json`, join(base, "index.ts")].find(file => existsSync(file) && /\.(?:[cm]?ts|json)$/.test(file));
      if (target) visit(target.slice(root.length + 1));
    }
  };
  for (const path of ["scripts/ingest.ts", "pnpm-lock.yaml"]) seen.set(path, readFileSync(join(root, path), "utf8"));
  for (const path of ["lib/civic-data/meeting-source-probe.ts", "lib/civic-data/derived-meeting-acquisition.ts", "lib/civic-data/derived-meeting-family.ts",
    "lib/civic-data/meeting-fact-publication.ts", "lib/civic-data/candidate-builders.ts", "lib/meetings/agenda-documents.ts", "lib/meetings/snapshot.ts",
    "lib/sources/feed-kinds.ts", ...sourceNames.map(source => `lib/sources/${source}/index.ts`).filter(path => existsSync(join(root, path)))]) visit(path);
  const installed = join(root, "lib/sources/platform-adapters");
  if (existsSync(installed)) for (const name of readdirSync(installed).filter(name => name.endsWith(".ts"))) visit(`lib/sources/platform-adapters/${name}`);
  const hash = canonicalCivicDataHash([...seen].sort(([a], [b]) => a.localeCompare(b)));
  implementationHashes.set(key, hash); return hash;
}

export function meetingSourceInputHash(partition: MeetingPartitionContract, now: string, dependencies: unknown = null): string {
  const wiring = partition.wiring;
  return canonicalCivicDataHash(["MEETING_SOURCE_PLAN_V1", partition.sourceId, partition.scope, partition.meetingSource, partition.bodyId, partition.ocdId,
    wiring ? [wiring.agendaSourceType, wiring.config, wiring.noticeUrl, wiring.publishingOrg, wiring.timeZone, wiring.jurisdiction, wiring.ocdId] : null, dependencies, now.slice(0, 10),
    currentMeetingClock(), meetingSourceImplementationHash(partition)]);
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
  let networkTransport = original;
  const transport = meetingFetchPass({ fetchImpl: (input, init) => networkTransport(input, init) });
  let complete = true, replayable = true;
  const fetchSource = (async (input, init) => {
    if (sourceIO.getStore()) return original(input, init);
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestedUrl);
    if (/(?:^|\.)(?:neon\.tech|neon\.build|blob\.netlify\.com)$/.test(url.hostname) ||
      requestedUrl.startsWith(process.env.WTP_CIVIC_READ_CACHE_URL ?? "\u0000")) return original(input, init);
    if (url.protocol !== "https:") { complete = false; return networkTransport(input, init); }
    if (!meetingSourceBudgetAvailable()) {
      await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages, deferred: true }, context));
      throw new Error("MEETING_SOURCE_CONTINUATION_PENDING");
    }
    const method = (init?.method ?? (input instanceof globalThis.Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString()
      : input instanceof globalThis.Request && !["GET", "HEAD"].includes(method) && init?.body === undefined ? await input.clone().text() : undefined;
    const headers = new Headers(init?.headers ?? (input instanceof globalThis.Request ? input.headers : undefined));
    const publicHeaders = ["accept", "accept-language", "content-type", "referer", "origin", "user-agent", "x-requested-with", "prefer", "odata-version"];
    const probeable = (!init?.body || body !== undefined) && [...headers.keys()].every(key => publicHeaders.includes(key)) &&
      (body === undefined || body.length <= 1024 * 1024 && !/["']?(?:password|secret|access[_-]?token|api[_-]?key)["']?\s*[:=]/i.test(body));
    if (!probeable) replayable = false;
    const request: Request = { method, ...(body === undefined ? {} : { body }),
      headers: Object.fromEntries(publicHeaders.flatMap(key => headers.has(key) ? [[key, headers.get(key)!]] : [])) };
    const key = requestKey({ requestedUrl, request }), prior = pages[key];
    const failed = failures.get(key);
    if (failed instanceof Error) throw failed;
    if (failed) return failed.clone();
    if (probeable && prior && Date.parse(prior.response.retrievedAt) > Date.parse(now) - freshForMs) {
      const held = await sourceIO.run(true, () => vault.get(prior.vaultKey));
      if (held && createHash("sha256").update(held.bytes).digest("hex") === prior.response.rawHash) {
        responses.set(key, { ...prior.response, bytes: held.bytes });
        requestedInOperation.getStore()?.add(key);
        await sourceIO.run(true, async () => onSource?.({ ...prior.response, bytes: held.bytes }));
        const response = new Response(new Uint8Array(held.bytes), { status: prior.response.httpStatus, headers: { "content-type": prior.response.contentType } });
        Object.defineProperty(response, "url", { value: prior.response.finalUrl }); return response;
      }
    }
    const deadline = AbortSignal.timeout(Math.max(1, Math.min(30_000, passDeadlineFromEnv() - Date.now() - 40_000)));
    const sourceSignal = init?.signal ?? (input instanceof globalThis.Request ? input.signal : undefined);
    let response: Response;
    try { response = await transport(input, { ...init, signal: sourceSignal ? AbortSignal.any([sourceSignal, deadline]) : deadline }); }
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
    const saveRequest = probeable && !response.headers.has("set-cookie");
    if (!saveRequest) replayable = false;
    const retained: RetainedSourceResponse = { source: partition.meetingSource, requestedUrl, finalUrl, httpStatus: response.status,
      rawHash, byteCount: bytes.length, bytes, retrievedAt, contentType, ...(saveRequest ? { request } : {}) };
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
    if (saveRequest) pages[key] = { response: metadata, vaultKey: stored.key };
    responses.set(key, retained);
    requestedInOperation.getStore()?.add(key);
    await sourceIO.run(true, () => cache.checkpoint(PROGRESS, partition.scope, { context, pages }, context));
    await sourceIO.run(true, async () => onSource?.(retained));
    return response;
  }) as typeof fetch;
  return { head, responses, fetch: fetchSource, get complete() { return complete && replayable; }, get acquisitionComplete() { return complete; },
    forgetGet: transport.forgetGet,
    inputs<T>(operation: () => Promise<T>): Promise<T> { return sourceIO.run(true, operation); },
    async collect<T>(operation: () => Promise<T>) {
      const keys = new Set<string>();
      const value = await requestedInOperation.run(keys, operation);
      return { value, responses: [...keys].flatMap(key => responses.has(key) ? [responses.get(key)!] : []) };
    },
    async probe(plan: MeetingSourceProbe) {
      for (const page of plan.requests) {
        const response = await fetchSource(page.requestedUrl, { method: page.request?.method ?? "GET", body: page.request?.body, headers: page.request?.headers });
        if (!response.ok) return false;
        transport.forgetGet([page.requestedUrl]);
        // A hash-only pass does not accumulate a state's agenda bytes after their exact source checks.
        const captured = responses.get(requestKey(page));
        if (onSource && captured) responses.set(requestKey(page), { ...captured, bytes: new Uint8Array() });
      }
      return plan.requests.every(page => responses.get(requestKey(page))?.rawHash === page.rawHash &&
        responses.get(requestKey(page))?.finalUrl === page.finalUrl);
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const prior = globalThis.fetch, priorTransport = networkTransport;
      // The existing acquisition counter wraps fetch outside this session. Bound adapter fetches
      // still pass through it, while vault/checkpoint traffic continues to use the original transport.
      if (prior !== fetchSource && !dependencies.fetchImpl) networkTransport = prior;
      globalThis.fetch = fetchSource;
      try { return await operation(); } finally { globalThis.fetch = prior; networkTransport = priorTransport; }
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
    !["REQUESTS", "DERIVED_INPUTS"].includes(plan.sourceHashKind) ||
    plan.normalizationInputHash !== input.normalizationInputHash || plan.sourceRawHash !== head.rawHash) return null;
  try {
    if (!await input.session.probe(plan) || await input.workRemains(plan)) { input.session.responses.clear(); return null; }
  } catch (error) { if (!meetingSourceBudgetAvailable()) throw error; input.session.responses.clear(); return null; }
  const pages = [...input.session.responses.values()], first = pages[0]!;
  const rawHash = plan.sourceHashKind === "REQUESTS" ? sourceContentHash(pages.map(page => ({ ...page, capture: { rawHash: page.rawHash } })),
    { normalizationInputHash: input.normalizationInputHash }) : plan.sourceRawHash;
  const confirmed = await confirmSourceHashUnchanged({ store: input.store, sourceId: input.partition.sourceId, recordClass: "MEETING", scope: input.partition.scope,
    parserVersion: "meetings-composite/2", rawHash, now: input.now, complete: true,
    retrieval: { requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, httpStatus: first.httpStatus,
      retrievedAt: pages.map(page => page.retrievedAt).sort()[0]!, rawHash } });
  if (!confirmed) input.session.responses.clear();
  return confirmed;
}

export function withMeetingSourceProbe(candidate: RoutineCandidate, partition: MeetingPartitionContract, normalizationInputHash: string,
  responses: readonly RetainedSourceResponse[], complete: boolean, acquisitionComplete = complete): RoutineCandidate {
  const unique = [...new Map(responses.map(response => [requestKey(response), response])).values()];
  if (!unique.length || !candidate.retrieval.succeeded) return candidate;
  const sourceRawHash = candidate.retrieval.derived ? candidate.retrieval.rawHash!
    : sourceContentHash(unique.map(page => ({ ...page, capture: { rawHash: page.rawHash } })), { normalizationInputHash });
  const sourceProbe: MeetingSourceProbe = { formatVersion: 1, complete, acquisitionComplete, normalizationInputHash, sourceRawHash,
    sourceHashKind: candidate.retrieval.derived ? "DERIVED_INPUTS" : "REQUESTS",
    requests: unique.map(({ requestedUrl, finalUrl, rawHash, request }) => ({ requestedUrl, finalUrl, rawHash, request })),
    meetingIds: (candidate.readModel as { meetings: { id: string }[] }).meetings.map(meeting => meeting.id),
    bodyIds: [...new Set([...(partition.derivedFamily ? [] : [partition.bodyId]),
      ...(candidate.readModel as { meetings: { bodyId: string }[] }).meetings.map(meeting => meeting.bodyId)])] };
  const normalizedPayload = { ...(candidate.normalizedPayload as Record<string, unknown>), sourceProbe };
  const normalizedPayloadHash = canonicalCivicDataHash(normalizedPayload);
  return { ...candidate, id: `cv-${canonicalCivicDataHash([candidate.id, sourceRawHash, normalizedPayloadHash]).slice(0, 32)}`,
    retrieval: { ...candidate.retrieval, rawHash: sourceRawHash, rawHashBasis: "SOURCE_CONTENT_V1", complete: acquisitionComplete }, normalizedPayload,
    normalization: { ...candidate.normalization, normalizedPayloadHash } };
}

/** Session adapters re-acquire their own ephemeral request sequence, then compare every page before any held output. */
export async function confirmAcquiredMeetingSource(input: Parameters<typeof probeMeetingSource>[0]) {
  const head = input.session.head;
  if (!head || head.rawHashBasis !== "SOURCE_CONTENT_V1" || !input.session.acquisitionComplete) return null;
  const plan = await input.store.readCandidatePath<MeetingSourceProbe>(head.versionId, ["normalizedPayload", "sourceProbe"]);
  if (!plan || !(plan.acquisitionComplete ?? plan.complete) || plan.normalizationInputHash !== input.normalizationInputHash ||
    plan.sourceRawHash !== head.rawHash || !plan.requests.length || !["REQUESTS", "DERIVED_INPUTS"].includes(plan.sourceHashKind)) return null;
  const identity = (page: MeetingSourcePage) => canonicalCivicDataHash([page.requestedUrl, page.finalUrl, page.rawHash, page.request ?? null]);
  const expected = new Set(plan.requests.map(identity));
  // A new or changed calendar/detail page already proves change; never re-walk removed old agenda URLs.
  if ([...input.session.responses.values()].some(page => !expected.has(identity(page)))) return null;
  try {
    for (const page of plan.requests) {
      if ([...input.session.responses.values()].some(acquired => identity(acquired) === identity(page))) continue;
      if (!page.request) return null; // An adapter must perform its own credentialled step.
      await input.session.fetch(page.requestedUrl, { method: page.request.method, body: page.request.body, headers: page.request.headers });
    }
    if (!input.session.acquisitionComplete || [...input.session.responses.values()].some(page => !expected.has(identity(page))) ||
      expected.size !== new Set([...input.session.responses.values()].map(identity)).size || await input.workRemains(plan)) return null;
  } catch (error) { if (!meetingSourceBudgetAvailable()) throw error; return null; }
  const pages = [...input.session.responses.values()], first = pages[0]!;
  const rawHash = plan.sourceHashKind === "REQUESTS" ? sourceContentHash(pages.map(page => ({ ...page, capture: { rawHash: page.rawHash } })),
    { normalizationInputHash: input.normalizationInputHash }) : plan.sourceRawHash;
  return confirmSourceHashUnchanged({ store: input.store, sourceId: input.partition.sourceId, recordClass: "MEETING", scope: input.partition.scope,
    parserVersion: "meetings-composite/2", rawHash, now: input.now, complete: true, retrieval: { requestedUrl: first.requestedUrl, finalUrl: first.finalUrl,
      httpStatus: first.httpStatus, retrievedAt: pages.map(page => page.retrievedAt).sort()[0]!, rawHash } });
}

/** A cut-off acquisition remains the same owed job, with its already captured pages held in the ordinary vault. */
export async function meetingSourceContinuationPending(scope: string,
  checkpoint: Pick<CivicReadCache, "readCheckpoint"> = runtimeCivicReadCache().jobState()): Promise<boolean> {
  const progress = await checkpoint.readCheckpoint<MeetingSourceProgress>(PROGRESS, scope);
  return progress?.deferred === true;
}
