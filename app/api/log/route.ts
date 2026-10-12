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
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";

/**
 * POST /api/log accepts the event shape `lib/db/search-log.ts` defines. The browser's random continuity
 * key is digested at the writer and never stored raw;
 * the IP lives only in this instance's memory for the rate-limit window. A malformed event is a 400; a
 * missing database is a 202 so the client stays fire-and-forget.
 */

export const runtime = "nodejs";

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(
    intakeLimits().logEventsPerIpPerMinute,
    60_000,
  );
  return ipLimiter;
}

async function postWithSettings(request: Request) {
  // The master ripcord: one switch closes every intake write path.
  if (ripcordPulled("ripcord.reactionIntake")) {
    return Response.json({ error: "intake is closed" }, { status: 503 });
  }

  const raw = await request.text();

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
    // The IP is used only for this limiter and discarded.
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
    continuityKey?: unknown;
  };

  if (!isValidEventType(event.eventType)) {
    return Response.json({ error: "unknown eventType" }, { status: 400 });
  }
  if (
    !Array.isArray(event.ocdIds) ||
    event.ocdIds.some((v) => typeof v !== "string")
  ) {
    return Response.json({ error: "ocdIds must be an array of strings" }, { status: 400 });
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
  if (event.continuityKey !== undefined && event.continuityKey !== null && typeof event.continuityKey !== "string") {
    return Response.json({ error: "continuityKey must be a string" }, { status: 400 });
  }
  if (event.detail) {
    // Preserve Sean's configured detail limit; Ask questions retain every word.
    const entries = Object.entries(event.detail as Record<string, unknown>);
    const maxChars = intakeLimits().logDetailValueMaxChars;
    for (const [key, value] of entries) {
      if (typeof value === "string" && value.length > maxChars && !(event.eventType === "QUESTION_ASKED" && key === "question")) {
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
    let districtIds = event.ocdIds as string[];
    // A ZIP entry has no point-resolved scope. Resolve all districts touching
    // its area here; an address entry supplies its exact resolved district set.
    if (event.eventType === "ADDRESS_ENTERED" && districtIds.length === 0 && typeof event.approximateLocation === "string" && /^\d{5}$/.test(event.approximateLocation)) {
      const resolution = resolveZip(event.approximateLocation);
      const pointIds = resolution.ok
        ? await divisionsAt(resolution.centroid.lat, resolution.centroid.lng).then(rows => rows.map(row => row.ocdId)).catch(() => [])
        : [];
      districtIds = await divisionIdsForZipArea(event.approximateLocation, pointIds);
    }
    const stored = await logSearchEvent({
      eventType: event.eventType,
      approximateLocation: (event.approximateLocation as string | null | undefined) ?? null,
      ocdIds: districtIds,
      continuityKey: (event.continuityKey as string | null | undefined) ?? null,
      detail: event.detail as Record<string, string | number | boolean> | undefined,
      // Whose traffic this is, declared by the caller at write time.
      // The body is read here as well as the header, because
      // this is the one route a `sendBeacon` reaches, and an unload-time
      // beacon does not carry Playwright's extraHTTPHeaders. A run that
      // declared itself in either place is not recorded as a reader.
      marker: markerFromRequestWithBody(request, body),
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    /*
     * `logSearchEvent` throws both for a malformed event and for a database refusal; the status cannot tell
     * them apart and stays 400, and the alarm carries the database's own words.
     */
    await raiseWriteAlarm("search_log", error);
    return Response.json({ error: String((error as Error).message) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  return withReaderFeatures(() => postWithSettings(request));
}
