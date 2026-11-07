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
import { sourceContentHash } from "./source-hash.ts";
import type { Meeting } from "../sources/types.ts";
import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { agendaReadableText } from "../meetings/agenda-content.ts";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineCandidate } from "./types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import { meetingFetchPass } from "../meetings/shared-fetch.ts";
import { DOOR_KIND_SPECS } from "./derived-door-kinds.ts";
import { factReader } from "../facts/db.ts";
import { MEETING_SOURCE_PROGRESS, meetingFactPublicationPending, type MeetingSourceProgress, type ProgressPage } from "./meeting-source-progress.ts";
import { recordAcquiredResponse } from "../sources/acquisition-trace.ts";
import { outsideSourceAcquisition } from "../sources/acquisition-scope.ts";

type Request = NonNullable<RetainedSourceResponse["request"]>;
export interface MeetingSourceProbe {
  readonly formatVersion: 2;
  readonly complete: boolean;
  readonly normalizationInputHash: string;
  readonly contentHash: string | null;
  readonly meetingIds: readonly string[];
  readonly bodyIds: readonly string[];
}

/** Compare the parsed source before loading history, geocoding or assembling a new payload. */
export function meetingSourceContentHash(meetings: readonly Meeting[], documents: readonly AgendaDocument[], context: unknown = null): string {
  const facts = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(facts);
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    const provenance = "sourceUrl" in row && "sourceOrg" in row;
    return Object.fromEntries(Object.entries(row).filter(([key]) => !provenance ||
      !["collectedAt", "verifiedAt", "checkedAt", "rawHash"].includes(key)).map(([key, child]) => [key, facts(child)]));
  };
  return canonicalCivicDataHash({ context, meetings: meetings.map(meeting => canonicalCivicDataHash(facts(meeting))).sort(),
    documents: documents.map(document => {
      const { id: _id, contentHash, retrievedAt: _at, collectedAt: _collected, verifiedAt: _verified, text: _text, ...fields } = document;
      const text = agendaReadableText(document);
      return canonicalCivicDataHash({ ...fields, text, ...(text === null ? { contentHash } : {}) });
    }).sort() });
}
const sourceIO = new AsyncLocalStorage<boolean>();
const internalIO = <T>(operation:()=>T):T => sourceIO.run(true,()=>outsideSourceAcquisition(operation));
const requestedInOperation = new AsyncLocalStorage<Set<string>>();
const requestKey = (page: Pick<RetainedSourceResponse, "requestedUrl" | "request">) => canonicalCivicDataHash([page.requestedUrl,
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
  dependencies: { readonly checkpoint?: Pick<CivicReadCache, "readCheckpoint" | "checkpoint">; readonly fetchImpl?: typeof fetch;
    readonly publicationPending?: () => Promise<boolean> } = {}) {
  const head = await store.readSourceHead("MEETING", partition.scope);
  const publicationPending=dependencies.publicationPending??(async()=>{const query=factReader();return query?meetingFactPublicationPending(query,partition.scope):false;});
  const cache = dependencies.checkpoint ?? runtimeCivicReadCache().jobState(), context = canonicalCivicDataHash([partition.sourceId, partition.scope, normalizationInputHash]);
  const saved = await cache.readCheckpoint<MeetingSourceProgress>(MEETING_SOURCE_PROGRESS, partition.scope);
  const pages: Record<string, ProgressPage> = saved?.context === context ? { ...saved.pages } : {};
  let deferred = saved?.context === context && saved.deferred === true;
  let checkpointWrites=Promise.resolve(),finished=false;
  const checkpoint = (value:MeetingSourceProgress) => {
    const write=checkpointWrites.then(()=>internalIO(()=>cache.checkpoint(MEETING_SOURCE_PROGRESS,partition.scope,value,context)));
    checkpointWrites=write.catch(()=>{});return write;
  };
  const save = () => checkpoint({context,pages:{...pages},deferred});
  const responses = new Map<string, RetainedSourceResponse>();
  const failures = new Map<string, Response | Error>();
  const freshForMs = currentMeetingClock().hotEveryMs;
  const original = dependencies.fetchImpl ?? globalThis.fetch;
  let networkTransport = original;
  const transport = meetingFetchPass({ fetchImpl: (input, init) => networkTransport(input, init) });
  let complete = true;
  const fetchSource = (async (input, init) => {
    if (sourceIO.getStore()) return original(input, init);
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestedUrl);
    if (/(?:^|\.)(?:neon\.tech|neon\.build|blob\.netlify\.com)$/.test(url.hostname) ||
      requestedUrl.startsWith(process.env.WTP_CIVIC_READ_CACHE_URL ?? "\u0000")) return original(input, init);
    if (url.protocol !== "https:") { complete = false; return networkTransport(input, init); }
    if (!meetingSourceBudgetAvailable()) {
      deferred = true; await save();
      throw new Error("MEETING_SOURCE_CONTINUATION_PENDING");
    }
    const method = (init?.method ?? (input instanceof globalThis.Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString()
      : input instanceof globalThis.Request && !["GET", "HEAD"].includes(method) && init?.body === undefined ? await input.clone().text() : undefined;
    const headers = new Headers(init?.headers ?? (input instanceof globalThis.Request ? input.headers : undefined));
    const publicHeaders = ["accept", "accept-language", "content-type", "referer", "origin", "user-agent", "x-requested-with", "prefer", "odata-version"];
    const probeable = (!init?.body || body !== undefined) && [...headers.keys()].every(key => publicHeaders.includes(key)) &&
      (body === undefined || body.length <= 1024 * 1024 && !/["']?(?:password|secret|access[_-]?token|api[_-]?key)["']?\s*[:=]/i.test(body));
    const request: Request = { method, ...(body === undefined ? {} : { body }),
      headers: Object.fromEntries(publicHeaders.flatMap(key => headers.has(key) ? [[key, headers.get(key)!]] : [])) };
    const key = requestKey({ requestedUrl, request }), prior = pages[key];
    const failed = failures.get(key);
    if (failed instanceof Error) throw failed;
    if (failed) return failed.clone();
    if (probeable && prior && Date.parse(prior.response.retrievedAt) > Date.parse(now) - freshForMs) {
      const held = await internalIO(() => vault.get(prior.vaultKey));
      if (held && createHash("sha256").update(held.bytes).digest("hex") === prior.response.rawHash) {
        responses.set(key, { ...prior.response, bytes: held.bytes });
        recordAcquiredResponse({requestedUrl,finalUrl:prior.response.finalUrl,httpStatus:prior.response.httpStatus,bytes:held.bytes});
        requestedInOperation.getStore()?.add(key);
        await internalIO(async () => onSource?.({ ...prior.response, bytes: held.bytes }));
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
      deferred ||= !meetingSourceBudgetAvailable(); await save();
      throw error;
    }
    const finalUrl = response.url || requestedUrl;
    if (!response.ok || response.status === 206 || !finalUrl.startsWith("https://")) {
      complete = false; failures.set(key, response.clone());
      await save();
      return response;
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer()), rawHash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length > 16 * 1024 * 1024) { complete = false; return response; }
    const retrievedAt = initial?.requestedUrl === requestedUrl && initial.finalUrl === finalUrl && initial.rawHash === rawHash
      ? initial.retrievedAt : new Date().toISOString();
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const saveRequest = probeable && !response.headers.has("set-cookie");
    const retained: RetainedSourceResponse = { source: partition.meetingSource, requestedUrl, finalUrl, httpStatus: response.status,
      rawHash, byteCount: bytes.length, bytes, retrievedAt, contentType, ...(saveRequest ? { request } : {}) };
    const contentHash = `sha256-${rawHash}`, tier = classifyAcquisition(new TextDecoder().decode(bytes)).tier;
    const artifact: Artifact = { id: artifactId(tier, contentHash), tier, contentHash, byteLength: bytes.length, contentType,
      canonicalUrl: requestedUrl, retrievalUrl: finalUrl, retrievedAt, httpStatus: response.status, headers: {},
      sourceId: partition.sourceId, methodRouteId: partition.id, workItemId: `meeting-source:${partition.scope}:${canonicalCivicDataHash([key, finalUrl])}`,
      attemptId: `meeting-source:${context}:${retrievedAt}`, permission: "ALLOWED", transport: "REACHABLE", retentionPolicy: defaultRetention(tier) };
    const stored = await internalIO(async () => {
      const key = objectKey("freshness", artifact), earlier = await vault.get(key);
      if (earlier?.meta.contentHash === contentHash && earlier.meta.custom?.canonicalUrl === requestedUrl &&
        earlier.meta.custom?.retrievalUrl === finalUrl && createHash("sha256").update(earlier.bytes).digest("hex") === rawHash) return { key };
      return putArtifact(vault, "freshness", artifact, bytes);
    });
    const { bytes: _bytes, ...metadata } = retained;
    if (saveRequest) pages[key] = { response: metadata, vaultKey: stored.key };
    responses.set(key, retained);
    requestedInOperation.getStore()?.add(key);
    await save();
    await internalIO(async () => onSource?.(retained));
    return response;
  }) as typeof fetch;
  return { head, responses, fetch: fetchSource, get complete() { return complete; }, get acquisitionComplete() { return complete; },
    forgetGet: transport.forgetGet,
    inputs<T>(operation: () => Promise<T>): Promise<T> { return internalIO(operation); },
    async collect<T>(operation: () => Promise<T>) {
      const keys = new Set<string>();
      const value = await requestedInOperation.run(keys, operation);
      return { value, responses: [...keys].flatMap(key => responses.has(key) ? [responses.get(key)!] : []) };
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const prior = globalThis.fetch, priorTransport = networkTransport;
      // The existing acquisition counter wraps fetch outside this session. Bound adapter fetches
      // still pass through it, while vault/checkpoint traffic continues to use the original transport.
      if (prior !== fetchSource && !dependencies.fetchImpl) networkTransport = prior;
      globalThis.fetch = fetchSource;
      try { return await operation(); } finally { globalThis.fetch = prior; networkTransport = priorTransport; }
    },
    async clear() {
      if (await internalIO(publicationPending)) { deferred=true; await save(); return; }
      deferred=false;finished=true;
      await checkpoint({context,pages:{},deferred:false});
    },
    async defer() { deferred=true; await save(); },
    watchTermination() {
      const savePending = () => { if(finished)return;deferred=true;void save(); };
      process.once("SIGTERM", savePending);
      const delay = passDeadlineFromEnv() - Date.now() - 40_000;
      const timer = Number.isFinite(delay) ? setTimeout(savePending, Math.max(0, delay)) : undefined;
      timer?.unref();
      return () => { if (timer) clearTimeout(timer); process.removeListener("SIGTERM", savePending); };
    },
  };
}

export async function confirmMeetingSource(input: {
  readonly store: RoutineDataStore;
  readonly partition: MeetingPartitionContract;
  readonly normalizationInputHash: string;
  readonly contentHash: string;
  readonly complete: boolean;
  readonly now: string;
  readonly session: Awaited<ReturnType<typeof meetingSourceSession>>;
  readonly continueFacts: (plan: MeetingSourceProbe) => Promise<unknown>;
}) {
  const head = input.session.head;
  if (!head || !input.complete || !input.session.acquisitionComplete || !input.store.confirmUnchanged ||
    head.sourceId !== input.partition.sourceId || head.recordClass !== "MEETING" || head.scope !== input.partition.scope || head.candidateState !== "PROMOTED" || !head.acquisitionSucceeded ||
    head.acquisitionComplete === false || head.imported || head.versionId !== head.lastKnownGoodVersionId ||
    head.parserVersion !== "meetings-composite/2" || !head.normalizedHash) return null;
  const plan = await input.store.readCandidatePath<MeetingSourceProbe>(head.versionId, ["normalizedPayload", "sourceProbe"]);
  if (!plan || plan.formatVersion !== 2 || !plan.complete || plan.contentHash !== input.contentHash ||
    plan.normalizationInputHash !== input.normalizationInputHash) return null;
  const pages = [...input.session.responses.values()], first = pages[0];
  if (!first) return null;
  const at = input.store.eventObservedAt ? await input.store.eventObservedAt("MEETING", input.partition.scope, input.now) : input.now;
  const result = await input.store.confirmUnchanged({ sourceId: input.partition.sourceId, recordClass: "MEETING", scope: input.partition.scope,
    parserVersion: head.parserVersion, pointerVersionId: head.versionId, readModelHash: head.normalizedHash,
    basis: "READ_MODEL_RECOMPUTED", inputDigest: input.contentHash, retrieval: { requestedUrl: first.requestedUrl, finalUrl: first.finalUrl,
      httpStatus: first.httpStatus, retrievedAt: pages.map(page => page.retrievedAt).sort()[0]!,
      rawHash: sourceContentHash(pages.map(page => ({ ...page, capture: { rawHash: page.rawHash } }))) } }, at);
  if (result.kind !== "CONFIRMED") return null;
  await input.continueFacts(plan);
  return { head, at: result.at };
}

export function withMeetingSourceProbe(candidate: RoutineCandidate, partition: MeetingPartitionContract, normalizationInputHash: string,
  responses: readonly RetainedSourceResponse[], complete: boolean, acquisitionComplete = complete, contentHash?: string, meetingIds?: readonly string[]): RoutineCandidate {
  const unique = [...new Map(responses.map(response => [requestKey(response), response])).values()];
  if (!unique.length || !candidate.retrieval.succeeded) return candidate;
  const sourceRawHash = candidate.retrieval.derived ? candidate.retrieval.rawHash!
    : sourceContentHash(unique.map(page => ({ ...page, capture: { rawHash: page.rawHash } })), { normalizationInputHash });
  const sourceProbe: MeetingSourceProbe = { formatVersion: 2, complete: acquisitionComplete, normalizationInputHash, contentHash: contentHash ?? null,
    meetingIds: meetingIds ?? (candidate.readModel as { meetings: { id: string }[] }).meetings.map(meeting => meeting.id),
    bodyIds: [partition.bodyId] };
  const normalizedPayload = JSON.parse(JSON.stringify({ ...(candidate.normalizedPayload as Record<string, unknown>), sourceProbe }));
  const normalizedPayloadHash = canonicalCivicDataHash(normalizedPayload);
  return { ...candidate, id: `cv-${canonicalCivicDataHash([candidate.id, sourceRawHash, normalizedPayloadHash]).slice(0, 32)}`,
    retrieval: { ...candidate.retrieval, rawHash: sourceRawHash, rawHashBasis: "SOURCE_CONTENT_V1", complete: acquisitionComplete }, normalizedPayload,
    normalization: { ...candidate.normalization, normalizedPayloadHash } };
}
