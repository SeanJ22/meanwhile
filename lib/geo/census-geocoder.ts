import { haversineKm } from "./distance.ts";

/**
 * The U.S. Census Bureau's address geocoder — D53, an approved external
 * source (2026-08-15).
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
 *    always this module's own. Until 2026-08-26 a number the reader typed was
 *    simply discarded; it is now read for its MAGNITUDE and then discarded,
 *    because the magnitude is the only thing that can name the reader's block
 *    and the ladder that ignored it could not place most of the American West.
 *    The number itself still never leaves this function — see
 *    `sampleNumbersFor`, which is where that promise is kept and tested.
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

/**
 * The leading house number a reader typed, or null (the Vail defect,
 * 2026-08-26).
 *
 * `streetOnly` throws this away, and throwing it away is what made the
 * placement failure a CLASS rather than one address. The number is read here
 * so its MAGNITUDE can be used, and it is never itself sent — see
 * `sampleNumbersFor`.
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
 * ## The defect this closes, stated before the code
 *
 * `10723 South Bear Table Tank Drive, 85641` is a real Vail address. The
 * Bureau geocodes it on the first try. This product told the reader
 * *"We couldn't place 10723 South Bear Table Tank Drive in 85641."*
 *
 * The reason is the fixed ladder: the street's address range is
 * **10701-10899**, and `SAMPLE_HOUSE_NUMBERS` asks about 1, 50, 200 and 800.
 * All four sit below the range, all four return zero matches, and zero
 * matches ends as a refusal. Probed 2026-08-26 against the Bureau: 1, 50,
 * 200, 800, 2000, 5000, 10000, 12000 and 15000 all return **0 matches** on
 * that street; 10701, 10723 and 10800 each return **1**.
 *
 * **So a wider blind ladder cannot fix this**, and that matters — it is the
 * obvious fix and it does not work. Address ranges are per block face. The
 * only thing that reliably names the reader's block is the magnitude of the
 * number they already typed.
 *
 * This is not a rural curiosity. Grid addressing — where the house number
 * encodes distance from a datum — is how most of the American West is
 * numbered, and it is exactly the territory RULING 57 sends this product
 * into.
 *
 * ## What is sent, and what is never sent
 *
 * **The reader's own house number is never sent, and that promise is kept
 * literally rather than approximately.** What is used is its magnitude: the
 * number is coarsened DOWN to its hundred block, and the samples are that
 * block's own offsets. A reader who types 10723 causes requests for 10700,
 * 10725, 10775 and 10799 — four addresses on their block, none of them
 * theirs. Where an offset would collide with the typed number it is shifted,
 * so the promise holds for every input rather than for most of them.
 *
 * With no number typed, the historical ladder is returned unchanged. That
 * path is the one every existing reader is on, and it does not move.
 */
export function sampleNumbersFor(house: number | null): number[] {
  if (house === null) return [...SAMPLE_HOUSE_NUMBERS];

  // PARITY IS LOAD-BEARING, and it is the half a first attempt got wrong.
  //
  // The Bureau indexes each SIDE of a street as its own address range, so a
  // street is commonly even-only or odd-only in a given range. Probed
  // 2026-08-26 on `East Colossal Cave Road, 85641`: 13000, 13002, 13010,
  // 13024, 13050, 13074 and 13098 every one returns a match, and 13001 and
  // 13025 both return ZERO. A ladder that ignores parity asks the empty side
  // of the street and concludes the street is not there — the same false
  // absence, one layer in.
  const parity = house % 2;
  const base = Math.floor(house / 100) * 100;
  const numbers: number[] = [];
  for (const offset of [0, 24, 74, 98]) {
    // A block starting at 0 has no house 0; the lowest that can exist is 1.
    let candidate = Math.max(1, base + offset + parity);
    // The reader's own number never leaves this function. A collision is
    // shifted by TWO rather than one, because a one-step shift would land on
    // the empty side of the street and throw the sample away.
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
 * One address → a point, by whichever route this code is running on (M80,
 * 2026-08-15).
 *
 * **In a browser, the direct call is impossible.** The Census geocoder sends
 * no CORS header, so every request a page made was refused before it left —
 * which is why D53's street features had never once fired in a real page,
 * and why no Node test could see it: Node does not enforce CORS. The browser
 * goes through our own `/api/geocode`, which writes nothing.
 *
 * **On the server it calls the Bureau directly.** Scripts, tests and the
 * venue cache have no CORS to satisfy, and bouncing them through our own
 * route would only add a hop and a running server to depend on.
 *
 * Either way the answer is a point or null, and either way nothing about
 * the address is retained.
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
    return parseCensusPoint(await response.json());
  }

  // POST, so a home address never rides in a URL that could be logged by
  // something that is not ours to promise about.
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
  // The same envelope check the direct path applies — our own route is not
  // a reason to trust a number less carefully.
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) return null;
  if (body.lat < 15 || body.lat > 72 || body.lng < -180 || body.lng > -60) {
    return null;
  }
  return { lat: body.lat, lng: body.lng };
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

/**
 * **THE ZIP THE CENSUS ACTUALLY MATCHED, out of the same response.**
 * (Session B closure, BAL-38, 2026-08-31.)
 *
 * The response has always carried it — `addressMatches[0].addressComponents.zip`
 * — and `parseCensusPoint` read the coordinates and dropped everything else. So
 * an address that resolves cleanly to a neighbouring ZIP was indistinguishable
 * from one that resolves nowhere: both came back null, and the reader was told
 * we could not place it.
 *
 * Returns null rather than guessing when the field is absent or malformed. A
 * ZIP we did not read is not a ZIP to offer a reader.
 */
export function parseCensusZip(payload: unknown): string | null {
  const matches = (
    payload as {
      result?: { addressMatches?: { addressComponents?: { zip?: unknown } }[] };
    }
  )?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const zip = matches[0]?.addressComponents?.zip;
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
 * What a street lookup can honestly conclude (2026-08-15).
 *
 * The previous shape was `StreetPoint | null`, and it collapsed two very
 * different answers into the same null: "this street is nowhere we can find"
 * and "this street runs across the map and a point would be a guess". The
 * second one has an answer the reader can give — **which house number?** —
 * and refusing to ask for it was throwing away the only thing that could
 * resolve it. Green Pond Road in 07866 is the case: its sampled numbers land
 * kilometres apart because the street genuinely crosses jurisdictions.
 *
 * The refusal remains for `NOT_FOUND`, and for `CROSSES` when the reader
 * declines to answer. The house number is used for the geocode and, exactly
 * like the resulting point, is never logged or stored.
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
 * Locate a street within a zip, on the device. Never throws, never stores.
 *
 * Returns `null` for every failure mode there is, which is what makes the
 * caller's fallback a single branch instead of a matrix.
 */
/**
 * Exported for WGH-5 (2026-08-22): `/api/address/resolve` needs the RAW
 * sampled points, not their midpoint.
 *
 * Every caller before it wanted one point, so the midpoint was computed
 * immediately and the samples thrown away — and the samples are the whole
 * evidence for whether a street is split. `lib/geo/address-resolution.ts`
 * measures ambiguity by asking which DIVISIONS each sample lands in, which the
 * kilometre spread could only ever approximate.
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
 * The numbers are a REQUIRED parameter and deliberately have no default.
 *
 * A default would be `SAMPLE_HOUSE_NUMBERS`, which is the fixed ladder that
 * caused the Vail defect — so a call site added later could reintroduce it by
 * saying nothing at all. Required, the compiler makes every caller state which
 * ladder it means, which is the difference between enforced and remembered.
 */
async function sampleStreet(
  cleaned: string,
  zip: string,
  options: GeocodeOptions,
  numbers: readonly number[],
): Promise<{ lat: number; lng: number }[]> {
  const impl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 8000);
  const points: { lat: number; lng: number }[] = [];

  // Serialized, in the retrieval manners this project uses everywhere: one
  // request at a time against a single public tenant, and a clock that stops
  // the whole thing rather than letting a slow host hold the reader.
  for (const number of numbers) {
    if (options.signal?.aborted || Date.now() > deadline) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onOuterAbort);
    try {
      const point = await geocodeOnce(
        `${number} ${cleaned}, ${zip}`,
        impl,
        controller.signal,
      );
      if (point) points.push(point);
    } catch {
      // A miss is a miss. The loop keeps going; zero matches ends as null.
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
  return points;
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
 * The same lookup, but able to say *which* kind of no it is.
 *
 * `locateStreetInZip` above stays exactly as it was — a point or nothing —
 * because plenty of callers only want the point. This one distinguishes the
 * street we cannot find from the street that crosses district lines, so the
 * input can ask the one question that resolves the second (2026-08-15).
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

  // Matches that disagree. The street is real and we know where several
  // points on it are; what we do not know is which one the reader lives near,
  // and that is a question rather than a failure.
  return { kind: "CROSSES", street: cleaned, spreadKm: spreadOf(points) };
}

/**
 * One exact address, on the device. The answer to the crossing question.
 *
 * A single request, because a house number identifies a point and there is
 * nothing to average. The number is used here and nowhere else: it is not
 * returned in `StreetPoint`, not logged, and not stored — the same rule the
 * point itself ships under.
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
      // The STREET, never the full address: what the card renders must not
      // become a household.
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
 * **WHERE DOES THIS ADDRESS ACTUALLY RESOLVE?** (BAL-38, 2026-08-31.)
 *
 * The defect: an out-of-zip address was rejected instead of redirected. A reader
 * on the 85701 ballot who types an address in 85641 was told *"We couldn't
 * place that in 85701"* — true, unhelpful, and about us — when the honest and
 * useful answer is that we placed it perfectly well somewhere else.
 *
 * `locateAddressInZip` puts the ZIP INTO the query, so the Census matches
 * within it or not at all. That is the right behaviour for the happy path and
 * it is why the out-of-zip case looked like a failure. This asks the same
 * geocoder the same question WITHOUT the ZIP constraint, and reads back the
 * ZIP it matched.
 *
 * It runs ONLY after an in-ZIP attempt has already failed. A reader whose
 * address places correctly never reaches it, so the common path costs nothing
 * and no additional address leaves this product on it.
 *
 * Returns null on anything but a clean, different, five-digit answer. A
 * suggestion the reader cannot act on is worse than the honest failure it
 * replaced.
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
    /* No ZIP in the query — that is the entire difference from the call above. */
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
    const matched = parseCensusZip(payload);
    /*
     * The SAME zip is not a redirect — it means the constrained attempt failed
     * for some other reason and there is nothing to offer. A different one is
     * the answer the reader needed.
     */
    return matched !== null && matched !== statedZip ? matched : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
