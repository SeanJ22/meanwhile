import { loadWebsiteSavedKeys } from "../core/keys-entry.ts";
import { readerRoute } from "../api/reader-route.ts";
import { readerCacheHeaders, readerStateCacheHeaders } from "../reader/cache.ts";
import { mapResults, parseResultsRequest } from "./results-read.ts";

/**
 * Filed election results for the results map, keyed by district. An empty answer means nothing is filed there yet.
 * Results are the same for every reader, so the answer is cached for everyone and cleared when the results job publishes.
 */
export const mapResultsResponse = readerRoute("/api/map-results", async function GET(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  const params = new URL(request.url).searchParams;
  const wanted = parseResultsRequest({ scope: params.get("scope"), state: params.get("state") });
  if (!wanted) return Response.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const results = await mapResults(wanted);
    return Response.json({ ok: true, results }, { headers: {
      ...(wanted.scope === "state" ? readerStateCacheHeaders(wanted.state) : readerCacheHeaders({ national: true })),
      "Netlify-Vary": "query=scope|state",
    } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
