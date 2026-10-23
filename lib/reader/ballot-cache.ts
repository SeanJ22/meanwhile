import postal from "../geo/postal-zips.json" with { type: "json" };
import type { PostalTable } from "../geo/postal-core.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";

export const BALLOT_CACHE_VARY = "query=zip|state|lat|lng|_rsc";

/** Phoenix stays at UTC-7 throughout the year. Each answer expires at its next midnight. */
export function ballotCacheHeaders(request: Request, now = Date.now()): Record<string, string> {
  const params = new URL(request.url).searchParams, zip = params.get("zip") ?? "";
  const state = /^\d{5}$/.test(zip) ? (postal.zips as unknown as PostalTable)[zip]?.[5] : null;
  if (request.method !== "GET" || !state || !REGISTRY_STATES.some(value => value === state)
      || params.getAll("zip").length !== 1 || params.getAll("state").length > 1 || params.has("lat") || params.has("lng")
      || params.has("state") && params.get("state")?.toUpperCase() !== state) {
    return { "Netlify-CDN-Cache-Control": "no-store" };
  }
  const day = 86_400_000, offset = 7 * 3_600_000;
  const midnight = (Math.floor((now - offset) / day) + 1) * day + offset;
  return {
    "Netlify-CDN-Cache-Control": `public, durable, max-age=${Math.floor((midnight - now) / 1000)}, must-revalidate`,
    "Netlify-Cache-Tag": `reader-state:${state},reader-national-people,reader-settings`,
    // Cache age includes time spent rendering, so a request crossing midnight cannot extend yesterday's copy.
    Date: new Date(now).toUTCString(),
    Expires: new Date(midnight).toUTCString(),
  };
}
