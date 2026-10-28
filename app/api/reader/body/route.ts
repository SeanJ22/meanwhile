import { readerRoute } from "@/lib/api/reader-route";
import { rejectUnknown, refuse } from "@/lib/api/params";
import { factReader } from "@/lib/facts/db";
import { REGISTRY_STATES } from "@/lib/civic-data/state-scopes";
import { readerCacheHeaders } from "@/lib/reader/cache";
import { readBodyDetail } from "@/lib/reader/body-detail-read";

export const runtime = "nodejs";

/** The requested body's held membership and the sources behind its fields. */
export const GET = readerRoute("/api/reader/body", async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams, unknown = rejectUnknown(params, ["state", "body"]);
  if (!unknown.ok) return refuse(unknown.error);
  const state = params.get("state"), body = params.get("body");
  if (!state || !REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number]) || !body || body.length > 1024)
    return refuse("A valid state and body are required");
  const query = factReader();
  if (!query) return Response.json({ error: "The body's information could not be loaded" },
    { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const detail = await readBodyDetail(query, state, body);
    return Response.json(detail, { headers: { ...readerCacheHeaders({ states: [state], places: [body] }),
      "Netlify-Vary": "query=state|body" } });
  } catch (error) {
    console.error("READER_BODY_DETAIL_LOAD_FAILED", error);
    return Response.json({ error: "The body's information could not be loaded" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
