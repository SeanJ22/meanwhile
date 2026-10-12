/**
 * Keeps server instances booted and ready for a cold Ask or map. `netlify/functions/keep-warm.mts` calls this
 * route fourteen times at once every five minutes. A marked call holds for up to a second and loads, on its
 * instance, the reader edge, one place per published state, and the Ask route's module graph and source
 * preloads. All of it runs in an edge-only context (`edgeOnly`), so it never reads the database. An unmarked
 * call loads nothing and answers at once.
 */
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { KEEP_WARM_MARKER, MAX_HOLD_MS, primeReaderEdge, publishedWarmPlaces } from "./priming";

const bootedAt = new Date().toISOString();

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hold", "places"]);
  if (!unknown.ok) return refuse(unknown.error);
  const asked = numericInRange(params, "hold", 0, MAX_HOLD_MS, { default: 0 });
  if (!asked.ok) return refuse(asked.error);
  const marked = request.headers.get("x-wtp-synthetic-run") === KEEP_WARM_MARKER;
  if (marked && params.get("places") === "1") {
    return Response.json(await publishedWarmPlaces(), { headers: { "cache-control": "no-store, max-age=0" } });
  }
  const primed = marked ? await primeReaderEdge() : null;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt, primed },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
