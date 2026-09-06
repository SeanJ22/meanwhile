/**
 * **READING THE LIVE MANIFEST AND PRODUCTION'S IDENTITY — server side only.**
 * (Admin Pass B, 2026-09-06.)
 *
 * The Admin's server fetches Prompt 3's manifest from the staging origin and
 * production's build identity from its existing `/api/build`; the browser
 * never talks to either domain. A reading is reused for a few seconds
 * (`MANIFEST_CACHE_SECONDS`) so a page render and its writes do not hammer
 * staging; "refresh manifest" and every write bypass the memo. No background
 * job, no scheduled poll, no workflow.
 *
 * The manifest is untrusted input: a body that is not a JSON object, a
 * non-200 status, a timeout or a network error all read as
 * `MANIFEST_UNAVAILABLE` with the reason, never as a throw. At observation
 * (2026-09-06T08:27Z) staging answered HTTP 401 "Password Protection" at
 * Netlify's edge; an optional Cookie header named by
 * `WTP_STAGING_MANIFEST_COOKIE` is sent to the staging origin only, read by
 * name, never rendered.
 */
import { SYNTHETIC_RUN_HEADER } from "@/lib/db/run-marker.ts";

import {
  FETCH_TIMEOUT_MS,
  MANIFEST_CACHE_SECONDS,
  MANIFEST_URL,
  PRODUCTION_BUILD_URL,
  PRODUCTION_CACHE_SECONDS,
  STAGING_MANIFEST_COOKIE_VAR,
  fullSha,
} from "./contract.ts";
import { parseManifest } from "./manifest.ts";
import type { ManifestReading, ProductionIdentity } from "./review-model.ts";

export interface SourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
  /** Bypass the memo: every write does this. */
  readonly force?: boolean;
}

let manifestMemo: { at: number; reading: ManifestReading } | null = null;
let productionMemo: { at: number; identity: ProductionIdentity } | null = null;

/** Drop both memos (the "refresh manifest" control, and the tests). */
export function refreshManifest(): void {
  manifestMemo = null;
  productionMemo = null;
}

interface Fetched {
  readonly status: number | null;
  readonly body: unknown;
  readonly error: string | null;
}

async function fetchJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<Fetched> {
  try {
    const response = await fetchImpl(url, { headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return { status: null, body: null, error: name === "TimeoutError" ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s` : `${name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function readManifest(options: SourceOptions = {}): Promise<ManifestReading> {
  const nowMs = options.nowMs ?? (() => Date.now());
  if (!options.force && manifestMemo && nowMs() - manifestMemo.at < MANIFEST_CACHE_SECONDS * 1000) return manifestMemo.reading;
  const env = options.env ?? process.env;
  const observedAt = new Date(nowMs()).toISOString();
  const headers: Record<string, string> = { accept: "application/json", [SYNTHETIC_RUN_HEADER]: "admin-release-review" };
  const cookie = env[STAGING_MANIFEST_COOKIE_VAR]?.trim();
  if (cookie) headers.cookie = cookie;
  const fetched = await fetchJson(MANIFEST_URL, headers, options.fetchImpl ?? fetch);
  let reading: ManifestReading;
  if (fetched.error !== null) {
    reading = { kind: "UNAVAILABLE", observedAt, reason: fetched.error, httpStatus: null };
  } else if (fetched.status !== 200) {
    reading = {
      kind: "UNAVAILABLE",
      observedAt,
      reason: fetched.status === 401 ? "HTTP 401 — staging is password-protected at its edge, so no manifest was read" : `HTTP ${fetched.status}`,
      httpStatus: fetched.status,
    };
  } else {
    const manifest = parseManifest(fetched.body);
    reading = manifest
      ? { kind: "OBSERVED", manifest, observedAt, httpStatus: 200 }
      : { kind: "UNAVAILABLE", observedAt, reason: "HTTP 200 but the body is not a JSON object", httpStatus: 200 };
  }
  manifestMemo = { at: nowMs(), reading };
  return reading;
}

const PRODUCTION_SOURCE = "production /api/build (the site's existing build-identity endpoint; the manifest carries no production identity)";

export async function readProductionIdentity(options: SourceOptions = {}): Promise<ProductionIdentity> {
  const nowMs = options.nowMs ?? (() => Date.now());
  if (!options.force && productionMemo && nowMs() - productionMemo.at < PRODUCTION_CACHE_SECONDS * 1000) return productionMemo.identity;
  const observedAt = new Date(nowMs()).toISOString();
  const fetched = await fetchJson(PRODUCTION_BUILD_URL, { accept: "application/json", [SYNTHETIC_RUN_HEADER]: "admin-release-review" }, options.fetchImpl ?? fetch);
  const body = fetched.body !== null && typeof fetched.body === "object" ? (fetched.body as Record<string, unknown>) : null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
  const commit = body ? str(body.commit) : null;
  const identity: ProductionIdentity = {
    source: PRODUCTION_SOURCE,
    sha: fullSha(commit),
    shaRaw: fullSha(commit) ? null : commit,
    deployId: body ? str(body.deployId) : null,
    branch: body ? str(body.branch) : null,
    context: body ? str(body.context) : null,
    observedAt,
    detail: fetched.error ?? (fetched.status !== 200 ? `HTTP ${fetched.status}` : body === null ? "the body is not a JSON object" : null),
  };
  productionMemo = { at: nowMs(), identity };
  return identity;
}
