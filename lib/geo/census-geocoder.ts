import { haversineKm } from "./distance.ts";

/**
 * The U.S. Census Bureau's address geocoder: a federal, free, keyless source.
 *
 * It geocodes addresses, not street names, so a street is located by
 * sampling a few house numbers on it and asking whether the matches agree. If
 * they sit within `MAX_SPREAD_KM` their midpoint is a real point on the
 * street; if they scatter, no single point is honest.
 *
 * 1. The point is never logged and never stored; it lives in view state only.
 * 2. Every miss returns `null`, and the caller keeps its existing behaviour.
 * 3. The reader's own house number is never sent; only its magnitude is used
 *    (see `sampleNumbersFor`).
 */

/** The Census Bureau's one-line address endpoint. No key, no account. */
export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** The benchmark to resolve against — the Bureau's current address ranges. */
export const CENSUS_BENCHMARK = "Public_AR_Current";

/**
 * House numbers to probe, low and spread out: a number past the end of a
 * street does not match, and adjacent numbers would always agree.
 */
export const SAMPLE_HOUSE_NUMBERS = [1, 50, 200, 800] as const;

/** How far apart the samples may sit and still describe one place, in km (about a mile). */
export const MAX_SPREAD_KM = 1.5;

export interface StreetPoint {
  lat: number;
  lng: number;
  /** The street as the reader typed it, for the line the card renders. */
  street: string;
  /** How many sampled numbers matched. Rendered nowhere; carried for tests. */
  samples: number;
  /** The widest gap between samples, km. Always <= MAX_SPREAD_KM. */
  spreadKm: number;
}

/** A leading house number, removed: a street is not a household. */
export function streetOnly(input: string): string {
  return input.trim().replace(/^\s*#?\d+[a-z]?\s+/i, "").trim();
}

/**
 * The leading house number a reader typed, or null. Read only for its
 * magnitude; never itself sent (see `sampleNumbersFor`).
 */
export function houseNumberIn(input: string): number | null {
  const match = /^\s*#?(\d+)[a-z]?\s+\S/i.exec(input.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : null;
}

/**
 * The house numbers this module will ask the Bureau about.
 *
 * Address ranges are per block face, and grid addressing (common in the
 * West) puts many streets far above a fixed low ladder, so only the magnitude
 * of the number the reader typed can name their block. The number is
 * coarsened down to its hundred block and the samples are that block's own
 * offsets; an offset that would equal the typed number is shifted, so the
 * reader's own number is never sent. With no number typed, the fixed ladder
 * is returned.
 */
export function sampleNumbersFor(house: number | null): number[] {
  if (house === null) return [...SAMPLE_HOUSE_NUMBERS];

  // Parity matters: the Bureau indexes each side of a street as its own
  // range, so a block is often even-only or odd-only. Ignoring parity asks the
  // empty side and concludes the street is not there.
  const parity = house % 2;
  const base = Math.floor(house / 100) * 100;
  const numbers: number[] = [];
  for (const offset of [0, 24, 74, 98]) {
    // A block starting at 0 has no house 0; the lowest that can exist is 1.
    let candidate = Math.max(1, base + offset + parity);
    // The reader's own number never leaves this function. A collision is
    // shifted by two, not one, so the sample stays on the same side of the street.
    if (candidate === house) candidate = offset === 98 ? house - 2 : house + 2;
    if (candidate > 0 && candidate !== house && !numbers.includes(candidate)) {
      numbers.push(candidate);
    }
  }
  return numbers;
}

/** The URL for one sampled address. Exported so a test can read it offline. */
export function censusGeocodeUrl(address: string): string {
  const params = new URLSearchParams({
    address,
    benchmark: CENSUS_BENCHMARK,
    format: "json",
  });
  return `${CENSUS_GEOCODER_URL}?${params.toString()}`;
}

/** Our own stateless proxy. The browser's only route to the Bureau. */
export const GEOCODE_PROXY_PATH = "/api/geocode";

/**
 * One address to a point. In a browser it goes through our own
 * `/api/geocode` (the Census geocoder sends no CORS header), which writes
 * nothing; on the server it calls the Bureau directly. Nothing about the
 * address is retained.
 */
async function geocodeOnce(
  address: string,
  impl: typeof fetch,
  signal: AbortSignal,
): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === "undefined") {
    const response = await impl(censusGeocodeUrl(address), {
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const expectedZip = /,\s*(\d{5})$/.exec(address)?.[1];
    if (expectedZip && parseCensusZip(payload) !== expectedZip) return null;
    return parseCensusPoint(payload);
  }

  // POST, so a home address never rides in a URL that might be logged.
  const response = await impl(GEOCODE_PROXY_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ address }),
    signal,
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    match?: boolean;
    lat?: unknown;
    lng?: unknown;
  };
  if (body.match !== true) return null;
  if (typeof body.lat !== "number" || typeof body.lng !== "number") return null;
  // The same envelope check the direct path applies.
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) return null;
  if (!plausibleUsPoint(body.lat, body.lng)) {
    return null;
  }
  return { lat: body.lat, lng: body.lng };
}

function plausibleUsPoint(lat: number, lng: number): boolean {
  return (lat >= 15 && lat <= 72 && lng >= -180 && lng <= -60) ||
    (lat >= 12 && lat <= 22 && lng >= 140 && lng <= 147) ||
    (lat >= -15 && lat <= -10 && lng >= -173 && lng <= -168);
}

/** Coordinates from exactly one source match. Multiple candidates are unresolved. */
export function parseCensusPoint(
  payload: unknown,
): { lat: number; lng: number } | null {
  const matches = (
    payload as {
      result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] };
    }
  )?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;

  const lng = matches[0]?.coordinates?.x;
  const lat = matches[0]?.coordinates?.y;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Outside the plausible U.S. envelope is a parse gone wrong, not a place.
  if (!plausibleUsPoint(lat, lng)) return null;

  return { lat, lng };
}

/**
 * The ZIP the Census actually matched (`addressMatches[0].addressComponents.zip`),
 * or null when absent or malformed.
 */
export function parseCensusZip(payload: unknown): string | null {
  const matches = (
    payload as {
      result?: { addressMatches?: { addressComponents?: { zip?: unknown }; matchedAddress?: string }[] };
    }
  )?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const zip = matches[0]?.addressComponents?.zip ?? /,\s*(\d{5})(?:-\d{4})?$/.exec(matches[0]?.matchedAddress ?? "")?.[1];
  return typeof zip === "string" && /^\d{5}$/.test(zip.trim()) ? zip.trim() : null;
}

/** The midpoint and spread of sampled points, or null if they disagree. */
export function coherentMidpoint(
  points: readonly { lat: number; lng: number }[],
): { lat: number; lng: number; spreadKm: number } | null {
  if (points.length === 0) return null;

  let spreadKm = 0;
  for (const a of points) {
    for (const b of points) {
      spreadKm = Math.max(spreadKm, haversineKm(a.lat, a.lng, b.lat, b.lng));
    }
  }
  if (spreadKm > MAX_SPREAD_KM) return null;

  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
    spreadKm,
  };
}

/**
 * What a street lookup can honestly conclude: not found, a single point, or
 * a street that crosses jurisdictions (`CROSSES`), which a house number can
 * resolve. The house number is used for the geocode and never logged or
 * stored.
 */
export type StreetLookup =
  | { kind: "POINT"; point: StreetPoint }
  | {
      kind: "CROSSES";
      /** The street as typed, cleaned — what the question is about. */
      street: string;
      /** How far the samples spread, km. Carried for tests, rendered nowhere. */
      spreadKm: number;
    }
  | { kind: "NOT_FOUND" };

export interface GeocodeOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The reader is waiting on this; a slow answer is a no answer. */
  timeoutMs?: number;
}

/**
 * The raw sampled points for a street within a zip, for callers that measure
 * ambiguity by the divisions each sample lands in.
 */
export async function sampleStreetPoints(
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<{ lat: number; lng: number }[]> {
  const cleaned = streetOnly(street);
  if (cleaned.length < 3 || !/^\d{5}$/.test(zip)) return [];
  return sampleStreet(
    cleaned,
    zip,
    options,
    sampleNumbersFor(houseNumberIn(street)),
  );
}

/**
 * The numbers are a required parameter with no default, so every caller
 * states which ladder it means.
 */
async function sampleStreet(
  cleaned: string,
  zip: string,
  options: GeocodeOptions,
  numbers: readonly number[],
): Promise<{ lat: number; lng: number }[]> {
  const impl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 8000);
  if (options.signal?.aborted || Date.now() >= deadline) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    // The fixed four samples are independent and share one lookup deadline.
    // Promise.all keeps their ladder order even when responses arrive out of order.
    const points = await Promise.all(numbers.map(async (number) => {
      try {
        return await geocodeOnce(
          `${number} ${cleaned}, ${zip}`,
          impl,
          controller.signal,
        );
      } catch {
        return null;
      }
    }));
    // An incomplete lookup cannot resolve a street from only its quickest samples.
    if (controller.signal.aborted) return [];
    return points.filter((point) => point !== null);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

export async function locateStreetInZip(
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<StreetPoint | null> {
  const cleaned = streetOnly(street);
  if (cleaned.length < 3 || !/^\d{5}$/.test(zip)) return null;

  const points = await sampleStreet(
    cleaned,
    zip,
    options,
    sampleNumbersFor(houseNumberIn(street)),
  );
  const midpoint = coherentMidpoint(points);
  if (!midpoint) return null;

  return {
    lat: midpoint.lat,
    lng: midpoint.lng,
    street: cleaned,
    samples: points.length,
    spreadKm: midpoint.spreadKm,
  };
}

/** The widest gap between a set of points, km. */
function spreadOf(points: readonly { lat: number; lng: number }[]): number {
  let spreadKm = 0;
  for (const a of points) {
    for (const b of points) {
      spreadKm = Math.max(spreadKm, haversineKm(a.lat, a.lng, b.lat, b.lng));
    }
  }
  return spreadKm;
}

/**
 * The same lookup, able to say which kind of no it is: the street we cannot
 * find, or the street that crosses district lines.
 */
export async function lookupStreetInZip(
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<StreetLookup> {
  const cleaned = streetOnly(street);
  if (cleaned.length < 3 || !/^\d{5}$/.test(zip)) return { kind: "NOT_FOUND" };

  const points = await sampleStreet(
    cleaned,
    zip,
    options,
    sampleNumbersFor(houseNumberIn(street)),
  );
  if (points.length === 0) return { kind: "NOT_FOUND" };

  const midpoint = coherentMidpoint(points);
  if (midpoint) {
    return {
      kind: "POINT",
      point: {
        lat: midpoint.lat,
        lng: midpoint.lng,
        street: cleaned,
        samples: points.length,
        spreadKm: midpoint.spreadKm,
      },
    };
  }

  // Matches that disagree: the street is real; which point is the reader's is a question.
  return { kind: "CROSSES", street: cleaned, spreadKm: spreadOf(points) };
}

/**
 * One exact address, on the device: the answer to the crossing question. The
 * house number is used here only; not returned, logged or stored.
 */
export async function locateAddressInZip(
  houseNumber: string,
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<StreetPoint | null> {
  const number = houseNumber.trim().replace(/[^0-9a-z-]/gi, "");
  const cleaned = streetOnly(street);
  if (!number || cleaned.length < 3 || !/^\d{5}$/.test(zip)) return null;

  const impl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort);
  try {
    const point = await geocodeOnce(
      `${number} ${cleaned}, ${zip}`,
      impl,
      controller.signal,
    );
    if (!point) return null;
    return {
      lat: point.lat,
      lng: point.lng,
      // The street, never the full address.
      street: cleaned,
      samples: 1,
      spreadKm: 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Where does this address actually resolve? Asks the geocoder without the
 * ZIP constraint and reads back the ZIP it matched. Runs only after an in-ZIP
 * attempt has failed. Null on anything but a clean, different, five-digit answer.
 */
export async function zipThisAddressResolvesTo(
  houseNumber: string,
  street: string,
  statedZip: string,
  options: GeocodeOptions = {},
): Promise<string | null> {
  const number = houseNumber.trim().replace(/[^0-9a-z-]/gi, "");
  const cleaned = streetOnly(street);
  if (!number || cleaned.length < 3 || !/^\d{5}$/.test(statedZip)) return null;

  const impl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort);
  try {
    /* No ZIP in the query. */
    const address = `${number} ${cleaned}`;
    const response =
      typeof window === "undefined"
        ? await impl(censusGeocodeUrl(address), {
            headers: { accept: "application/json" },
            signal: controller.signal,
          })
        : await impl(GEOCODE_PROXY_PATH, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ address }),
            signal: controller.signal,
          });
    if (!response.ok) return null;
    const payload = await response.json();
    const matched = typeof window === "undefined" ? parseCensusZip(payload) : typeof payload.zip === "string" && /^\d{5}$/.test(payload.zip) ? payload.zip : null;
    /* The same ZIP is not a redirect; there is nothing to offer. */
    return matched !== null && matched !== statedZip ? matched : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
