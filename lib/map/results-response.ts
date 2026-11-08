import { loadWebsiteSavedKeys } from "../core/keys-entry.ts";
import { readerRoute } from "../api/reader-route.ts";
import { mapResults, parseResultsRequest } from "./results-read.ts";

/**
 * Filed election results for the results map, keyed by district. An empty answer means nothing is filed there yet.
 * Results are the same for every reader, so the answer is cached for everyone for a minute, the same as the results job's own feed.
 */
export const mapResultsResponse = readerRoute("/api/map-results", async function GET(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  const params = new URL(request.url).searchParams;
  const wanted = parseResultsRequest({ scope: params.get("scope"), state: params.get("state") });
  if (!wanted) return Response.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const results = await mapResults(wanted);
    return Response.json({ ok: true, results }, { headers: {
      "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, s-maxage=60", "Netlify-Vary": "query=scope|state",
    } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
