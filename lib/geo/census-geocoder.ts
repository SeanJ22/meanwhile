import { haversineKm } from "./distance.ts";
import type { CensusGeographies } from "./census-geographies.ts";

/** The Census Bureau's one-line address endpoint. No key, no account. */
export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** The benchmark to resolve against — the Bureau's current address ranges. */
export const CENSUS_BENCHMARK = "Public_AR_Current";
export const CENSUS_GEOGRAPHIES_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

export interface CensusPoint { lat: number; lng: number; geographies?: CensusGeographies; geographyVintages?: Readonly<Record<string, string>> }

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
  geographies?: CensusGeographies;
  geographyVintages?: Readonly<Record<string, string>>;
}

/** A leading house number, removed: a street is not a household. */
export function streetOnly(input: string): string {
  return input.trim().replace(/^\s*#?\d+[a-z]?\s+/i, "").trim();
}

export function houseNumberIn(input: string): number | null {
  const match = /^\s*#?(\d+)[a-z]?\s+\S/i.exec(input.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : null;
}

export function sampleNumbersFor(house: number | null): number[] {
  if (house === null) return [...SAMPLE_HOUSE_NUMBERS];

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

export function censusGeographiesUrl(address: string, vintage: string): string {
  return `${CENSUS_GEOGRAPHIES_URL}?${new URLSearchParams({ address, benchmark: CENSUS_BENCHMARK, vintage, layers: "all", format: "json" })}`;
}

/** Our own stateless proxy. The browser's only route to the Bureau. */
export const GEOCODE_PROXY_PATH = "/api/geocode";

async function geocodeOnce(
  address: string,
  impl: typeof fetch,
  signal: AbortSignal,
  vintage: string,
): Promise<CensusPoint | null> {
  if (typeof window === "undefined") {
    const expectedZip = /,\s*(\d{5})$/.exec(address)?.[1];
    const vintages = vintage === "Current_Current" ? [vintage] : [vintage, "Current_Current"];
    const points = await Promise.all(vintages.map(async sourceVintage => {
      try {
        const response = await impl(censusGeographiesUrl(address, sourceVintage), { headers: { accept: "application/json" }, signal });
        if (!response.ok) return null;
        const payload = await response.json();
        if (expectedZip && parseCensusZip(payload) !== expectedZip) return null;
        return parseCensusGeographies(payload);
      } catch { return null; }
    }));
    const point = points[0] ?? points[1];
    if (!point) return null;
    const geographies: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
    const geographyVintages: Record<string, string> = {};
    for (let i = 0; i < vintages.length; i++) for (const [layer, rows] of Object.entries(points[i]?.geographies ?? {})) {
      // Local boundaries stay current while legislative boundaries follow the selected term.
      if (vintages[i] !== "Current_Current" && !/^\d+.*(?:Congressional|State Legislative) Districts/.test(layer)) continue;
      geographies[layer] = rows; geographyVintages[layer] = vintages[i];
    }
    return { lat: point.lat, lng: point.lng, ...(Object.keys(geographies).length ? { geographies, geographyVintages } : {}) };
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

export function parseCensusGeographies(payload: unknown): CensusPoint | null {
  const point = parseCensusPoint(payload);
  if (!point) return null;
  const geographies = (payload as { result: { addressMatches: { geographies?: unknown }[] } }).result.addressMatches[0].geographies;
  if (!geographies || typeof geographies !== "object" || Array.isArray(geographies)) return point;
  return { ...point, geographies: Object.fromEntries(Object.entries(geographies).filter(([, rows]) => Array.isArray(rows))) };
}

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
  vintage?: string;
  /** Postal entry supplies city/state instead of treating a mail-only ZIP as a residential boundary. */
  omitZip?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The reader is waiting on this; a slow answer is a no answer. */
  timeoutMs?: number;
}

export async function sampleStreetPoints(
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<CensusPoint[]> {
  const cleaned = streetOnly(street);
  if (cleaned.length < 3 || !/^\d{5}$/.test(zip)) return [];
  return sampleStreet(
    cleaned,
    zip,
    options,
    sampleNumbersFor(houseNumberIn(street)),
  );
}

async function sampleStreet(
  cleaned: string,
  zip: string,
  options: GeocodeOptions,
  numbers: readonly number[],
): Promise<CensusPoint[]> {
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
          `${number} ${cleaned}${options.omitZip ? "" : `, ${zip}`}`,
          impl,
          controller.signal,
          options.vintage ?? "Current_Current",
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
      `${number} ${cleaned}${options.omitZip ? "" : `, ${zip}`}`,
      impl,
      controller.signal,
      options.vintage ?? "Current_Current",
    );
    if (!point) return null;
    return {
      lat: point.lat,
      lng: point.lng,
      ...(point.geographies ? { geographies: point.geographies } : {}),
      ...(point.geographyVintages ? { geographyVintages: point.geographyVintages } : {}),
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
