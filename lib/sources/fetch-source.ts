import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { publicTransport } from "../hunt/public-transport.ts";
import { assertPublicUrl } from "../hunt/egress.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { admitWebsiteRequest, holdWebsiteAfter, websiteOf, type WebsiteAdmission, type WebsitePacing } from "../control-plane/website-pacing.ts";
import { websiteRequestLimit, websiteSizeFromHoldings, type WebsiteSize, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { DEFAULT_USER_AGENT } from "../control-plane/scheduler/user-agent.ts";
import { recordAcquiredResponse } from "./acquisition-trace.ts";
import { defaultSourceFetchStore, type SavedSourceResponse, type SourceFetchStore, type SourcePrefetchRequest } from "./fetch-source-state.ts";
export type { SourcePrefetchRequest } from "./fetch-source-state.ts";

export interface SourceResponseCapture {
  readonly requestedUrl: string; readonly finalUrl: string; readonly httpStatus: number;
  readonly responseStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
  readonly vaultKey: string; readonly unchanged: boolean;
}
export interface SourceFetchRuntime {
  readonly transport?: typeof fetch; readonly store?: SourceFetchStore; readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}
export interface SourceFetchDeferral {
  readonly until: number; readonly why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE"; readonly url: string;
}
export interface SourceFetchContext {
  readonly sourceId?: string; readonly state?: string; readonly nextDueAt?: string; readonly dueAt?: string;
  readonly websiteSize?: WebsiteSize | WebsiteSizeForUrl;
  readonly vault?: EvidenceStore; readonly pacing?: WebsitePacing; readonly runtime?: SourceFetchRuntime;
  readonly spacingMs?: number;
  readonly onResponse?: (capture: SourceResponseCapture) => void | Promise<void>;
  readonly onDeferred?: (admission: SourceFetchDeferral) => void | Promise<void>;
  readonly sensitiveQueryParameters?: readonly string[];
}
export type SourceFetchInit = RequestInit & { readonly source?: SourceFetchContext };
interface SourceFetchScope extends SourceFetchContext {
  readonly requestCapture?: Map<string, SourcePrefetchRequest>; readonly prefetch?: boolean;
}
const contexts = new AsyncLocalStorage<SourceFetchScope>();
export function runWithSourceFetch<T>(context: SourceFetchContext, operation: () => T): T {
  const previous = contexts.getStore();
  const defined = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
  const runtime = Object.fromEntries(Object.entries(context.runtime ?? {}).filter(([, value]) => value !== undefined));
  const onResponse = previous?.onResponse && context.onResponse && previous.onResponse !== context.onResponse
    ? async (capture: SourceResponseCapture) => { await previous.onResponse!(capture); await context.onResponse!(capture); }
    : context.onResponse ?? previous?.onResponse;
  const onDeferred = previous?.onDeferred && context.onDeferred && previous.onDeferred !== context.onDeferred
    ? async (admission: SourceFetchDeferral) => { await previous.onDeferred!(admission); await context.onDeferred!(admission); }
    : context.onDeferred ?? previous?.onDeferred;
  return contexts.run({ ...previous, ...defined, onResponse, onDeferred, runtime: { ...previous?.runtime, ...runtime } }, operation);
}

export async function runWithSourceRequestPlan<T>(
  group: { readonly kind: "CALENDAR" } | { readonly kind: "DOCUMENT"; readonly targetUrl: string }, operation: () => Promise<T>,
): Promise<T> {
  const context = contexts.getStore() ?? {}, sourceId = context.sourceId ?? process.env.WTP_SOURCE_ID;
  if (!sourceId) throw new Error("SOURCE_REQUEST_PLAN_SOURCE_REQUIRED");
  const state = sourceState(context.state ?? process.env.WTP_SOURCE_STATE ?? "US"), requestCapture = new Map<string, SourcePrefetchRequest>();
  const result = await contexts.run({ ...context, requestCapture }, operation);
  if (group.kind === "DOCUMENT") {
    try { if (safeUrl(group.targetUrl, context) !== assertPublicUrl(group.targetUrl).href) return result; }
    catch { return result; }
  }
  const store = context.runtime?.store ?? await defaultSourceFetchStore();
  await store.saveRequestGroup(state, sourceId, group.kind, group.kind === "DOCUMENT" ? group.targetUrl : null, [...requestCapture.values()]);
  return result;
}

export class SourceFetchDeferred extends Error {
  readonly until: number;
  readonly why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE";
  constructor(admission: Extract<WebsiteAdmission, { ok: false }>) {
    super(`Source website may be checked again at ${new Date(admission.until).toISOString()}`);
    this.name = "SourceFetchDeferred"; this.until = admission.until; this.why = admission.why;
  }
}

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const CHUNK_BYTES = 8 * 1024 * 1024;
const EMPTY_STATUSES = new Set([204, 205, 304]);
export const SOURCE_PREFETCH_MAX_BYTES = 32 * 1024 * 1024;
let defaultVault: EvidenceStore | undefined;
const vaultFor = () => defaultVault ??= new DurableEvidenceStore(join(tmpdir(), "meanwhile-source-vault"));
function safeUrl(raw: string, context: SourceFetchContext): string {
  const url = new URL(raw);
  for (const name of [...url.searchParams.keys()]) {
    if (/^(?:api[-_]?key|key|access[-_]?token|token|auth|authorization|password|secret)$/i.test(name) || context.sensitiveQueryParameters?.includes(name)) url.searchParams.set(name, "[redacted]");
  }
  return url.href;
}
function reusableRequest(request: Request, context: SourceFetchContext, byteCount: number): SourcePrefetchRequest | null {
  if (request.method !== "GET" || safeUrl(request.url, context) !== request.url) return null;
  const headers = [...request.headers].filter(([name]) => !["user-agent", "if-none-match", "if-modified-since"].includes(name));
  if (headers.some(([name]) => !["accept", "accept-language", "content-type"].includes(name))) return null;
  return { url: request.url, headers, redirect: request.redirect, byteCount, ...(context.spacingMs ? { spacingMs: context.spacingMs } : {}) };
}

function sourceState(state: string): string {
  const code = state.toUpperCase().replace(/^US-/, "");
  return /^[A-Z]{2}$/.test(code) && code !== "US" ? `US-${code}` : "US";
}

function requestIdentity(request: SourcePrefetchRequest): string {
  return JSON.stringify([request.url, request.redirect, [...request.headers].sort()]);
}

function captureRequest(request: Request, context: SourceFetchContext, byteCount: number): void {
  const capture = contexts.getStore()?.requestCapture;
  if (!capture) return;
  const descriptor = reusableRequest(request, context, byteCount);
  if (descriptor) capture.set(requestIdentity(descriptor), descriptor);
}

export async function prefetchSourceRequests(input: {
  readonly sourceId: string; readonly state: string; readonly dueAt: string;
  readonly calendarDueAt?: string; readonly phase?: "CALENDAR" | "DOCUMENT";
  readonly documents?: readonly { readonly url: string; readonly nextDueAt: string }[];
  readonly websiteSize?: SourceFetchContext["websiteSize"]; readonly signal?: AbortSignal; readonly seeds?: readonly SourcePrefetchRequest[];
  readonly acquire?: (bytes: number, signal?: AbortSignal) => Promise<() => void>;
}): Promise<void> {
  const previous = contexts.getStore(), runtime = previous?.runtime ?? {};
  const store = runtime.store ?? await defaultSourceFetchStore();
  const state = sourceState(input.state), plan = await store.readRequestPlan(state, input.sourceId);
  const now = (runtime.now ?? Date.now)(), seen = new Set<string>();
  const roots = new Map((input.seeds ?? []).map(request => [requestIdentity(request), request]));
  const read = async (entry: SourcePrefetchRequest, dueAt: string, queryIsCurrent: boolean) => {
    if (!Number.isFinite(entry.byteCount) || entry.byteCount < 0 || entry.byteCount > SOURCE_PREFETCH_MAX_BYTES) return;
    let request: Request;
    try { request = new Request(entry.url, { headers: [...entry.headers], redirect: entry.redirect }); }
    catch { return; }
    if (!reusableRequest(request, previous ?? {}, entry.byteCount) || !queryIsCurrent && new URL(request.url).search) return;
    const identity = requestIdentity(entry);
    if (seen.has(identity)) return;
    seen.add(identity);
    input.signal?.throwIfAborted();
    const release = await input.acquire?.(entry.byteCount, input.signal);
    try {
      await contexts.run({ ...previous, ...input, state, dueAt, nextDueAt: dueAt, spacingMs: entry.spacingMs,
        requestCapture: undefined, prefetch: true, onResponse: undefined, runtime: { ...runtime, store } }, async () => {
        const response = await fetchSource(request, { signal: input.signal ?? AbortSignal.timeout(180_000) });
        await response.body?.cancel();
      });
    } finally { release?.(); }
  };
  const calendarDueAt = input.calendarDueAt ?? input.dueAt;
  const readGroup = async (requests: readonly { entry: SourcePrefetchRequest; dueAt: string; current: boolean }[]) => {
    if (!input.acquire) {
      for (const request of requests) await read(request.entry, request.dueAt, request.current);
      return;
    }
    const results = await Promise.allSettled(requests.map(request => read(request.entry, request.dueAt, request.current)));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  };
  if (input.phase !== "DOCUMENT" && Date.parse(calendarDueAt) <= now) {
    await readGroup([...roots.values(), ...(plan?.calendar ?? [])].map(entry =>
      ({ entry, dueAt: calendarDueAt, current: roots.has(requestIdentity(entry)) })));
  }
  if (input.phase !== "CALENDAR") await readGroup((input.documents ?? []).filter(document => Date.parse(document.nextDueAt) <= now)
    .flatMap(document => (plan?.documents[document.url] ?? []).map(entry =>
      ({ entry, dueAt: document.nextDueAt, current: entry.url === document.url }))));
}
function savedHeaders(headers: Headers, context: SourceFetchContext): [string, string][] {
  const names = new Set(["content-type", "content-length", "content-language", "etag", "last-modified", "cache-control", "expires", "date", "vary", "retry-after", "location"]);
  return [...headers].filter(([name]) => names.has(name)).map(([name, value]) => [name, name === "location"
    ? value.replace(/([?&])([^=&]+)=([^&#]*)/g, (match, separator: string, key: string) =>
      /^(?:api[-_]?key|key|access[-_]?token|token|auth|authorization|password|secret)$/i.test(key) || context.sensitiveQueryParameters?.includes(key) ? `${separator}${key}=[redacted]` : match)
    : value]);
}

async function storeBytes(vault: EvidenceStore, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await vault.put(key, bytes, { contentType, byteLength: bytes.byteLength, contentHash: `sha256-${hash(bytes)}`, objectClass: "IMMUTABLE_BODY" });
}
async function saveBody(vault: EvidenceStore, response: Response, chunkBytes: number): Promise<Pick<SavedSourceResponse, "rawHash" | "byteCount" | "vaultKey" | "chunks"> & { failure?: { error: unknown } }> {
  const digest = createHash("sha256"), chunks: string[] = [];
  let failure: { error: unknown } | undefined;
  let pending: Uint8Array[] = [], used = 0, byteCount = 0;
  const flush = async () => {
    const bytes = pending.length === 1 ? pending[0]! : Buffer.concat(pending, used), key = `project/freshness/source-fetch/body/${hash(bytes)}`;
    await storeBytes(vault, key, bytes, "application/octet-stream");
    chunks.push(key); pending = []; used = 0;
  };
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try { next = await reader.read(); }
        catch (error) { failure = { error }; break; }
        const { done, value } = next;
        if (done) break;
        digest.update(value); byteCount += value.byteLength;
        for (let offset = 0; offset < value.byteLength;) {
          const count = Math.min(chunkBytes - used, value.byteLength - offset);
          pending.push(value.subarray(offset, offset + count)); used += count; offset += count;
          if (used === chunkBytes) await flush();
        }
      }
    } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
    finally {
      if (failure) await reader.cancel(failure.error).catch(() => {});
      reader.releaseLock();
    }
  }
  if (used > 0 || chunks.length === 0) await flush();
  const rawHash = digest.digest("hex");
  if (chunks.length === 1) return { rawHash, byteCount, vaultKey: chunks[0]!, chunks, failure };
  const vaultKey = `project/freshness/source-fetch/body/${rawHash}.json`;
  await storeBytes(vault, vaultKey, new TextEncoder().encode(JSON.stringify({ rawHash, byteCount, chunks })), "application/json");
  return { rawHash, byteCount, vaultKey, chunks, failure };
}

export function sourceResponseBody(vault: EvidenceStore, saved: Pick<SavedSourceResponse, "chunks">): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= saved.chunks.length) { controller.close(); return; }
      const key = saved.chunks[index++]!, object = await vault.get(key);
      if (!object || `sha256-${hash(object.bytes)}` !== object.meta.contentHash) { controller.error(new Error(`Source evidence missing or corrupt: ${key}`)); return; }
      controller.enqueue(object.bytes);
    },
  }, { highWaterMark: 0 });
}
function hydratedResponse(vault: EvidenceStore, saved: SavedSourceResponse, status: number, headers: Headers, finalUrl: string, head: boolean): Response {
  const response = new Response(head || EMPTY_STATUSES.has(status) ? null : sourceResponseBody(vault, saved), { status, headers });
  Object.defineProperty(response, "url", { value: finalUrl });
  return response;
}

export async function fetchSource(input: RequestInfo | URL, init?: SourceFetchInit): Promise<Response> {
  if (init?.source) return runWithSourceFetch(init.source, () => fetchSource(input, { ...init, source: undefined }));
  const context: SourceFetchContext = { sourceId: process.env.WTP_SOURCE_ID, state: process.env.WTP_SOURCE_STATE,
    nextDueAt: process.env.WTP_SOURCE_NEXT_DUE_AT, dueAt: process.env.WTP_SOURCE_DUE_AT, ...contexts.getStore() }, runtime = context.runtime ?? {};
  const store = runtime.store ?? await defaultSourceFetchStore(), vault = context.vault ?? vaultFor();
  const now = runtime.now ?? Date.now, pacing = context.pacing ?? store.pacing;
  const state = context.state?.toUpperCase().replace(/^US-/, "");
  const websiteSize = context.websiteSize ?? websiteSizeFromHoldings(state && state !== "US" ? [state] : []);
  const original = new Request(input, init), start = assertPublicUrl(original.url);
  const scope = contexts.getStore();
  const signal = init?.signal || input instanceof Request ? original.signal : AbortSignal.timeout(180_000);
  let url = start, method = original.method, body = method === "GET" || method === "HEAD" ? undefined : await original.arrayBuffer();
  const baseHeaders = new Headers(original.headers);
  baseHeaders.set("user-agent", DEFAULT_USER_AGENT);
  const responseKeyFor = () => hash(`${original.redirect}\n${method}\n${url.href}\n${JSON.stringify([...baseHeaders].filter(([name]) => !["if-none-match", "if-modified-since", "user-agent"].includes(name)).sort())}\n${body ? hash(new Uint8Array(body)) : ""}`);
  const initialKey = responseKeyFor();
  const read = async (): Promise<Response> => {
    for (let redirects = 0; redirects <= 10; redirects += 1) {
      signal.throwIfAborted();
      assertPublicUrl(url.href);
      const key = responseKeyFor();
      const previous = method === "GET" ? await store.read(key) : null, headers = new Headers(baseHeaders);
      if (previous?.checkKey && context.dueAt && Date.parse(previous.checkedAt) >= Date.parse(context.dueAt)) {
        captureRequest(original, context, previous.byteCount);
        const unchanged = previous.checkStatus === 304, resultHeaders = new Headers([...previous.headers]);
        if (unchanged) resultHeaders.set("x-meanwhile-source-status", "304");
        resultHeaders.set("x-meanwhile-source-reused", "true");
        resultHeaders.set("x-meanwhile-source-checked-at", previous.checkedAt);
        const result = hydratedResponse(vault, previous, previous.status, resultHeaders, previous.finalUrl, false);
        await store.record(previous.checkKey, null, { sourceId: context.sourceId ?? url.hostname,
          state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US", url: safeUrl(previous.finalUrl, context),
          checkedAt: previous.checkedAt, httpStatus: previous.checkStatus, unchanged, downloadedBytes: 0, nextDueAt: context.nextDueAt,
          reused: true });
        if (!scope?.prefetch) recordAcquiredResponse({ requestedUrl: safeUrl(start.href, context), finalUrl: safeUrl(previous.finalUrl, context), httpStatus: result.status, rawHash: previous.rawHash, byteCount: previous.byteCount });
        if (context.onResponse) await context.onResponse({ requestedUrl: safeUrl(start.href, context), finalUrl: safeUrl(previous.finalUrl, context), httpStatus: previous.checkStatus, responseStatus: result.status,
          rawHash: previous.rawHash, byteCount: previous.byteCount, bytes: new Uint8Array(await result.clone().arrayBuffer()), retrievedAt: previous.checkedAt,
          contentType: result.headers.get("content-type") ?? "", vaultKey: previous.vaultKey, unchanged });
        return result;
      }
      if (previous) {
        const validators = new Headers([...previous.headers]);
        if (validators.has("etag")) headers.set("if-none-match", validators.get("etag")!);
        if (validators.has("last-modified")) headers.set("if-modified-since", validators.get("last-modified")!);
      }
      const size = typeof websiteSize === "function" ? websiteSize(url.href) : websiteSize;
      if (context.spacingMs && context.spacingMs > 0) {
        const sendAt = await pacing.reserve(websiteOf(url.href), context.spacingMs, now()), wait = sendAt - now();
        if (wait > 0) await (runtime.sleep ?? (milliseconds => delay(milliseconds, undefined, { signal })))(wait);
      }
      const admission = await admitWebsiteRequest(pacing, url.href, websiteRequestLimit(size), now());
      if (!admission.ok) {
        await context.onDeferred?.({ until: admission.until, why: admission.why, url: safeUrl(url.href, context) });
        throw new SourceFetchDeferred(admission);
      }
      let response: Response;
      try { response = await (runtime.transport ?? publicTransport)(url, { method, headers, body, redirect: "manual", signal }); }
      catch (error) {
        await store.record(key, null, { sourceId: context.sourceId ?? url.hostname,
          state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US", url: safeUrl(url.href, context),
          checkedAt: new Date(now()).toISOString(), httpStatus: 0, unchanged: false, downloadedBytes: 0, nextDueAt: context.nextDueAt });
        throw error;
      }
      const checkedAt = new Date(now()).toISOString(), finalUrl = response.url || url.href;
      await holdWebsiteAfter(pacing, url.href, response.status, response.headers.get("retry-after"), now());
      const { failure, ...receivedBody } = await saveBody(vault, response, scope?.prefetch ? 64 * 1024 : CHUNK_BYTES), receivedHeaders = savedHeaders(response.headers, context);
      const wire = { ...receivedBody, checkKey: key, checkedAt, checkStatus: response.status, status: response.status, headers: receivedHeaders, finalUrl: safeUrl(finalUrl, context) };
      const responseKey = `project/freshness/source-fetch/responses/${key}/${checkedAt.slice(0, 10)}/${randomUUID()}.json`;
      await storeBytes(vault, responseKey, new TextEncoder().encode(JSON.stringify({ ...wire, requestedUrl: safeUrl(url.href, context), checkedAt,
        ...(failure ? { complete: false, failure: "BODY_STREAM_FAILED" } : {}) })), "application/json");
      if (failure) {
        await store.record(key, null, { sourceId: context.sourceId ?? url.hostname,
          state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US", url: safeUrl(url.href, context),
          checkedAt, httpStatus: 0, unchanged: false, downloadedBytes: receivedBody.byteCount, nextDueAt: context.nextDueAt });
        throw failure.error;
      }
      const unchanged = response.status === 304, rehydrate = unchanged && previous !== null;
      const mergedHeaders = new Headers(rehydrate ? [...previous.headers] : receivedHeaders);
      for (const [name, value] of receivedHeaders) mergedHeaders.set(name, value);
      const saved: SavedSourceResponse = rehydrate ? { ...previous, checkKey: key, checkedAt, checkStatus: response.status, headers: [...mergedHeaders] } : wire;
      const nextValue = method === "GET" && (response.ok || rehydrate) ? saved : null;
      await store.record(key, nextValue, {
        sourceId: context.sourceId ?? url.hostname, state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US",
        url: safeUrl(url.href, context), checkedAt, httpStatus: response.status, unchanged,
        downloadedBytes: receivedBody.byteCount, nextDueAt: context.nextDueAt,
      }, original.method === "GET" && nextValue ? [initialKey] : []);
      const resultHeaders = new Headers(response.headers);
      resultHeaders.set("x-meanwhile-source-checked-at", checkedAt);
      if (rehydrate) {
        for (const [name, value] of mergedHeaders) if (!resultHeaders.has(name)) resultHeaders.set(name, value);
        resultHeaders.set("x-meanwhile-source-status", "304");
        resultHeaders.delete("content-length");
      }
      const result = hydratedResponse(vault, saved, saved.status, resultHeaders, finalUrl, method === "HEAD");
      if (result.ok) captureRequest(original, context, saved.byteCount);
      if (result.ok && !scope?.prefetch) recordAcquiredResponse({ requestedUrl: safeUrl(start.href, context), finalUrl: safeUrl(finalUrl, context), httpStatus: result.status, rawHash: saved.rawHash, byteCount: saved.byteCount });
      if (context.onResponse) {
        await context.onResponse({ requestedUrl: safeUrl(start.href, context), finalUrl: safeUrl(finalUrl, context), httpStatus: response.status, responseStatus: result.status,
          rawHash: saved.rawHash, byteCount: saved.byteCount, bytes: new Uint8Array(await result.clone().arrayBuffer()),
          retrievedAt: checkedAt, contentType: result.headers.get("content-type") ?? "", vaultKey: saved.vaultKey, unchanged });
      }
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has("location") || original.redirect === "manual") return result;
      if (original.redirect === "error") throw new TypeError("Source response redirects");
      const next = assertPublicUrl(new URL(response.headers.get("location")!, url).href);
      if (next.origin !== url.origin) { baseHeaders.delete("authorization"); baseHeaders.delete("cookie"); }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET"; body = undefined; baseHeaders.delete("content-type"); baseHeaders.delete("content-length");
      }
      url = next;
    }
    throw new TypeError("Too many source redirects");
  };
  return context.dueAt && method === "GET" ? store.withLease(initialKey, read, signal) : read();
}
