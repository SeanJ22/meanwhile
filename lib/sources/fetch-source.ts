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
import { defaultSourceFetchStore, type SavedSourceResponse, type SourceFetchStore } from "./fetch-source-state.ts";

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
export interface SourceFetchContext {
  readonly sourceId?: string; readonly state?: string; readonly nextDueAt?: string; readonly dueAt?: string;
  readonly websiteSize?: WebsiteSize | WebsiteSizeForUrl;
  readonly vault?: EvidenceStore; readonly pacing?: WebsitePacing; readonly runtime?: SourceFetchRuntime;
  readonly spacingMs?: number;
  readonly onResponse?: (capture: SourceResponseCapture) => void | Promise<void>;
  readonly sensitiveQueryParameters?: readonly string[];
}
export type SourceFetchInit = RequestInit & { readonly source?: SourceFetchContext };
const contexts = new AsyncLocalStorage<SourceFetchContext>();
export function runWithSourceFetch<T>(context: SourceFetchContext, operation: () => T): T {
  const previous = contexts.getStore();
  const defined = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
  const runtime = Object.fromEntries(Object.entries(context.runtime ?? {}).filter(([, value]) => value !== undefined));
  const onResponse = previous?.onResponse && context.onResponse && previous.onResponse !== context.onResponse
    ? async (capture: SourceResponseCapture) => { await previous.onResponse!(capture); await context.onResponse!(capture); }
    : context.onResponse ?? previous?.onResponse;
  return contexts.run({ ...previous, ...defined, onResponse, runtime: { ...previous?.runtime, ...runtime } }, operation);
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
let defaultVault: EvidenceStore | undefined;
const vaultFor = () => defaultVault ??= new DurableEvidenceStore(join(tmpdir(), "meanwhile-source-vault"));
function safeUrl(raw: string, context: SourceFetchContext): string {
  const url = new URL(raw);
  for (const name of [...url.searchParams.keys()]) {
    if (/^(?:api[-_]?key|key|access[-_]?token|token|auth|authorization|password|secret)$/i.test(name) || context.sensitiveQueryParameters?.includes(name)) url.searchParams.set(name, "[redacted]");
  }
  return url.href;
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
async function saveBody(vault: EvidenceStore, response: Response): Promise<Pick<SavedSourceResponse, "rawHash" | "byteCount" | "vaultKey" | "chunks">> {
  const digest = createHash("sha256"), chunks: string[] = [];
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
        const { done, value } = await reader.read();
        if (done) break;
        digest.update(value); byteCount += value.byteLength;
        for (let offset = 0; offset < value.byteLength;) {
          const count = Math.min(CHUNK_BYTES - used, value.byteLength - offset);
          pending.push(value.subarray(offset, offset + count)); used += count; offset += count;
          if (used === CHUNK_BYTES) await flush();
        }
      }
    } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  if (used > 0 || chunks.length === 0) await flush();
  const rawHash = digest.digest("hex");
  if (chunks.length === 1) return { rawHash, byteCount, vaultKey: chunks[0]!, chunks };
  const vaultKey = `project/freshness/source-fetch/body/${rawHash}.json`;
  await storeBytes(vault, vaultKey, new TextEncoder().encode(JSON.stringify({ rawHash, byteCount, chunks })), "application/json");
  return { rawHash, byteCount, vaultKey, chunks };
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
      if (previous && context.dueAt && Date.parse(previous.checkedAt) >= Date.parse(context.dueAt)) {
        const unchanged = previous.checkStatus === 304, resultHeaders = new Headers([...previous.headers]);
        if (unchanged) resultHeaders.set("x-meanwhile-source-status", "304");
        resultHeaders.set("x-meanwhile-source-reused", "true");
        const result = hydratedResponse(vault, previous, previous.status, resultHeaders, previous.finalUrl, false);
        await store.record(key, null, { sourceId: context.sourceId ?? url.hostname,
          state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US", url: safeUrl(url.href, context),
          checkedAt: previous.checkedAt, httpStatus: previous.checkStatus, unchanged, downloadedBytes: 0, nextDueAt: context.nextDueAt });
        recordAcquiredResponse({ requestedUrl: start.href, finalUrl: previous.finalUrl, httpStatus: result.status, rawHash: previous.rawHash, byteCount: previous.byteCount });
        if (context.onResponse) await context.onResponse({ requestedUrl: start.href, finalUrl: previous.finalUrl, httpStatus: previous.checkStatus, responseStatus: result.status,
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
      if (!admission.ok) throw new SourceFetchDeferred(admission);
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
      const receivedBody = await saveBody(vault, response), receivedHeaders = savedHeaders(response.headers, context);
      const wire = { ...receivedBody, checkedAt, checkStatus: response.status, status: response.status, headers: receivedHeaders, finalUrl: safeUrl(finalUrl, context) };
      const responseKey = `project/freshness/source-fetch/responses/${key}/${checkedAt.slice(0, 10)}/${randomUUID()}.json`;
      await storeBytes(vault, responseKey, new TextEncoder().encode(JSON.stringify({ ...wire, requestedUrl: safeUrl(url.href, context), checkedAt })), "application/json");
      const unchanged = response.status === 304, rehydrate = unchanged && previous !== null;
      const mergedHeaders = new Headers(rehydrate ? [...previous.headers] : receivedHeaders);
      for (const [name, value] of receivedHeaders) mergedHeaders.set(name, value);
      const saved: SavedSourceResponse = rehydrate ? { ...previous, checkedAt, checkStatus: response.status, headers: [...mergedHeaders] } : wire;
      const nextValue = method === "GET" && (response.ok || rehydrate) ? saved : null;
      await store.record(key, nextValue, {
        sourceId: context.sourceId ?? url.hostname, state: state && state !== "US" && /^[A-Z]{2}$/.test(state) ? `US-${state}` : "US",
        url: safeUrl(url.href, context), checkedAt, httpStatus: response.status, unchanged,
        downloadedBytes: receivedBody.byteCount, nextDueAt: context.nextDueAt,
      }, original.method === "GET" && nextValue ? [initialKey] : []);
      const resultHeaders = new Headers(response.headers);
      if (rehydrate) {
        for (const [name, value] of mergedHeaders) if (!resultHeaders.has(name)) resultHeaders.set(name, value);
        resultHeaders.set("x-meanwhile-source-status", "304");
        resultHeaders.delete("content-length");
      }
      const result = hydratedResponse(vault, saved, saved.status, resultHeaders, finalUrl, method === "HEAD");
      if (result.ok) recordAcquiredResponse({ requestedUrl: start.href, finalUrl, httpStatus: result.status, rawHash: saved.rawHash, byteCount: saved.byteCount });
      if (context.onResponse) {
        await context.onResponse({ requestedUrl: start.href, finalUrl, httpStatus: response.status, responseStatus: result.status,
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
  return context.dueAt && method === "GET" ? store.withLease(initialKey, read) : read();
}
