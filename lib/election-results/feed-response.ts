import { isResultState } from "./feed-types.ts";
import { resultFeedStore, type ElectionResultFeedStore } from "./feed-store.ts";
import { readNationalElectionResults, readStateElectionResults } from "../reader/election-results.ts";

const cacheHeaders = { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, s-maxage=60" };
const invalid = () => Response.json({ available: false, error: "Invalid results selection." }, { status: 400, headers: { "Cache-Control": "no-store" } });

async function results(store: ElectionResultFeedStore, state?: string, contests?: readonly string[]) {
  if (state !== undefined && !isResultState(state) || contests && (contests.length > 5_000 || contests.some(id => !id || id.length > 2_000))) return invalid();
  try {
    if (state) {
      const feed = await readStateElectionResults(state, contests, store);
      return Response.json({ available: feed !== null, ...(feed ?? { state, facts: {}, checkedAt: null }) }, { headers: cacheHeaders });
    }
    const summary = await readNationalElectionResults(store);
    return Response.json({ available: summary !== null, ...(summary ?? { states: {}, sources: [], checkedAt: null }) }, { headers: cacheHeaders });
  } catch {
    return Response.json({ available: false, ...(state ? { state, facts: {} } : { states: {}, sources: [] }), checkedAt: null }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

/** Shared by the native production Function and the local Next route. Neither starts the page runtime. */
export function getElectionResults(request: Request, store: ElectionResultFeedStore = resultFeedStore()) {
  const params = new URL(request.url).searchParams;
  const selected = params.get("contests");
  return results(store, params.get("state")?.toUpperCase(), selected === null ? undefined : selected.split(",").filter(Boolean));
}

export async function postElectionResults(request: Request, store: ElectionResultFeedStore = resultFeedStore()) {
  try {
    const text = await request.text();
    if (text.length > 256_000) return invalid();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || !("state" in body) || typeof body.state !== "string"
      || !("contests" in body) || !Array.isArray(body.contests) || body.contests.some(id => typeof id !== "string")) return invalid();
    const response = await results(store, body.state.toUpperCase(), body.contests);
    response.headers.set("Cache-Control", "no-store");
    response.headers.delete("Netlify-CDN-Cache-Control");
    return response;
  } catch { return invalid(); }
}
