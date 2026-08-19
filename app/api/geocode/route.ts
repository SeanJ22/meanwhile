import { OUTBOUND_USER_AGENT } from "@/lib/geo/outbound-agent";
import {
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_URL,
  parseCensusPoint,
} from "@/lib/geo/census-geocoder";

/**
 * POST /api/geocode — the stateless Census geocoder proxy (M80, 2026-08-15,
 * the author's ruling).
 *
 * ## Why this route has to exist
 *
 * `geocoding.geo.census.gov` sends no `Access-Control-Allow-Origin` header.
 * No browser can call it — which means D53's street features have never
 * fired in a page, and no Node test could see it, because Node does not
 * enforce CORS. The feature was structurally dead and structurally
 * untestable at the same time.
 *
 * ## What this route does NOT do, which is the whole design
 *
 * **It writes nothing.** No log row, no database write, no store, no header
 * echoed back, nothing printed to the server console, no cache. The address exists
 * in this function's memory for the length of one request and is gone. That
 * is not a nicety: a street-level address is the most identifying thing this
 * product could ever hold, and the collection stores are honest to sell
 * precisely because they cannot be resolved to a person.
 * `tests/geocoder.test.ts` asserts it both ways — a source scan for every
 * write primitive, and a runtime call proving nothing was written.
 *
 * ## POST, not GET
 *
 * A GET would put a home address in a URL, and URLs end up in access logs,
 * referrers and proxy caches that are not ours to promise about. The address
 * rides in a request body that nothing on the path records, and the response
 * is `no-store` so no shared cache ever holds one reader's address next to
 * another reader's answer (the D40 family: this response is per-reader by
 * construction and must never be publicly cacheable).
 *
 * ## The promise changed in the same commit
 *
 * The old copy said the street was "never sent to us". That became
 * unkeepable the moment the feature needed a browser, and a promise quietly
 * retracted is worse than one honestly rewritten. Both the narrowing prompt
 * and the transparency page now say what is true and stays true: your
 * address passes through our server to the Census Bureau's geocoder, which
 * turns it into a point.
 *
 * F01 1e (2026-08-19, the author, ordered verbatim): the never-store/never-log
 * half of that sentence is STRUCK from every reader surface — "we are going to
 * store and log at some point." The copy now describes the mechanism as it
 * works today and makes no forward commitment in either direction.
 * `tests/geocoder.test.ts` pins the ban.
 */

export const runtime = "nodejs";
/** Never prerendered, never revalidated: there is nothing here to cache. */
export const dynamic = "force-dynamic";

/** Long enough for the Bureau, short enough that a reader is not held. */
const UPSTREAM_TIMEOUT_MS = 8000;
/** A house address is far shorter than this; anything longer is not one. */
const MAX_ADDRESS_CHARS = 200;

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

export async function POST(request: Request) {
  let address: string;
  try {
    const body = (await request.json()) as { address?: unknown };
    address = typeof body.address === "string" ? body.address.trim() : "";
  } catch {
    return Response.json({ match: false }, { status: 400, headers: NO_STORE });
  }

  // A validity check, not a rate limit — closed shape, length cap, and it is
  // never behind a flag (CLAUDE.md: validity checks never switch off).
  if (address.length < 3 || address.length > MAX_ADDRESS_CHARS) {
    return Response.json({ match: false }, { status: 400, headers: NO_STORE });
  }

  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      headers: {
        accept: "application/json",
        // Identified, with a contact address, as every retrieval here is.
        "user-agent": OUTBOUND_USER_AGENT,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!upstream.ok) {
      // Deliberately no upstream status, no body, no error text: an error
      // path is a place where a request's contents leak into a response by
      // accident. A miss is a miss.
      return Response.json({ match: false }, { headers: NO_STORE });
    }
    const point = parseCensusPoint(await upstream.json());
    if (!point) return Response.json({ match: false }, { headers: NO_STORE });
    // The point only. Nothing about the request is echoed back.
    return Response.json(
      { match: true, lat: point.lat, lng: point.lng },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json({ match: false }, { headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
