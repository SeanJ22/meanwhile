import { readMeetingsProjection } from "@/lib/meetings/snapshot";
import type { CivicDataReadMetadata } from "@/lib/civic-data/read-model";
import { readMeetingTranslation } from "@/lib/translate/reader";
import { classifyAgendaPublication, type AgendaPublicationReading } from "@/lib/ask/agenda-publication";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { ripcordPulled } from "@/lib/ripcords";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import { meetingListingKnowledgeFor } from "@/lib/ask/meeting-knowledge";

/**
 * POST /api/ask/agenda — **A05, and nothing else.** (Narrowed by ASK-05,
 * 2026-08-28.)
 *
 *   A05  "What's on the docket for THIS meeting?"   → one meeting's item list
 *
 * ## What left, and why the route is better for it
 *
 * It answered A03 as well — a topic sweep across every readable agenda in a
 * scope — plus a named body's own docket, and it emitted FIVE distinct
 * response shapes out of one handler to do it. Two of those shapes were
 * reader-facing civic answers about what a government has scheduled, and
 * `/api/ask/grounded` answers the same question from a canonical binding, with
 * the reader's tense read as a retrieval instruction, inside one validated
 * evidence pack. A product with two answers to one question has two
 * definitions of Ask truth, and the reader meets whichever their surface
 * happens to call.
 *
 * The topic sweep is not lost. It is `lib/ask/agenda-topic.ts`, it emits
 * `AGENDA_MENTION` records into the grounded engine's pack, and every
 * denominator sentence it used to build survives as a NAMED GAP.
 *
 * What is left here is a LOOKUP: give it a meeting id, get that meeting's own
 * items. It binds nothing, resolves nothing, and makes no claim about which
 * government a question is about — which is why it can coexist with the one
 * Ask engine rather than competing with it.
 *
 * ## Why this is a route and not part of the client pipeline
 *
 * The agenda corpus is about 850 KB of extracted document text across 140
 * documents, and shipping it to a browser to answer one question would be a
 * straight trade of the reader's bandwidth for our architectural convenience.
 * So the corpus stays on the server and the client asks it a question.
 *
 * ## It stores nothing and does not call a model
 *
 * No row, no log line, no device key, no IP kept — the same posture as the
 * classifier route, and for the same reason: there is no store here, so the
 * n-stores rule is not in play.
 *
 * And every string it returns is READ OFF a document a government published.
 * The item list is the clerk's items, verbatim. A previously published,
 * independently checked translation travels separately and only when its
 * source URL and raw document hash match this exact held revision.
 *
 * ## The answer states its denominator
 *
 * `documentsHeld` and `readable` ride on the response. Zero documents held and
 * zero items extracted are DIFFERENT FACTS, and the client says which — an
 * agenda whose text extraction failed is not an agenda with nothing on it.
 */

export const runtime = "nodejs";

/**
 * **THE DECLARED SHAPE OF THE ONE ANSWER THIS ROUTE STILL GIVES.** (ASK-05.)
 *
 * It had none. Every reply was an inline object literal, and the contract
 * existed only as hand-copied interfaces inside client components — which is
 * how one of the deleted shapes came to re-spell `NamedEntityBinding`'s
 * discriminant from `kind` to `state` and drop its `NONE` member in transit
 * without anything failing.
 */
export interface AgendaMeetingReply {
  mode: "meeting";
  meetingId: string;
  title: string;
  bodyName: string;
  startsAt: string;
  /** Stated so a client never has to infer it from an empty item list. */
  documentSharedAcrossGovernments: boolean;
  agendaUrl: string | null;
  documentUrl: string | null;
  sourceOrg: string | null;
  retrievedAt: string | null;
  /** The clerk's own items, verbatim. Empty is a state, never "no items". */
  items: string[];
  summary: { text: string; sourceUrl: string; sourceHash: string; writtenAt: string } | null;
  documentsHeld: number;
  readable: number;
  publication: AgendaPublicationReading;
  listingIdentity: ReturnType<typeof meetingListingKnowledgeFor>["readback"];
  dataState: "PROMOTED" | "BOOTSTRAP";
  dataMetadata: CivicDataReadMetadata;
}

const MAX_BODY_BYTES = 2048;

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

  let body: { meetingId?: unknown };
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
  let read;
  try {
    read = await readMeetingsProjection();
  } catch (error) {
    return Response.json(
      {
        error: "the meetings projection could not be validated",
        dataState: "STORE_UNREACHABLE",
        code: "MEETINGS_PROJECTION_INVALID",
        detail: error instanceof Error ? error.message : "unknown meetings projection error",
      },
      { status: 503 },
    );
  }
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") {
    return Response.json(
      {
        error: "the meetings corpus is not available right now",
        dataState: read.kind,
        ...(read.kind === "STORE_UNREACHABLE" ? { code: read.code } : {}),
        detail: read.detail,
      },
      { status: 503 },
    );
  }
  const snapshot = read.value;

  const documents = snapshot.agendaDocuments ?? [];

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

    /*
     * **A DOCUMENT SHARED WITH ANOTHER GOVERNMENT IS NOT THIS ONE'S AGENDA.**
     * (2026-08-27.)
     *
     * One URL in the corpus is attached to 27 meetings across TWO towns:
     * `bradfordnh.gov/pages/calendar`, on 14 Newbury sittings and 13 Bradford
     * ones. It is Bradford's own calendar — Bradford Town Hall,
     * `bradfordnh.org` addresses, Bradford's board schedules — and it does not
     * mention Newbury anywhere. Some of those rows nonetheless carry
     * `sourceOrg: "Town of Newbury"`.
     *
     * So a reader opening a Newbury Selectboard meeting was handed another
     * town's calendar, attributed to their own town. That is the misattribution
     * class this repository has been closing all session, in the one place it
     * was still open, and it is worse than the same-body landing page: one page
     * cannot be two GOVERNMENTS' agenda under any circumstances.
     *
     * The items are not returned and the attribution is not made. The LINK
     * still travels — a reader may want to see what we actually hold — but it
     * is reported for what it is rather than as this meeting's agenda. The
     * underlying attachment is an ingest defect and is NH255.
     */
    const publication = classifyAgendaPublication({ meetingId, bodyName: meeting.bodyName,
      documentsForMeeting: forMeeting, documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings,
      discoveredDocumentUrl: meeting.agendaUrl, now: Date.now() });
    const sharedAcrossGovernments = publication.documentSharedAcrossGovernments === true;
    const items = newest && !sharedAcrossGovernments ? [...publication.items] : [];
    const translated = newest?.text && meeting.ocdId && !sharedAcrossGovernments
      ? await readMeetingTranslation({ kind: "AGENDA", meetingId, ocdId: meeting.ocdId,
        documentUrl: newest.documentUrl, contentHash: newest.contentHash }).catch(() => null) : null;
    const reply: AgendaMeetingReply = {
      mode: "meeting",
      meetingId,
      title: meeting.title,
      bodyName: meeting.bodyName,
      startsAt: meeting.startsAt,
      /* Stated so the client can say the true thing rather than infer from an
         empty item list, which would read as "nothing is on the agenda". */
      documentSharedAcrossGovernments: sharedAcrossGovernments,
      // The raw link, ALWAYS, whether or not items were extracted. A05's
      // own rule: this sits alongside the agenda link and never replaces it.
      agendaUrl: meeting.agendaUrl ?? null,
      documentUrl: newest?.documentUrl ?? null,
      /* NOT attributed when the document belongs to more than one government:
         the stored sourceOrg says "Town of Newbury" for a Bradford page, and
         repeating it would be the falsehood rather than a record of it. */
      sourceOrg: sharedAcrossGovernments ? null : (newest?.sourceOrg ?? null),
      retrievedAt: newest?.retrievedAt ?? null,
      items,
      summary: translated ? { text: translated.text, sourceUrl: translated.sourceUrl,
        sourceHash: translated.sourceHash, writtenAt: translated.writtenAt } : null,
      // The denominators. `documentsHeld` 0 and `items` 0 mean different
      // things and the client says which.
      documentsHeld: forMeeting.length,
      readable: publication.acquisition === "ITEMS_READER_READY" || publication.acquisition === "READ_NO_ITEMS_EXTRACTED" ? 1 : 0,
      publication,
      listingIdentity: meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).readback,
      dataState: read.kind,
      dataMetadata: read.metadata,
    };
    return Response.json(reply);
  }

  /*
   * **THE TOPIC SWEEP AND THE NAMED-BODY DOCKET BOTH LEFT THIS ROUTE.**
   * (ASK-05, 2026-08-28.)
   *
   * This handler used to answer FIVE distinct shapes out of one POST: a
   * meeting's item list, a body's own docket, a topic sweep, a no-topic reply
   * that still carried a binding, and a refusal that carried a DIFFERENT
   * binding — one of which re-spelled `NamedEntityBinding`'s discriminant from
   * `kind` to `state` and dropped its `NONE` member in transit. Two of the
   * five were reader-facing civic answers competing with `/api/ask/grounded`,
   * and the map component rendered one of them BESIDE the grounded reply on
   * the same screen.
   *
   * Both are the grounded engine's now, and it answers them strictly better:
   * one canonical binder over a superset inventory, the reader's TENSE read as
   * a retrieval instruction, one evidence pack, one validation rung, one
   * denominator vocabulary. The sweep survives as `AGENDA_MENTION` records —
   * see `lib/ask/agenda-topic.ts`, which kept every one of its sentences.
   *
   * **The ownership boundary is no longer a scope flag a client declares.**
   * `scope: "TOPIC_ONLY"` was a promise enforced by a conditional; the branch
   * it guarded does not exist any more, which is a stronger guarantee than any
   * flag — there is nothing left here to reach.
   *
   * What remains is A05 and only A05: ONE named meeting's own item list, keyed
   * on a meeting id. It is a lookup, not an answer about a government, and it
   * has no second definition anywhere. A call without one is told so rather
   * than answered with something else, because answering a question nobody
   * asked is how this route grew five shapes in the first place.
   */
  return Response.json(
    { error: "this route answers one meeting's agenda; pass meetingId" },
    { status: 400 },
  );
}
