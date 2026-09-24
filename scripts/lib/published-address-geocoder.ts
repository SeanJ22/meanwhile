/**
 * **AN OFFICIAL ADDRESS, PLACED BY THE CENSUS GEOCODER OR NOT AT ALL.** (2026-09-24.)
 *
 * The owner's direction: "If an official meeting source publishes an address,
 * use that address and place the pin there." The agenda-location matcher
 * (`agenda-meeting-location.ts`) places an unplaced sitting only where a
 * PROMOTED reviewed venue of its division carries the street its own agenda
 * states. This is the fallback for a stated address that no reviewed venue
 * carries. It sends one request to the U.S. Census Bureau's one-line geocoder:
 * D53, the author's approved geocoding source, which already serves reader
 * addresses (`lib/geo/census-geocoder.ts`) and voting sites
 * (`scripts/fetch-voting-sites.mts`). The address stays the publisher's own
 * words; the Bureau supplies only the coordinates.
 *
 * The conditions, as agreed with the civic-data accuracy session:
 * 1. **Exactly one match.** Zero matches, or several ("1 E Main St, AZ"
 *    matches Avondale, Mesa and Solomon), keep the sitting's named gap.
 * 2. **The match agrees with the published words.** Its state is the
 *    division's state, and the stated state when one is printed. Its ZIP is
 *    the stated ZIP when one is printed, and its city is the stated city when
 *    one is printed.
 * 3. **Scoped to the sitting's own division.** The product's ZIP index must
 *    name the division among those whose territory reaches the matched ZIP.
 *    "20 E Main St" exists in many cities; a point in the wrong one is a false
 *    claim about a government.
 * 4. **One request per new address.** Coordinates the caller already placed
 *    (its previous payload) are reused without a request. Any answer, placed
 *    or not, is remembered for an hour, so neither a retry storm nor a second
 *    request for an address that just failed.
 * 5. **The exact response is evidence.** Every request's URL, status, time,
 *    byte hash and body reach the caller through `onAttempt`, placed or
 *    refused, for it to retain.
 *
 * Reached only by the ingest, never by a reader surface. Nothing calls it
 * until the matcher's follow-up wires it in.
 *
 * @freshness-reads-here: `retrievedAt` is stamped in `requestOnce`, the one
 * function that sends the request, at the moment it is sent. A request that
 * got no answer keeps its attempt time with status 0 and no bytes; it never
 * claims a read it did not make.
 */
import { createHash } from "node:crypto";

import { censusGeocodeUrl } from "../../lib/geo/census-geocoder.ts";
import { OUTBOUND_USER_AGENT } from "../../lib/geo/outbound-agent.ts";
import { zipDivisionEntry } from "../../lib/geo/zip-division-index.ts";

/** An address as its official source printed it. `StatedAgendaAddress` satisfies this. */
export interface PublishedAddress {
  readonly street: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
}

/** The sitting's own division. */
export interface AddressJurisdiction {
  readonly ocdId: string;
}

/** One request and its exact answer. */
export interface GeocodeEvidence {
  readonly requestedUrl: string;
  /** 0 when the request never received a response. */
  readonly httpStatus: number;
  readonly retrievedAt: string;
  /** sha256 of the exact response bytes; "" when there were none. */
  readonly rawHash: string;
  /** The exact response text; "" when there was none. */
  readonly body: string;
}

export interface PublishedAddressPoint {
  /** Rounded to six decimals, as every reviewed venue row stores them. */
  readonly lat: number;
  readonly lng: number;
  /** The Bureau's own spelling of the one address it matched. */
  readonly matchedAddress: string;
  /** The request behind these coordinates; null when they were reused. */
  readonly evidence: GeocodeEvidence | null;
  readonly reused: boolean;
}

export type GeocodeAttempt =
  | {
      readonly outcome: "PLACED";
      readonly key: string;
      readonly evidence: GeocodeEvidence;
      readonly point: PublishedAddressPoint;
    }
  | {
      readonly outcome: "REFUSED";
      readonly key: string;
      readonly evidence: GeocodeEvidence;
      readonly reason: string;
    };

/** What an address's last answer was, and until when it stands. */
export interface RememberedAnswer {
  readonly until: number;
  readonly point: PublishedAddressPoint | null;
  readonly reason: string | null;
}

export interface PublishedAddressOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Coordinates the caller already placed for this address in this division. */
  readonly previous?: (
    stated: PublishedAddress,
    jurisdiction: AddressJurisdiction,
  ) => { readonly lat: number; readonly lng: number; readonly matchedAddress: string } | null;
  /**
   * The answers remembered per address. The default lives as long as the
   * process; a caller that runs once per process supplies a durable one to
   * carry the hour across runs.
   */
  readonly memory?: Map<string, RememberedAnswer>;
  /** Every division whose territory reaches a ZIP, or null when the index cannot say. */
  readonly divisionsOfZip?: (zip: string) => Promise<readonly string[] | null>;
  readonly onAttempt?: (attempt: GeocodeAttempt) => void;
  readonly report?: (line: string) => void;
  readonly timeoutMs?: number;
  /** The pause between two requests to the Bureau. */
  readonly spacingMs?: number;
}

/** How long any answer stands before the address may be asked again. */
export const GEOCODE_ANSWER_HOLD_MS = 60 * 60 * 1000;
const DEFAULT_SPACING_MS = 400;
const DEFAULT_TIMEOUT_MS = 8000;

const processMemory = new Map<string, RememberedAnswer>();
let nextRequestAt = 0;

/** "ocd-division/country:us/state:az/place:mesa" → "AZ". */
export function stateOfDivision(ocdId: string): string | null {
  const match = /\/state:([a-z]{2})(?:\/|$)/i.exec(ocdId);
  return match ? match[1]!.toUpperCase() : null;
}

const clean = (value: string | null): string | null => {
  const trimmed = value?.replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,;:-]+$/g, "").trim();
  return trimmed ? trimmed : null;
};

/**
 * The one-line query for a published address: its own words, plus the
 * division's state when the publisher printed none. A missing city is never
 * supplied; the division scope decides instead.
 */
export function publishedAddressQuery(stated: PublishedAddress, divisionState: string | null): string | null {
  const street = clean(stated.street);
  if (!street || !/\d/.test(street)) return null;
  const state = clean(stated.state)?.toUpperCase() ?? divisionState;
  const zip = clean(stated.zip);
  const tail = [state, zip].filter(Boolean).join(" ");
  return [street, clean(stated.city), tail || null].filter(Boolean).join(", ");
}

/** The remembered-answer key: the query and the division it was asked for. */
export function publishedAddressKey(query: string, jurisdiction: AddressJurisdiction): string {
  return `${jurisdiction.ocdId}|${query.toLowerCase()}`;
}

/** A city name reduced to what two spellings of one municipality share. */
function cityKey(city: string): string {
  return city
    .toUpperCase()
    .replace(/^(?:CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH) OF\s+/, "")
    .replace(/\s+(?:CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH)$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

interface CensusMatch {
  readonly matchedAddress?: unknown;
  readonly coordinates?: { readonly x?: unknown; readonly y?: unknown };
  readonly addressComponents?: { readonly city?: unknown; readonly state?: unknown; readonly zip?: unknown };
}

export type MatchVerdict =
  | { readonly ok: true; readonly lat: number; readonly lng: number; readonly matchedAddress: string; readonly zip: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Conditions 1 and 2, on the Bureau's parsed answer. Pure; the division scope
 * (condition 3) needs the ZIP index and is applied by the caller.
 */
export function agreeingMatch(payload: unknown, stated: PublishedAddress, divisionState: string): MatchVerdict {
  const matches = (payload as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches)) return { ok: false, reason: "the answer carries no address matches list" };
  if (matches.length === 0) return { ok: false, reason: "no address match" };
  if (matches.length > 1) {
    const where = matches.map((m: CensusMatch) => String(m?.matchedAddress ?? "?")).join("; ");
    return { ok: false, reason: `${matches.length} address matches (${where}), so none is chosen` };
  }
  const match = matches[0] as CensusMatch;
  const lng = match.coordinates?.x;
  const lat = match.coordinates?.y;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: "the match carries no coordinates" };
  }
  if (lat < 15 || lat > 72 || lng < -180 || lng > -60) {
    return { ok: false, reason: `the match's coordinates (${lat}, ${lng}) are outside the United States` };
  }
  const matchedAddress = typeof match.matchedAddress === "string" ? match.matchedAddress : "";
  const parts = match.addressComponents ?? {};
  const matchedState = typeof parts.state === "string" ? parts.state.trim().toUpperCase() : "";
  const matchedZip = typeof parts.zip === "string" ? parts.zip.trim() : "";
  const matchedCity = typeof parts.city === "string" ? parts.city.trim() : "";
  if (matchedState !== divisionState) {
    return { ok: false, reason: `the match is in ${matchedState || "no state"}, not the division's ${divisionState}` };
  }
  const statedState = clean(stated.state)?.toUpperCase();
  if (statedState && statedState !== matchedState) {
    return { ok: false, reason: `the match is in ${matchedState}, not the printed ${statedState}` };
  }
  if (!/^\d{5}$/.test(matchedZip)) return { ok: false, reason: "the match carries no five-digit ZIP" };
  const statedZip = clean(stated.zip);
  if (statedZip && statedZip !== matchedZip) {
    return { ok: false, reason: `the match is in ZIP ${matchedZip}, not the printed ${statedZip}` };
  }
  const statedCity = clean(stated.city);
  if (statedCity && cityKey(statedCity) !== cityKey(matchedCity)) {
    return { ok: false, reason: `the match is in ${matchedCity || "no city"}, not the printed ${statedCity}` };
  }
  return {
    ok: true,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    matchedAddress,
    zip: matchedZip,
  };
}

async function divisionsFromIndex(zip: string): Promise<readonly string[] | null> {
  return (await zipDivisionEntry(zip))?.ids ?? null;
}

/**
 * Place an official meeting source's published address, or return null and
 * keep the sitting's named gap. Never throws.
 */
export async function geocodePublishedAddress(
  stated: PublishedAddress,
  jurisdiction: AddressJurisdiction,
  options: PublishedAddressOptions = {},
): Promise<PublishedAddressPoint | null> {
  const report = options.report ?? (() => {});
  const divisionState = stateOfDivision(jurisdiction.ocdId);
  if (!divisionState) {
    report(`  geocode: ${jurisdiction.ocdId} names no state, so "${stated.street}" is not placed`);
    return null;
  }
  const query = publishedAddressQuery(stated, divisionState);
  if (!query) {
    report(`  geocode: "${stated.street}" is not a street address, so it is not placed`);
    return null;
  }

  const previous = options.previous?.(stated, jurisdiction) ?? null;
  if (previous) {
    return { lat: previous.lat, lng: previous.lng, matchedAddress: previous.matchedAddress, evidence: null, reused: true };
  }

  const now = options.now ?? Date.now;
  const memory = options.memory ?? processMemory;
  const key = publishedAddressKey(query, jurisdiction);
  const remembered = memory.get(key);
  if (remembered && remembered.until > now()) {
    if (!remembered.point) {
      report(`  geocode: "${query}" was not placed (${remembered.reason}); not asked again until ${new Date(remembered.until).toISOString()}`);
    }
    return remembered.point;
  }

  const { evidence, failure } = await requestOnce(censusGeocodeUrl(query), options);
  const refuse = (reason: string): null => {
    memory.set(key, { until: now() + GEOCODE_ANSWER_HOLD_MS, point: null, reason });
    options.onAttempt?.({ outcome: "REFUSED", key, evidence, reason });
    report(`  geocode: "${query}" for ${jurisdiction.ocdId} is not placed: ${reason}`);
    return null;
  };

  if (failure !== null) return refuse(`the request failed (${failure})`);
  if (evidence.httpStatus < 200 || evidence.httpStatus >= 300) return refuse(`the Bureau answered HTTP ${evidence.httpStatus}`);
  let payload: unknown;
  try {
    payload = JSON.parse(evidence.body);
  } catch {
    return refuse("the answer is not JSON");
  }
  const verdict = agreeingMatch(payload, stated, divisionState);
  if (!verdict.ok) return refuse(verdict.reason);

  const reach = await (options.divisionsOfZip ?? divisionsFromIndex)(verdict.zip).catch(() => null);
  if (!reach) return refuse(`the ZIP index cannot say which divisions reach ${verdict.zip}`);
  if (!reach.includes(jurisdiction.ocdId)) {
    return refuse(`${verdict.matchedAddress} is in ZIP ${verdict.zip}, which does not reach ${jurisdiction.ocdId}`);
  }

  const point: PublishedAddressPoint = {
    lat: verdict.lat,
    lng: verdict.lng,
    matchedAddress: verdict.matchedAddress,
    evidence,
    reused: false,
  };
  memory.set(key, { until: now() + GEOCODE_ANSWER_HOLD_MS, point, reason: null });
  options.onAttempt?.({ outcome: "PLACED", key, evidence, point });
  return point;
}

/** One polite, identified GET. Every outcome is evidence, including no response. */
async function requestOnce(
  requestedUrl: string,
  options: PublishedAddressOptions,
): Promise<{ readonly evidence: GeocodeEvidence; readonly failure: string | null }> {
  const spacing = options.spacingMs ?? DEFAULT_SPACING_MS;
  const wait = nextRequestAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  nextRequestAt = Date.now() + spacing;

  const now = options.now ?? Date.now;
  const retrievedAt = new Date(now()).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(requestedUrl, {
      headers: { "user-agent": OUTBOUND_USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const evidence = {
      requestedUrl,
      httpStatus: response.status,
      retrievedAt,
      rawHash: createHash("sha256").update(bytes).digest("hex"),
      body: bytes.toString("utf8"),
    };
    return { evidence, failure: null };
  } catch (error) {
    const failure = (error as { name?: string })?.name === "AbortError"
      ? "no answer within the time limit"
      : String((error as Error)?.message ?? error).slice(0, 200);
    return { evidence: { requestedUrl, httpStatus: 0, retrievedAt, rawHash: "", body: "" }, failure };
  } finally {
    clearTimeout(timer);
  }
}
