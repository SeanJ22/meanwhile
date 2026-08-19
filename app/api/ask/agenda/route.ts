import { readSnapshot } from "@/lib/meetings/snapshot";
import {
  agendaItems,
  agendaTopicFor,
  meetingsWithin,
  searchAgendas,
  type AgendaDocumentLike,
} from "@/lib/routing/agenda-search";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { ripcordPulled } from "@/lib/ripcords";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/**
 * POST /api/ask/agenda — A03 and A05, the two ask-box questions that need
 * the agenda corpus.
 *
 *   A03  "Is there a data center coming?"   → mode "topic"
 *   A05  "What's on the docket for this?"   → mode "meeting"
 *
 * ## Why this is a route and not part of the client pipeline
 *
 * `answerQuestion` is pure and client-safe, which is the whole reason the
 * golden tests can run it against the real registry. The agenda corpus is
 * about 850 KB of extracted document text across 140 documents, and shipping
 * it to a browser to answer one question would be a straight trade of the
 * reader's bandwidth for our architectural convenience. So the corpus stays
 * on the server and the client asks it a question.
 *
 * ## It stores nothing, and it generates nothing
 *
 * No row, no log line, no device key, no IP kept — the same posture as the
 * classifier route, and for the same reason: there is no store here, so the
 * n-stores rule is not in play.
 *
 * And every string it returns is READ OFF a document a government published.
 * The quote is the clerk's line, verbatim. The item list is the clerk's
 * items, verbatim. Nothing is summarised, because a summary of a zoning
 * agenda is a claim about what a government is about to do, made by us.
 *
 * ## Every answer states its denominator
 *
 * `searched` and `unreadable` ride on every response. A search over 122
 * readable documents that found nothing is a different sentence from a
 * search over 0, and an agenda whose text extraction failed is not an
 * agenda with nothing on it. The client renders the number it was given.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2048;
const MAX_QUESTION_CHARS = 200;
/** The radius ladder the map already uses, in miles. */
const DEFAULT_RADIUS_MILES = 25;
const MAX_RADIUS_MILES = 100;
/** Enough to answer, few enough to read. Stated in the response. */
const MAX_HITS = 12;

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(
    intakeLimits().logEventsPerIpPerMinute,
    60_000,
  );
  return ipLimiter;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let body: {
    question?: unknown;
    meetingId?: unknown;
    lat?: unknown;
    lng?: unknown;
    radiusMiles?: unknown;
    ocdIds?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json({ error: "cross-origin not accepted" }, { status: 403 });
    }
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!getIpLimiter().allow(`ip:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  // No corpus is a STATE, and it is reported as one — never as an answer
  // of "nothing is scheduled", which is the same absence-as-assertion the
  // render rule forbids one layer up.
  const snapshot = readSnapshot();
  if (!snapshot) {
    return Response.json(
      { error: "the meetings corpus is not available right now" },
      { status: 503 },
    );
  }

  const documents = (snapshot.agendaDocuments ?? []) as AgendaDocumentLike[];

  // ── A05: one named meeting's own item list ────────────────────────────
  if (typeof body.meetingId === "string" && body.meetingId.length > 0) {
    const meetingId = body.meetingId.slice(0, 200);
    const meeting = snapshot.meetings.find((m) => m.id === meetingId);
    if (!meeting) {
      return Response.json({ error: "unknown meeting" }, { status: 400 });
    }
    const forMeeting = documents.filter((d) => d.meetingId === meetingId);
    // Newest retrieval wins — an agenda is revised, and the revision is the
    // one the reader is going to.
    const newest = [...forMeeting].sort((a, b) =>
      a.retrievedAt < b.retrievedAt ? 1 : -1,
    )[0];
    const items = newest ? agendaItems(newest.text) : [];
    return Response.json({
      mode: "meeting",
      meetingId,
      title: meeting.title,
      bodyName: meeting.bodyName,
      startsAt: meeting.startsAt,
      // The raw link, ALWAYS, whether or not items were extracted. A05's
      // own rule: this sits alongside the agenda link and never replaces it.
      agendaUrl: meeting.agendaUrl ?? null,
      documentUrl: newest?.documentUrl ?? null,
      sourceOrg: newest?.sourceOrg ?? null,
      retrievedAt: newest?.retrievedAt ?? null,
      items,
      // The denominators. `documentsHeld` 0 and `items` 0 mean different
      // things and the client says which.
      documentsHeld: forMeeting.length,
      readable: newest?.text ? 1 : 0,
    });
  }

  // ── A03: a topic, within a radius ─────────────────────────────────────
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }
  const question = body.question.slice(0, MAX_QUESTION_CHARS);
  const topic = agendaTopicFor(question);
  if (!topic) {
    // No topic is not a refusal to answer the reader — it means this rung
    // has nothing to say and the caller's other rungs continue. Stated as
    // such rather than as an empty result set.
    return Response.json({ mode: "topic", topic: null, hits: [] });
  }

  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;
  const radiusMiles = Math.min(
    MAX_RADIUS_MILES,
    typeof body.radiusMiles === "number" && body.radiusMiles > 0
      ? body.radiusMiles
      : DEFAULT_RADIUS_MILES,
  );

  /*
   * TWO WAYS TO SCOPE, and the DIVISION one is what actually ships.
   *
   * A03's wording is "within a radius", and a radius is what the map's own
   * layer uses — so `meetingsWithin` exists and this route takes a point.
   * But distance is the wrong instrument for this question: a rezoning in
   * YOUR town is your business whether the town hall is two miles away or
   * thirty, and a county board thirty miles off decides more of your street
   * than a neighbouring city's council does at five. The divisions the
   * reader is standing in are the honest scope, and they are already
   * resolved — the same approximate-location basis the search log uses.
   *
   * So: divisions when given, radius when a caller has a point and no
   * divisions, and the whole corpus when neither. The response says which,
   * because "we found nothing" means different things in each.
   */
  const ocdIds = Array.isArray(body.ocdIds)
    ? body.ocdIds.filter((v): v is string => typeof v === "string").slice(0, 40)
    : [];

  let eligibleIds: Set<string> | null = null;
  let placeless = 0;
  let outside = 0;
  let scope: "divisions" | "radius" | "everything" = "everything";

  if (ocdIds.length > 0) {
    scope = "divisions";
    const wanted = new Set(ocdIds);
    eligibleIds = new Set(
      snapshot.meetings
        .filter((m) => m.ocdId !== null && wanted.has(m.ocdId))
        .map((m) => m.id),
    );
    outside = snapshot.meetings.length - eligibleIds.size;
  } else if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
    scope = "radius";
    const scoped = meetingsWithin(snapshot.meetings, { lat, lng }, radiusMiles);
    eligibleIds = new Set(scoped.within.map((m) => m.id));
    placeless = scoped.placeless.length;
    outside = scoped.outside;
  }

  const scopedDocs = eligibleIds
    ? documents.filter((d) => eligibleIds.has(d.meetingId))
    : documents;
  const { hits, searched, unreadable } = searchAgendas(scopedDocs, topic);

  const byMeeting = new Map<string, (typeof snapshot.meetings)[number]>();
  for (const meeting of snapshot.meetings) byMeeting.set(meeting.id, meeting);

  return Response.json({
    mode: "topic",
    topic: { id: topic.id, label: topic.label },
    scope,
    radiusMiles: scope === "radius" ? radiusMiles : null,
    divisionsAsked: ocdIds.length,
    hits: hits.slice(0, MAX_HITS).map((hit) => {
      const meeting = byMeeting.get(hit.meetingId);
      return {
        ...hit,
        bodyName: meeting?.bodyName ?? null,
        title: meeting?.title ?? null,
        startsAt: meeting?.startsAt ?? null,
        agendaUrl: meeting?.agendaUrl ?? null,
        locationName: meeting?.location?.name ?? null,
      };
    }),
    // Stated N equals rendered rows: `hits` is what is returned, `hitsFound`
    // is what existed, and a clip must not read as a small result.
    hitsFound: hits.length,
    searched,
    unreadable,
    placeless,
    outside,
  });
}
