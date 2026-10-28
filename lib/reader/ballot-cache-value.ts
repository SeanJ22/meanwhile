import { readZipPlace } from "../place-map/reader.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";

/** One ZIP's lifetime and every affected state's purge tag, as selected by the place map. */
export async function ballotCacheValue(request: Request, now = Date.now()): Promise<string | null> {
  const params = new URL(request.url).searchParams, zip = params.get("zip") ?? "";
  if (request.method !== "GET" || !/^\d{5}$/.test(zip)
      || params.getAll("zip").length !== 1 || params.getAll("state").length > 1 || params.has("lat") || params.has("lng")) return null;
  let states: readonly string[];
  try { states = (await readZipPlace(zip))?.states ?? []; }
  catch { return null; }
  if (!states.length || states.some(state => !REGISTRY_STATES.some(value => value === state))
      || params.has("state") && !states.includes(params.get("state")!.toUpperCase())) return null;
  const day = 86_400_000, offset = 7 * 3_600_000;
  const midnight = (Math.floor((now - offset) / day) + 1) * day + offset;
  // Rendering uses some lifetime, so even a slow first render stays inside today's copy.
  return `${Math.max(1, Math.floor((midnight - now) / 1000) - 60)};${states.map(state => `reader-state:${state}`).join(",")}`;
}
