import { mapResults, parseResultsRequest } from "@/lib/map/results-read";

export const runtime = "nodejs";

/** Filed election results for the results map, keyed by district. An empty answer means nothing is filed there yet. */
export async function GET(request: Request): Promise<Response> {
  const wanted = parseResultsRequest(new URL(request.url).searchParams);
  if (!wanted) return Response.json({ ok: false }, { status: 400 });
  try {
    return Response.json({ ok: true, results: await mapResults(wanted) }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
