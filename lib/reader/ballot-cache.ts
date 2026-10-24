import postal from "../geo/postal-zips.json" with { type: "json" };
import type { PostalTable } from "../geo/postal-core.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";

export const BALLOT_CACHE_VARY = "query=zip|state|lat|lng|_rsc";

/** Middleware's verdict, sent to the origin as a request header and never taken from the reader's request. */
export const BALLOT_CACHE_HEADER = "x-meanwhile-ballot-cache";
const RENDER_ALLOWANCE_S = 60;

/** `<seconds to Phoenix midnight>;<state>` for one known ZIP, or null when the selection must not be stored. Phoenix stays at UTC-7 all year. */
export function ballotCacheValue(request: Request, now = Date.now()): string | null {
  const params = new URL(request.url).searchParams, zip = params.get("zip") ?? "";
  const state = /^\d{5}$/.test(zip) ? (postal.zips as unknown as PostalTable)[zip]?.[5] : null;
  if (request.method !== "GET" || !state || !REGISTRY_STATES.some(value => value === state)
      || params.getAll("zip").length !== 1 || params.getAll("state").length > 1 || params.has("lat") || params.has("lng")
      || params.has("state") && params.get("state")?.toUpperCase() !== state) return null;
  const day = 86_400_000, offset = 7 * 3_600_000;
  const midnight = (Math.floor((now - offset) / day) + 1) * day + offset;
  // The copy's age counts from when the render finishes; a minute's allowance keeps even a slow first render inside today.
  return `${Math.max(1, Math.floor((midnight - now) / 1000) - RENDER_ALLOWANCE_S)};${state}`;
}

/* Netlify stores what the origin answers; headers middleware adds are applied after the cache. So the origin's own
   response carries the lifetime and the state's purge tag, read from the verdict, and anything without one is never stored. */
const verdict = { type: "header" as const, key: BALLOT_CACHE_HEADER };
export const BALLOT_CACHE_RULES = [
  { source: "/ballot", has: [{ ...verdict, value: "(?<ttl>\\d{1,5});(?<state>[A-Z]{2})" }], headers: [
    { key: "Netlify-Vary", value: BALLOT_CACHE_VARY },
    { key: "Netlify-CDN-Cache-Control", value: "public, durable, max-age=:ttl, must-revalidate" },
    { key: "Netlify-Cache-Tag", value: "reader-state::state,reader-national-people,reader-settings" },
  ] },
  { source: "/ballot", missing: [verdict], headers: [
    { key: "Netlify-Vary", value: BALLOT_CACHE_VARY },
    { key: "Netlify-CDN-Cache-Control", value: "no-store" },
  ] },
];
