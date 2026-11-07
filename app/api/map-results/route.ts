import { loadWebsiteSavedKeys } from "../../../lib/core/keys-entry.ts";
import { readerRoute } from "@/lib/api/reader-route";
import { mapResults, parseResultsRequest } from "@/lib/map/results-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Filed election results for the results map, keyed by district. An empty answer means nothing is filed there yet. */
export const GET = readerRoute("/api/map-results", async function GET(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  const wanted = parseResultsRequest(new URL(request.url).searchParams);
  if (!wanted) return Response.json({ ok: false }, { status: 400 });
  try {
    return Response.json({ ok: true, results: await mapResults(wanted) }, { headers: { "cache-control": "private, max-age=30" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
});
