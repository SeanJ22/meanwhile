import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
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
}
export async function readCivicApi(route: "elections" | "voterinfo", params: Record<string, string>, options: CivicReadOptions = {}): Promise<{ raw: string; checkedAt: string }> {
  const key = options.apiKey ?? process.env.GOOGLE_CIVIC_API_KEY;
  if (!key) throw new CivicSourceError(null, "Google Civic API key is not configured.", "KEY_MISSING");
  const url = new URL(`${GOOGLE_CIVIC_API}${route}`);
  url.search = new URLSearchParams({ ...params, key }).toString();
  const signal = options.signal ?? AbortSignal.timeout(2500);
  // Provider-directed backoff; no small-government pacing applies to this national API.
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await (options.fetchImpl ?? fetch)(url, { signal, cache: "no-store", headers: { accept: "application/json" } }); }
    catch { throw new CivicSourceError(null, "Google Civic could not be reached."); }
    if (response.ok) return { raw: await response.text(), checkedAt: (options.now ?? (() => new Date().toISOString()))() };
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = response.headers.get("retry-after"), seconds = retry === null ? NaN : Number(retry);
      const delay = retry !== null && Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : retry !== null && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - Date.now()) : 1000 * 2 ** attempt;
      await response.body?.cancel();
      await (options.sleep ?? sourceAcquisitionSleep)(delay, signal);
      continue;
    }
    // Never copy provider errors: they can echo a reader address or a key-bearing URL.
    await response.body?.cancel();
    throw new CivicSourceError(response.status, response.status === 404 ? "Google Civic has no information for this address (HTTP 404)."
      : response.status === 400 ? "Google Civic could not resolve this address (HTTP 400)." : `Google Civic request failed (HTTP ${response.status}).`,
    route === "voterinfo" && (response.status === 400 || response.status === 404) ? "NO_DATA" : "GOOGLE_UNAVAILABLE");
  }
  throw new CivicSourceError(null, "Google Civic could not be reached.");
}
export async function lookupCivicAddress(address: string, knownIds: ReadonlySet<string> = new Set(), options: CivicReadOptions & { electionId?: string } = {}): Promise<CivicLookup> {
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  try {
    let electionId = options.electionId;
    if (!electionId) {
      const catalog = await readCivicApi("elections", {}, options);
      const elections = civicElectionRows(catalog.raw, catalog.checkedAt, knownIds);
      // Explicit election id prevents the API's default from selecting an earlier election.
      electionId = elections.find(row => row.ocdId === "ocd-division/country:us")?.electionId;
      if (!electionId) throw new CivicSourceError(null, `Google Civic has not listed the ${GOOGLE_CIVIC_ELECTION_DAY} national election.`);
    }
    const result = await readCivicApi("voterinfo", { address, electionId }, options);
    return civicLookupFromRaw(result.raw, electionId, result.checkedAt, knownIds);
  } catch (error) {
    const reason = error instanceof CivicSourceError ? error.reason : "Google Civic returned an unreadable voterinfo response.";
    return unavailableCivicLookup(reason, checkedAt, options.electionId, error instanceof CivicSourceError ? error.failureReason : "GOOGLE_UNAVAILABLE");
  }
}
export async function recordCivicCatalogFailure(store: import("../../civic-data/store.ts").RoutineDataStore, reason: string, at: string) {
  return recordRegisteredSourceAcquisitionFailure({ store, contractId: GOOGLE_CIVIC_SOURCE_ID, attemptedAt: at,
    requestedUrl: `${GOOGLE_CIVIC_API}elections`, failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", reason) });
}
