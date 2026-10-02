import { readLocationOrigin, stampResidency, type ResidencyRelation } from "@/lib/ask/residency";
import { appendReaderEvents } from "@/lib/db/reader-events";
import { countRefusedBatch, type RefusalReason } from "@/lib/db/reader-event-refusals";
import { markerFromRequestWithBody } from "@/lib/db/run-marker";
import { MAX_BATCH_BYTES, readEventBatch } from "@/lib/events/wire";
import { isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/**
 * POST /api/events — what readers did, in batches (S2.4, October 1, 2026).
 *
 * The browser batcher (`lib/events/client.ts`) sends the returning-reader ID
 * and up to 128 events per request; this route validates the shape, stamps each
 * ZIP view with the residency relation the way Ask does (a client never asserts
 * how sure we are of a location), and hands the batch to the event store
 * (`lib/db/reader-events.ts`), which archives it, deduplicates by batch id and
 * keeps exact day and week totals. Nothing here writes a row of its own.
 *
 * Automated runs declare themselves and count nothing: they are not readers.
 * A malformed batch is refused whole. A store that cannot be reached answers
 * 503 and the batcher retries the same batch id, which the store drops if it
 * was in fact counted.
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

/** Every refusal is counted by day and reason (migration 0035), then answered. */
async function refuse(reason: RefusalReason, response: Response): Promise<Response> {
  await countRefusedBatch(reason);
  return response;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BATCH_BYTES) {
    return refuse("TOO_LARGE", Response.json({ error: "payload too large" }, { status: 413 }));
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse("NOT_JSON", Response.json({ error: "body must be JSON" }, { status: 400 }));
  }

  // Same-origin: these come from pages this site served; sendBeacon and fetch both attach Origin.
  if (!isSameOriginSubmission(request)) {
    return refuse("CROSS_ORIGIN", Response.json({ error: "cross-origin submissions are not accepted" }, { status: 403 }));
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!limiter().allow(`ip:${ip}`)) {
    return refuse("RATE_LIMITED", new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
  }

  const batch = readEventBatch(body);
  if (batch === null) {
    return refuse("MALFORMED", Response.json({ error: "malformed event batch" }, { status: 400 }));
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
    return refuse("STORE_UNAVAILABLE", Response.json({ error: "event store unavailable" }, { status: 503 }));
  }
}
