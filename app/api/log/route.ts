import {
  assertDetailIsAnonymous,
  isValidEventType,
  logSearchEvent,
} from "@/lib/db/search-log";

/**
 * POST /api/log — the client-side half of the search log.
 *
 * Accepts exactly the event shape `lib/db/search-log.ts` defines and nothing
 * more. There is deliberately no identifier to accept: no auth, no cookie
 * read, no IP capture — the handler never looks at request headers beyond
 * the body. A malformed event is a 400 with the reason; a missing database
 * is a 202 (accepted, not stored) so the client stays fire-and-forget.
 *
 * Disclosed on /transparency, which ships in the same change as this route
 * and must keep shipping with it — collecting silently is the failure this
 * product cannot survive.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
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

  try {
    if (event.detail) {
      assertDetailIsAnonymous(event.detail as Record<string, string | number | boolean>);
    }
    const stored = await logSearchEvent({
      eventType: event.eventType,
      approximateLocation: (event.approximateLocation as string | null | undefined) ?? null,
      ocdIds: event.ocdIds as string[],
      detail: event.detail as Record<string, string | number | boolean> | undefined,
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    return Response.json({ error: String((error as Error).message) }, { status: 400 });
  }
}
