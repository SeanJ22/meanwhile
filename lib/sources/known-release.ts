import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories, LockManager } from "../control-plane/repository/types.ts";
import { RepositoryLockHeld } from "../control-plane/repository/types.ts";
import { controlPlaneUrlFromEnv, createPgRepositories, readPlaceArtifacts } from "../control-plane/repository/pg-store.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { SourceAcquisitionFailure, isSourceAcquisitionFailure, readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { readCompleteResponse } from "./source-bytes.ts";
import { sourceUserAgent } from "./http.ts";
import { publicFetch } from "../hunt/egress.ts";

export interface FailedSourceCheck {
  readonly at: string;
  readonly code: string;
  readonly detail: string;
}

export interface KnownRelease {
  readonly sourceId: string;
  readonly releaseId: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  /** Status and date belong to the held bytes, never a replay or a 304. */
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly sourceObservedAt: string;
  readonly checkedAt: string;
  readonly lastCheckStatus: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentType: string;
  readonly reused: boolean;
  /** Exact immutable vault object, when this source has entered the shared store. */
  readonly vaultKey?: string;
  /** A failed new check never replaces the successful held observation. */
  readonly failedSourceCheck?: FailedSourceCheck;
  readonly outage?: string;
}

export class KnownReleaseUnavailable extends SourceAcquisitionFailure {
  readonly held: KnownRelease;
  constructor(failure: SourceAcquisitionFailure, held: KnownRelease) {
    super(failure.code, failure.message);
    this.held = held;
  }
}
/** A real provider observation is separate from the original response bytes. */
export function knownReleaseSourceCheck(release: Pick<KnownRelease, "requestedUrl" | "finalUrl" | "lastCheckStatus" | "sha256" | "checkedAt">): {
  requestedUrl: string; finalUrl: string; httpStatus: 200 | 304; rawHash: string; checkedAt: string;
} {
  if (release.lastCheckStatus !== 200 && release.lastCheckStatus !== 304) throw new Error("KNOWN_SOURCE_CHECK_INVALID");
  return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.lastCheckStatus,
    rawHash: release.sha256, checkedAt: release.checkedAt };
}
interface ReleaseIndex extends Omit<KnownRelease, "bytes" | "reused"> {
  readonly formatVersion: 1;
  readonly key: string;
  readonly byteLength: number;
  readonly parsers: readonly string[];
}
export interface KnownReleaseOptions {
  readonly sourceId: string;
  readonly releaseId: string;
  readonly url: string;
  readonly parserVersion: string;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly checkAfterMs: number;
  readonly refresh?: boolean;
  /** A known source may remain usable when a fresh provider check fails. */
  readonly reuseOnSourceFailure?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly headers?: HeadersInit;
  readonly allowedHosts?: readonly string[];
  readonly now?: () => string;
  readonly store?: EvidenceStore;
  readonly locks?: LockManager;
  /** Existing captures can seed this index without changing their date or source identity. */
  readonly readHeld?: () => Promise<KnownRelease | null>;
  /** Full source shape/archive validation must finish before advancing the index. */
  readonly validate?: (bytes: Uint8Array, release: KnownRelease) => void | Promise<void>;
}
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const pending = new WeakMap<EvidenceStore, Map<string, Promise<KnownRelease>>>();
let runtime: Promise<{ store: EvidenceStore; locks: LockManager; repos: ControlPlaneRepositories }> | undefined;
function runtimeContext() {
  return runtime ??= (async () => {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("KNOWN_SOURCE_CONTROL_PLANE_UNAVAILABLE");
    const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
    // Static segments keep the server trace inside the vault.
    return { store: new DurableEvidenceStore(join(process.cwd(), "data", "control-plane", "vault")), locks: repos.locks, repos };
  })().catch(error => { runtime = undefined; throw error; });
}
/** Large file sources share the same vault and repository locks as byte releases. */
export async function resolveKnownReleaseCache(options: Pick<KnownReleaseOptions, "store" | "locks"> = {}): Promise<{ store: EvidenceStore; locks: LockManager }> {
  const defaults = options.store && options.locks ? null : await runtimeContext();
  return { store: options.store ?? defaults!.store, locks: options.locks ?? defaults!.locks };
}
function sourceRetryKey(sourceId: string, url: string) {
  const identity = hash(new URL(url).origin);
  return { identity, key: `project/freshness/source/${sourceId}/retry/${identity}.json` };
}
/** HEAD checks and large archives honor the same publisher cooldown as byte releases. */
export async function checkKnownSourceRetry(store: EvidenceStore, sourceId: string, url: string, now: string): Promise<void> {
  const object = await store.get(sourceRetryKey(sourceId, url).key);
  if (object) {
    const retry = JSON.parse(new TextDecoder().decode(object.bytes)) as { until?: string };
    if (typeof retry.until === "string" && Date.parse(retry.until) > Date.parse(now)) {
      throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `KNOWN_SOURCE_RETRY_AFTER:${retry.until}`);
    }
  }
}
export async function recordKnownSourceRetry(store: EvidenceStore, sourceId: string, url: string, response: Pick<Response, "status" | "headers">, checkedAt: string): Promise<void> {
  const retry = response.headers.get("retry-after");
  if (retry && (response.status === 429 || response.status >= 500 && response.status <= 599)) {
    const untilMs = /^\d+$/.test(retry) ? Date.parse(checkedAt) + Number(retry) * 1000 : Date.parse(retry);
    if (Number.isFinite(untilMs) && untilMs > Date.parse(checkedAt)) {
      const { identity, key } = sourceRetryKey(sourceId, url);
      const body = new TextEncoder().encode(JSON.stringify({ until: new Date(untilMs).toISOString(), status: response.status, checkedAt }));
      await store.put(key, body, { contentType: "application/json", contentHash: `manifest:source-retry:${identity}`,
        byteLength: body.byteLength, objectClass: "MUTABLE_INDEX" });
    }
  }
}
async function priorCapturedRelease(options: KnownReleaseOptions, repos: ControlPlaneRepositories, store: EvidenceStore): Promise<KnownRelease | null> {
  const now = options.now?.() ?? new Date().toISOString();
  const rows = (await readPlaceArtifacts(repos, options.url, "1970-01-01T00:00:00.000Z", now))
    .filter(row => row.tier === "RAW" && !row.partial && row.byteLength <= options.maxBytes)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  if (!rows.length) return null;
  const resolve = researchVaultResolver({ ...repos, artifacts: { ...repos.artifacts, readAll: async () => rows } }, store, "freshness", { snapshot: true });
  for (const row of rows) {
    try {
      const { artifact, bytes } = await resolve(row.artifactId);
      if (artifact.httpStatus !== 200 || artifact.retentionPolicy === "DIAGNOSTIC" ||
        !["ALLOWED", "NOT_APPLICABLE"].includes(artifact.permission) || !bytes.length || bytes.length > options.maxBytes) continue;
      const sha256 = hash(bytes);
      if (artifact.contentHash !== `sha256-${sha256}`) continue;
      return { sourceId: options.sourceId, releaseId: options.releaseId, bytes, sha256, requestedUrl: options.url,
        finalUrl: artifact.retrievalUrl, httpStatus: artifact.httpStatus, retrievedAt: artifact.retrievedAt,
        sourceObservedAt: artifact.retrievedAt, checkedAt: artifact.retrievedAt, lastCheckStatus: artifact.httpStatus,
        etag: null, lastModified: null, contentType: artifact.contentType, reused: true };
    } catch { /* Missing or invalid bytes leave acquisition due. */ }
  }
  return null;
}
function publicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /^(api[_-]?key|key|token|access_token|secret)$/i.test(key))) {
    throw new Error("KNOWN_SOURCE_URL_MUST_BE_PUBLIC");
  }
  return url;
}
function validIndex(value: unknown, options: KnownReleaseOptions): value is ReleaseIndex {
  const v = value as ReleaseIndex | null;
  const prefix = `project/freshness/source/${options.sourceId}/releases/${hash(`${options.sourceId}\n${options.releaseId}\n${options.url}`)}`;
  return !!v && v.formatVersion === 1 && v.sourceId === options.sourceId && v.releaseId === options.releaseId &&
    v.requestedUrl === options.url && /^[a-f0-9]{64}$/.test(v.sha256) && typeof v.key === "string" &&
    v.key === `${prefix}/${v.sha256}.bin` && (!v.vaultKey || v.vaultKey === v.key) && Number.isSafeInteger(v.byteLength) && v.byteLength > 0 &&
    v.byteLength <= options.maxBytes && Array.isArray(v.parsers) && Number.isFinite(Date.parse(v.retrievedAt)) &&
    Number.isFinite(Date.parse(v.sourceObservedAt)) && Number.isFinite(Date.parse(v.checkedAt));
}
/** Other source children may be filling this same release. Reuse their result
 * within the caller's acquisition deadline, including a slow first download. */
export async function withKnownReleaseLock<T>(locks: LockManager, name: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  let waitMs = 250;
  for (;;) {
    signal.throwIfAborted();
    try { return await locks.withLock(name, work); }
    catch (error) {
      if (!(error instanceof RepositoryLockHeld) || error.lockName !== name) throw error;
      await delay(waitMs, undefined, { signal });
      waitMs = Math.min(5_000, waitMs * 2);
    }
  }
}
/** A parser revision replays held bytes first. The next scheduled check remains due. */
export async function acquireKnownRelease(options: KnownReleaseOptions): Promise<KnownRelease> {
  publicUrl(options.url);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.sourceId) || !options.releaseId || !options.parserVersion ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || !Number.isFinite(options.checkAfterMs) || options.checkAfterMs < 0) {
    throw new Error("KNOWN_SOURCE_IDENTITY_INVALID");
  }
  const defaults = options.store && options.locks ? null : await runtimeContext();
  const store = options.store ?? defaults!.store, locks = options.locks ?? defaults!.locks;
  const identity = hash(`${options.sourceId}\n${options.releaseId}\n${options.url}`);
  const key = `project/freshness/source/${options.sourceId}/releases/${identity}/manifest.json`;
  let inflight = pending.get(store); if (!inflight) { inflight = new Map(); pending.set(store, inflight); }
  const waiting = inflight.get(identity);
  // The first caller shares transport; each caller still checks its own
  // parser revision and limits against the resulting held release.
  if (waiting) { await waiting; return acquireKnownRelease(options); }
  const work = withKnownReleaseLock(locks, `source-release:${identity}`, options.signal, async () => {
    options.signal.throwIfAborted();
    const now = options.now?.() ?? new Date().toISOString();
    const object = await store.get(key);
    let prior: ReleaseIndex | null = null, heldBytes: Uint8Array | null = null;
    if (object) {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
      if (!validIndex(parsed, options)) throw new Error("KNOWN_SOURCE_INDEX_INVALID");
      prior = parsed;
      const body = await store.get(prior.key);
      if (body && body.bytes.byteLength === prior.byteLength && hash(body.bytes) === prior.sha256) heldBytes = body.bytes;
      // A missing body owes acquisition, never an empty source or a fresh observation.
    }
    const writeIndex = async (value: ReleaseIndex) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      await store.put(key, bytes, { contentType: "application/json", contentHash: `manifest:source-release:${identity}`,
        byteLength: bytes.byteLength, objectClass: "MUTABLE_INDEX" });
    };
    const save = async (release: KnownRelease, parsers: readonly string[]) => {
      const bodyKey = `project/freshness/source/${options.sourceId}/releases/${identity}/${release.sha256}.bin`;
      const existing = await store.head(bodyKey);
      release = { ...release, vaultKey: bodyKey };
      if (existing?.custom?.retrievedAt) release = { ...release,
        retrievedAt: existing.custom.retrievedAt, sourceObservedAt: existing.custom.sourceObservedAt ?? existing.custom.retrievedAt,
        finalUrl: existing.custom.retrievalUrl ?? release.finalUrl, contentType: existing.contentType, reused: true };
      await store.put(bodyKey, release.bytes, { contentType: release.contentType, contentHash: `sha256-${release.sha256}`,
        byteLength: release.bytes.byteLength, custom: { sourceId: options.sourceId, releaseId: options.releaseId,
          canonicalUrl: release.requestedUrl, retrievalUrl: release.finalUrl, retrievedAt: release.retrievedAt,
          httpStatus: String(release.httpStatus), sourceObservedAt: release.sourceObservedAt,
          permission: "NOT_APPLICABLE", transport: "REACHABLE", retentionPolicy: "EVIDENCE_PERMANENT", tier: "RAW" } });
      const { bytes, reused, ...metadata } = release; void reused;
      prior = { ...metadata, formatVersion: 1, key: bodyKey, byteLength: bytes.byteLength, parsers };
      await writeIndex(prior);
      return release;
    };
    if (!heldBytes && (options.readHeld || defaults)) {
      const inherited = options.readHeld ? await options.readHeld() : await priorCapturedRelease(options, defaults!.repos, store);
      if (inherited) {
        if (inherited.sourceId !== options.sourceId || inherited.releaseId !== options.releaseId || inherited.requestedUrl !== options.url ||
            inherited.httpStatus !== 200 || !inherited.bytes.byteLength || inherited.bytes.byteLength > options.maxBytes ||
            hash(inherited.bytes) !== inherited.sha256 || !Number.isFinite(Date.parse(inherited.retrievedAt)) ||
            !Number.isFinite(Date.parse(inherited.sourceObservedAt)) || !Number.isFinite(Date.parse(inherited.checkedAt)) ||
            ![200, 304].includes(inherited.lastCheckStatus) ||
            !(options.allowedHosts ?? [new URL(options.url).hostname]).includes(publicUrl(inherited.finalUrl).hostname)) {
          throw new Error("KNOWN_SOURCE_HELD_IDENTITY_INVALID");
        }
        await options.validate?.(inherited.bytes, inherited);
        // Deliver already held evidence first. Its old source check remains
        // due; the next invocation can perform the conditional refresh.
        return await save({ ...inherited, reused: true }, [options.parserVersion]);
      }
    }
    if (prior && heldBytes) {
      const replay = { ...prior, bytes: heldBytes, reused: true };
      const parserChanged = !prior.parsers.includes(options.parserVersion);
      if (parserChanged || !options.refresh && Date.parse(now) - Date.parse(prior.checkedAt) < options.checkAfterMs) {
        if (parserChanged) await options.validate?.(heldBytes, replay);
        if (parserChanged) await writeIndex({ ...prior, parsers: [...prior.parsers, options.parserVersion] });
        return replay;
      }
    }
    try {
    const headers = new Headers(options.headers);
    headers.set("user-agent", sourceUserAgent());
    if (heldBytes && prior?.etag) headers.set("if-none-match", prior.etag);
    else if (heldBytes && prior?.lastModified) headers.set("if-modified-since", prior.lastModified);
    await checkKnownSourceRetry(store, options.sourceId, options.url, now);
    const response = await requestPublisher(options.sourceId, () =>
      (options.fetchImpl ?? publicFetch)(options.url, { headers, signal: options.signal, redirect: "follow" }));
    const finalUrl = response.url || options.url;
    let final: URL;
    try { final = publicUrl(finalUrl); }
    catch {
      await response.body?.cancel().catch(() => {});
      throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_REDIRECT_REFUSED:KNOWN_SOURCE_URL_MUST_BE_PUBLIC");
    }
    if (!(options.allowedHosts ?? [new URL(options.url).hostname]).includes(final.hostname)) {
      await response.body?.cancel().catch(() => {});
      throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_REDIRECT_REFUSED");
    }
    const checkedAt = options.now?.() ?? new Date().toISOString();
    if (response.status === 304) {
      await response.body?.cancel().catch(() => {});
      if (!prior || !heldBytes) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_304_WITHOUT_BYTES");
      const confirmed = { ...prior, failedSourceCheck: undefined, checkedAt, lastCheckStatus: 304, parsers: [...new Set([...prior.parsers, options.parserVersion])] };
      const release = { ...confirmed, bytes: heldBytes, reused: true };
      if (!prior.parsers.includes(options.parserVersion)) await options.validate?.(heldBytes, release);
      await writeIndex(confirmed); return release;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      const retry = response.headers.get("retry-after");
      await recordKnownSourceRetry(store, options.sourceId, options.url, response, checkedAt);
      throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `KNOWN_SOURCE_HTTP_${response.status}${retry ? `:Retry-After=${retry}` : ""}`);
    }
    const bytes = await readPublisherBody(options.sourceId, async () => {
      try { return await readCompleteResponse(response, options.maxBytes); }
      catch (error) {
        if (error instanceof Error && error.message.startsWith("SOURCE_RESPONSE_INCOMPLETE:")) {
          throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", error.message);
        }
        throw error;
      }
    });
    if (!bytes.byteLength) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "KNOWN_SOURCE_EMPTY_RESPONSE");
    const sha256 = hash(bytes);
    const unchanged = prior && heldBytes && sha256 === prior.sha256;
    const release: KnownRelease = { sourceId: options.sourceId, releaseId: options.releaseId, bytes, sha256,
      requestedUrl: options.url, finalUrl, httpStatus: 200, retrievedAt: unchanged && prior ? prior.retrievedAt : checkedAt,
      sourceObservedAt: unchanged && prior ? prior.sourceObservedAt : checkedAt, checkedAt, lastCheckStatus: 200,
      etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
      contentType: response.headers.get("content-type") ?? "application/octet-stream", reused: !!unchanged };
    await options.validate?.(bytes, release);
    if (unchanged && prior) {
      await writeIndex({ ...prior, failedSourceCheck: undefined, checkedAt, lastCheckStatus: 200, etag: release.etag, lastModified: release.lastModified,
        parsers: [...new Set([...prior.parsers, options.parserVersion])] });
      return { ...release, finalUrl: prior.finalUrl, contentType: prior.contentType, vaultKey: prior.key };
    }
    return await save(release, [options.parserVersion]);
    } catch (error) {
      if (!isSourceAcquisitionFailure(error) || !prior || !heldBytes || options.signal?.aborted) throw error;
      const failedSourceCheck = { at: options.now?.() ?? new Date().toISOString(), code: error.code, detail: error.message };
      const release = { ...prior, bytes: heldBytes, reused: true, outage: error.message, failedSourceCheck };
      await options.validate?.(heldBytes, release);
      // A caller that replays saved evidence takes it directly; others receive it with the failure.
      if (options.reuseOnSourceFailure) { await writeIndex({ ...prior, failedSourceCheck }); return release; }
      throw new KnownReleaseUnavailable(error, release);
    }
  });
  inflight.set(identity, work);
  try { return await work; } finally { inflight.delete(identity); }
}
