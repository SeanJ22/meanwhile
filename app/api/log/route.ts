import { withReaderFeatures } from "@/lib/civic-data/reader-feature-context.ts";
import { markerFromRequestWithBody } from "@/lib/db/run-marker";
import { raiseWriteAlarm } from "@/lib/db/write-alarm";
import {
  assertDetailIsAnonymous,
  isValidEventType,
  logSearchEvent,
} from "@/lib/db/search-log";
import { ripcordPulled } from "@/lib/ripcords";
import {
  intakeLimits,
  isSameOriginSubmission,
} from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/**
 * POST /api/log — the client-side half of the search log, hardened (T08).
 *
 * Accepts exactly the event shape `lib/db/search-log.ts` defines and nothing
 * more. There is deliberately no identifier to accept: no auth, no cookie
 * read, no IP capture beyond the transient rate-limit window below. A
 * malformed event is a 400 with the reason; a missing database is a 202
 * (accepted, not stored) so the client stays fire-and-forget.
 *
 * T08 adds, in the same shape as /api/reactions:
 * - a body-size cap and a server-enforced length cap on every detail
 *   string (the ask box caps client-side; the server stops trusting it) —
 *   validity, never behind a flag;
 * - same-origin enforcement and a per-IP window (inside
 *   `ripcord.rateLimits`) so text cannot be pumped in from scripts that
 *   never loaded the site. The IP lives only in this instance's memory for
 *   the window's duration — never stored, never logged;
 * - the master ripcord `ripcord.reactionIntake`, which closes this intake
 *   with the reaction store's (one switch closes every write path). The
 *   client is fire-and-forget by design, so a refused log event costs the
 *   reader nothing.
 *
 * Disclosed on /transparency, which ships in the same change as this route
 * and must keep shipping with it — collecting silently is the failure this
 * product cannot survive.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(
    intakeLimits().logEventsPerIpPerMinute,
    60_000,
  );
  return ipLimiter;
}

async function postWithSettings(request: Request) {
  // The master ripcord (T08): one switch closes every intake write path.
  if (ripcordPulled("ripcord.reactionIntake")) {
    return Response.json({ error: "intake is closed" }, { status: 503 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (!ripcordPulled("ripcord.rateLimits")) {
    // Same-origin: log events come from pages this site served —
    // sendBeacon and fetch both attach Origin to a POST.
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }
    // Per-IP window only — the log deliberately has no device key to
    // limit on. The IP is read here and discarded.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!getIpLimiter().allow(`ip:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  const event = body as {
    eventType?: unknown;
    approximateLocation?: unknown;
    ocdIds?: unknown;
    detail?: unknown;
  };

  if (!isValidEventType(event.eventType)) {
    return Response.json({ error: "unknown eventType" }, { status: 400 });
  }
  if (
    !Array.isArray(event.ocdIds) ||
    event.ocdIds.length > 40 ||
    event.ocdIds.some((v) => typeof v !== "string" || v.length > 200)
  ) {
    return Response.json({ error: "ocdIds must be a short array of strings" }, { status: 400 });
  }
  if (
    event.approximateLocation !== undefined &&
    event.approximateLocation !== null &&
    typeof event.approximateLocation !== "string"
  ) {
    return Response.json({ error: "approximateLocation must be a string" }, { status: 400 });
  }
  if (event.detail !== undefined && (typeof event.detail !== "object" || event.detail === null)) {
    return Response.json({ error: "detail must be an object" }, { status: 400 });
  }
  if (event.detail) {
    // Server-enforced caps on the detail bag (T08 1c): the client caps the
    // refusal-question text, and the server no longer takes its word for
    // it. Validity, so never behind a flag.
    const entries = Object.entries(event.detail as Record<string, unknown>);
    const maxChars = intakeLimits().logDetailValueMaxChars;
    if (entries.length > 20) {
      return Response.json({ error: "detail carries too many keys" }, { status: 400 });
    }
    for (const [key, value] of entries) {
      if (key.length > 64 || (typeof value === "string" && value.length > maxChars)) {
        return Response.json(
          { error: "detail strings exceed the server cap" },
          { status: 400 },
        );
      }
    }
  }

  try {
    if (event.detail) {
      assertDetailIsAnonymous(event.detail as Record<string, string | number | boolean>);
    }
    const stored = await logSearchEvent({
      eventType: event.eventType,
      approximateLocation: (event.approximateLocation as string | null | undefined) ?? null,
      ocdIds: event.ocdIds as string[],
      detail: event.detail as Record<string, string | number | boolean> | undefined,
      // C05: whose traffic this is, declared by the caller at write time.
      //
      // Item 4b (g17): the BODY is read here as well as the header, because
      // this is the one route a `sendBeacon` reaches, and an unload-time
      // beacon does not carry Playwright's extraHTTPHeaders. A run that
      // declared itself in either place is not recorded as a reader.
      marker: markerFromRequestWithBody(request, body),
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    /*
     * **RULING 25 — THE READER-FACING ANSWER IS UNCHANGED** (Prompt D item 6.3,
     * D73). The 400 and its body are exactly what shipped before.
     *
     * The sweep found this route by asking which call sites write to a SOLD
     * STORE: three, and this is the third. `logSearchEvent` throws for two
     * different reasons that arrive at this same catch — a caller sending a
     * malformed event, which is genuinely a 400, and the DATABASE refusing the
     * insert, which is not the caller's fault at all and is precisely D73's
     * shape. The status cannot tell them apart and is deliberately left alone;
     * the alarm does not need to, because a raised alarm is read by a human who
     * can see the database's own words.
     */
    await raiseWriteAlarm("search_log", error);
    return Response.json({ error: String((error as Error).message) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  return withReaderFeatures(() => postWithSettings(request));
}
