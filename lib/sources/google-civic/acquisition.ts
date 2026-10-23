import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_CONTRACT_ID, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
import { civicElectionRows, civicLookupFromRaw, unavailableCivicLookup, type CivicLookup } from "./model.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../../civic-data/source-acquisition-failure.ts";
import type { VotingFallbackReason } from "../../ballot/voting-sites.ts";

export class CivicSourceError extends Error {
  readonly status: number | null;
  readonly reason: string;
  readonly failureReason: VotingFallbackReason;
  constructor(status: number | null, reason: string, failureReason: VotingFallbackReason = "GOOGLE_UNAVAILABLE") {
    super(reason); this.status = status; this.reason = reason; this.failureReason = failureReason;
  }
}
export interface CivicReadOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** The Census geocoder used for sites Google did not place; defaults to the network. */
  censusFetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Request-local public catalog read while Census runs; carries no reader address. */
  electionCatalog?: Promise<Awaited<ReturnType<typeof readCivicApi>> | null>;
}

/** Server diagnostics only. Response bodies never enter a lookup, candidate or source record. */
function logCivicCallFailure(route: "elections" | "voterinfo", status: number | null, body: string, params: Record<string, string>, options: CivicReadOptions, stage: "transport" | "body" | "http" | "parse"): void {
  if (typeof window !== "undefined") return;
  let preview = body;
  for (const secret of [options.apiKey ?? process.env.GOOGLE_CIVIC_API_KEY, params.address].filter((value): value is string => !!value)) {
    preview = preview.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
  }
  console.error(JSON.stringify({ event: "google_civic_call_failed", route, stage, httpStatus: status, body: preview.slice(0, 300) }));
}

async function civicResponseBody(response: Response, route: "elections" | "voterinfo", params: Record<string, string>, options: CivicReadOptions): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      raw += decoder.decode(value, { stream: !done });
      if (done) break;
      if (!response.ok && raw.length >= 300) { await reader.cancel(); break; }
    }
    return raw;
  } catch {
    logCivicCallFailure(route, response.status, raw, params, options, "body");
    throw new CivicSourceError(response.status, "Google Civic's response body could not be read.");
  } finally { reader.releaseLock(); }
}

export async function readCivicApi(route: "elections" | "voterinfo", params: Record<string, string>, options: CivicReadOptions = {}): Promise<{ raw: string; checkedAt: string; status: number }> {
  const key = options.apiKey ?? process.env.GOOGLE_CIVIC_API_KEY;
  if (!key) throw new CivicSourceError(null, "Google Civic API key is not configured.", "KEY_MISSING");
  const url = new URL(`${GOOGLE_CIVIC_API}${route}`);
  url.search = new URLSearchParams({ ...params, key }).toString();
  const signal = options.signal ?? AbortSignal.timeout(2500);
  // Provider-directed backoff; no small-government pacing applies to this national API.
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await (options.fetchImpl ?? fetch)(url, { signal, cache: "no-store", headers: { accept: "application/json" } }); }
    catch {
      logCivicCallFailure(route, null, "", params, options, "transport");
      throw new CivicSourceError(null, "Google Civic could not be reached.");
    }
    const raw = await civicResponseBody(response, route, params, options);
    if (response.ok) return { raw, checkedAt: (options.now ?? (() => new Date().toISOString()))(), status: response.status };
    logCivicCallFailure(route, response.status, raw, params, options, "http");
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = response.headers.get("retry-after"), seconds = retry === null ? NaN : Number(retry);
      const delay = retry !== null && Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : retry !== null && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - Date.now()) : 1000 * 2 ** attempt;
      try { await (options.sleep ?? sourceAcquisitionSleep)(delay, signal); }
      catch { throw new CivicSourceError(response.status, "Google Civic's retry exceeded the lookup deadline."); }
      continue;
    }
    // Only the safe reason enters the answer; the body stays in the server log.
    throw new CivicSourceError(response.status, response.status === 404 ? "Google Civic has no information for this address (HTTP 404)."
      : response.status === 400 ? "Google Civic could not resolve this address (HTTP 400)." : `Google Civic request failed (HTTP ${response.status}).`,
    route === "voterinfo" && (response.status === 400 || response.status === 404) ? "NO_DATA" : "GOOGLE_UNAVAILABLE");
  }
  throw new CivicSourceError(null, "Google Civic could not be reached.");
}

export function parseCivicResponse<T>(route: "elections" | "voterinfo", response: Awaited<ReturnType<typeof readCivicApi>>, parse: (raw: string) => T, params: Record<string, string>, options: CivicReadOptions): T {
  try { return parse(response.raw); }
  catch {
    logCivicCallFailure(route, response.status, response.raw, params, options, "parse");
    throw new CivicSourceError(response.status, `Google Civic returned an unreadable ${route} response.`);
  }
}

export async function lookupCivicAddress(address: string, knownIds: ReadonlySet<string> = new Set(), options: CivicReadOptions & { electionId?: string } = {}): Promise<CivicLookup> {
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  try {
    let electionId = options.electionId;
    if (!electionId) {
      const catalog = await options.electionCatalog ?? await readCivicApi("elections", {}, options);
      const elections = parseCivicResponse("elections", catalog, raw => civicElectionRows(raw, catalog.checkedAt, knownIds), {}, options);
      // Explicit election id prevents the API's default from selecting an earlier election.
      electionId = elections.find(row => row.ocdId === "ocd-division/country:us")?.electionId;
      if (!electionId) {
        logCivicCallFailure("elections", catalog.status, catalog.raw, {}, options, "parse");
        throw new CivicSourceError(catalog.status, `Google Civic has not listed the ${GOOGLE_CIVIC_ELECTION_DAY} national election.`);
      }
    }
    const result = await readCivicApi("voterinfo", { address, electionId }, options);
    return parseCivicResponse("voterinfo", result, raw => civicLookupFromRaw(raw, electionId!, result.checkedAt, knownIds), { address }, options);
  } catch (error) {
    const reason = error instanceof CivicSourceError ? error.reason : "Google Civic returned an unreadable voterinfo response.";
    return unavailableCivicLookup(reason, checkedAt, options.electionId, error instanceof CivicSourceError ? error.failureReason : "GOOGLE_UNAVAILABLE");
  }
}
export async function recordCivicCatalogFailure(store: import("../../civic-data/store.ts").RoutineDataStore, reason: string, at: string) {
  return recordRegisteredSourceAcquisitionFailure({ store, contractId: GOOGLE_CIVIC_CONTRACT_ID, attemptedAt: at,
    requestedUrl: `${GOOGLE_CIVIC_API}elections`, failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", reason) });
}
