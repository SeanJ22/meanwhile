import { haversineKm } from "./distance.ts";

/**
 * The U.S. Census Bureau's address geocoder — D53, the author's approved
 * external source (2026-08-15).
 *
 * What it closes: the street the reader types in the narrowing chip resolved
 * to a SET of divisions and nothing else, because the street index carries no
 * geometry. So the map stayed on the zip's centroid and the meetings, the
 * officials and the sidebar counters kept answering for the whole ZCTA — a
 * zip that crosses four municipalities kept answering for four. This turns
 * the street into a point, and the point is what everything downstream
 * resolves to.
 *
 * Why this source and not another: it is a federal service, free, requires no
 * key, and it is already the record cited by rows in the venue cache. The
 * approved-sources rule in `CLAUDE.md` needs an author decision to add one,
 * and this one has it.
 *
 * ## The finding that shaped this, stated before the code
 *
 * **The Census geocoder does not geocode street names.** It geocodes
 * addresses. `Green Pond Road, 07866` returns zero matches; so does the
 * structured `?street=&zip=` form. `808 Green Pond Road, 07866` returns a
 * point. Verified 2026-08-15 against both endpoints.
 *
 * The chip asks for a street and promises no house number is needed, and that
 * promise is not up for renegotiation — it is what makes the question cheap
 * to answer. So this **samples the street at a few low house numbers and asks
 * whether they agree**. Four numbers, serially. If the matches sit within
 * `MAX_SPREAD_KM` of each other, their midpoint is a real point on the street
 * the reader named, and the map can honestly go there. If they scatter, the
 * street is too long for one point to mean anything — Green Pond Road's
 * samples span 5.6 km and cross a municipal line — and this returns null so
 * the caller keeps the division shading that already shipped.
 *
 * That check is the whole reason this is honest rather than plausible: the
 * failure mode it prevents is re-centring a reader onto the wrong town's
 * meetings with a confident-looking pin.
 *
 * ## Three rules this module keeps
 *
 * 1. **The point is never logged and never stored.** No localStorage, no
 *    request to our own server, nothing added to the search log — that store
 *    is permanently identifier-free and a street-level point is the most
 *    identifying thing this product could hold. The lookup runs on the
 *    device, the point lives in React state for the life of the view, and it
 *    is gone on reload.
 * 2. **A failure is not an error state.** Every miss — no match, a scattered
 *    street, a bad response, a network refusal, a timeout — returns `null`,
 *    and the caller keeps exactly the behaviour that shipped before.
 * 3. **The reader's own house number is never sent.** The sampled numbers are
 *    this module's, and a number the reader types anyway is stripped.
 */

/** The Census Bureau's one-line address endpoint. No key, no account. */
export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** The benchmark to resolve against — the Bureau's current address ranges. */
export const CENSUS_BENCHMARK = "Public_AR_Current";

/**
 * House numbers to probe, low and spread out. Low, because a number past the
 * end of a street simply does not match and costs a request for nothing;
 * spread out, because two adjacent numbers agree on every street and would
 * make the coherence check meaningless.
 */
export const SAMPLE_HOUSE_NUMBERS = [1, 50, 200, 800] as const;

/**
 * How far apart the samples may sit and still describe one place, in km.
 *
 * 1.5 km is about a mile — the scale at which "which town is this" stops
 * having one answer in the zips this product covers. Above it, the honest
 * output is nothing.
 */
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

/**
 * A leading house number, removed.
 *
 * The chip's own question says no house or apartment number is needed, and a
 * reader who types one anyway should not have it forwarded — the difference
 * between "Green Pond Road" and "808 Green Pond Road" is the difference
 * between a street and a household.
 */
export function streetOnly(input: string): string {
  return input.trim().replace(/^\s*#?\d+[a-z]?\s+/i, "").trim();
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

/** The first match's coordinates, or null. Defensive: this is third-party JSON. */
export function parseCensusPoint(
  payload: unknown,
): { lat: number; lng: number } | null {
  const matches = (
    payload as {
      result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] };
    }
  )?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const lng = matches[0]?.coordinates?.x;
  const lat = matches[0]?.coordinates?.y;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Outside the plausible U.S. envelope is a parse gone wrong, not a place.
  // Silently re-centring on the Gulf of Guinea is worse than not re-centring.
  if (lat < 15 || lat > 72 || lng < -180 || lng > -60) return null;

  return { lat, lng };
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

export interface GeocodeOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The reader is waiting on this; a slow answer is a no answer. */
  timeoutMs?: number;
}

/**
 * Locate a street within a zip, on the device. Never throws, never stores.
 *
 * Returns `null` for every failure mode there is, which is what makes the
 * caller's fallback a single branch instead of a matrix.
 */
export async function locateStreetInZip(
  street: string,
  zip: string,
  options: GeocodeOptions = {},
): Promise<StreetPoint | null> {
  const cleaned = streetOnly(street);
  if (cleaned.length < 3 || !/^\d{5}$/.test(zip)) return null;

  const impl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 8000);
  const points: { lat: number; lng: number }[] = [];

  // Serialized, in the retrieval manners this project uses everywhere: one
  // request at a time against a single public tenant, and a clock that stops
  // the whole thing rather than letting a slow host hold the reader.
  for (const number of SAMPLE_HOUSE_NUMBERS) {
    if (options.signal?.aborted || Date.now() > deadline) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onOuterAbort);
    try {
      const response = await impl(censusGeocodeUrl(`${number} ${cleaned}, ${zip}`), {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.ok) {
        const point = parseCensusPoint(await response.json());
        if (point) points.push(point);
      }
    } catch {
      // A miss is a miss. The loop keeps going; zero matches ends as null.
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);
    }
  }

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
