import { readLocationOrigin, stampResidency, type ResidencyRelation } from "@/lib/ask/residency";
import { appendReaderEvents } from "@/lib/db/reader-events";
import { markerFromRequestWithBody } from "@/lib/db/run-marker";
import { readEventBatch } from "@/lib/events/wire";
import { isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/**
 * POST /api/events: reader event batches, validated and handed to the event store
 * (`lib/db/reader-events.ts`), which deduplicates by batch id. Automated runs count nothing. A malformed batch
 * is refused whole; an unreachable store answers 503 and the batcher retries the same batch id.
 */

export const runtime = "nodejs";

/** The store names the relation in its own words: home, browsing, moving (the moving-here entry), unknown. */
const STORE_RELATION: Record<ResidencyRelation, "HOME" | "BROWSING" | "MOVING" | "UNKNOWN"> = {
  CURRENT_HOME: "HOME",
  PROSPECTIVE_HOME: "MOVING",
  BROWSING: "BROWSING",
  UNKNOWN: "UNKNOWN",
};

/** One batch per quiet period is normal; a script pumping them is not. */
let ipLimiter: SlidingWindowLimiter | null = null;
function limiter() {
  ipLimiter ??= new SlidingWindowLimiter(60, 60_000);
  return ipLimiter;
}

export async function POST(request: Request) {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  // Same-origin: these come from pages this site served; sendBeacon and fetch both attach Origin.
  if (!isSameOriginSubmission(request)) {
    return Response.json({ error: "cross-origin submissions are not accepted" }, { status: 403 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!limiter().allow(`ip:${ip}`)) {
    return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  }

  const batch = readEventBatch(body);
  if (batch === null) {
    return Response.json({ error: "malformed event batch" }, { status: 400 });
  }

  // An automated run is not a reader: accepted, counted nowhere.
  if (markerFromRequestWithBody(request, body).runClass !== "ORGANIC") {
    return new Response(null, { status: 202 });
  }

  try {
    // A batch the store has already counted answers the same as a new one; the client only needs to stop retrying.
    await appendReaderEvents({
      batchId: batch.batchId,
      continuityKey: batch.continuityKey,
      events: batch.events.map(({ locationOrigin, ...event }) => ({
        ...event,
        ...(locationOrigin !== undefined
          ? { residencyRelation: STORE_RELATION[stampResidency(readLocationOrigin(locationOrigin)).relation] }
          : {}),
      })),
    });
    return new Response(null, { status: 204 });
  } catch {
    // The store is the one thing that can fail here, and the batcher retries the same batch id.
    return Response.json({ error: "event store unavailable" }, { status: 503 });
  }
}
