import { OUTBOUND_USER_AGENT } from "@/lib/geo/outbound-agent";
import {
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_URL,
  parseCensusPoint,
  parseCensusZip,
} from "@/lib/geo/census-geocoder";

/**
 * POST /api/geocode: a stateless proxy to the Census geocoder, which sends no CORS header. It writes nothing:
 * no log, no store, no cache, nothing echoed. POST so an address never sits in a URL; `no-store`.
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
  // never behind a flag.
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
    const payload = await upstream.json();
    const point = parseCensusPoint(payload);
    const zip = parseCensusZip(payload);
    const expectedZip = /,\s*(\d{5})$/.exec(address)?.[1];
    if (expectedZip && zip !== expectedZip) return Response.json({ match: false }, { headers: NO_STORE });
    if (!point) return Response.json({ match: false }, { headers: NO_STORE });
    // The point only. Nothing about the request is echoed back.
    return Response.json(
      { match: true, lat: point.lat, lng: point.lng, ...(zip ? { zip } : {}) },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json({ match: false }, { headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
