import { readReaderEdgeMeetings } from "@/lib/meetings/edge-serving";
import type { CivicDataReadMetadata } from "@/lib/civic-data/read-model";
import { readMeetingTranslation } from "@/lib/translate/reader";
import { classifyAgendaPublication, type AgendaPublicationReading } from "@/lib/ask/agenda-publication";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { ripcordPulled } from "@/lib/ripcords";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import { meetingListingKnowledgeFor } from "@/lib/ask/meeting-knowledge";

export const runtime = "nodejs";

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

  if (typeof body.meetingId !== "string" || body.meetingId.length === 0) {
    return Response.json({ error: "this route answers one meeting's agenda; pass meetingId" }, { status: 400 });
  }
  const meetingId = body.meetingId.slice(0, 200);
  let read;
  try {
    read = await readReaderEdgeMeetings({ meetingId, window: "HELD" });
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

  const meeting = snapshot.meetings.find((m) => m.id === meetingId || m.mergedMeetingIds?.includes(meetingId));
  if (!meeting) {
    return Response.json({ error: "unknown meeting" }, { status: 400 });
  }
  const forMeeting = documents.filter((d) => d.meetingId === meeting.id);
  // Newest retrieval wins — an agenda is revised, and the revision is the
  // one the reader is going to.
  const newest = [...forMeeting].sort((a, b) =>
    a.retrievedAt < b.retrievedAt ? 1 : -1,
  )[0];

  const publication = classifyAgendaPublication({ meetingId: meeting.id, bodyName: meeting.bodyName,
    documentsForMeeting: forMeeting, documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings,
    discoveredDocumentUrl: meeting.agendaUrl, now: Date.now() });
  const sharedAcrossGovernments = publication.documentSharedAcrossGovernments === true;
  const items = newest && !sharedAcrossGovernments ? [...publication.items] : [];
  const translated = newest?.text && meeting.ocdId && meeting.bodyId && !sharedAcrossGovernments
    ? await readMeetingTranslation({ kind: "AGENDA", meetingId: meeting.id, ocdId: meeting.ocdId,
      bodyId: meeting.bodyId, documentUrl: newest.documentUrl, contentHash: newest.contentHash }).catch(() => null) : null;
  const reply: AgendaMeetingReply = {
    mode: "meeting",
    meetingId,
    title: meeting.title,
    bodyName: meeting.bodyName,
    startsAt: meeting.startsAt,
    documentSharedAcrossGovernments: sharedAcrossGovernments,
    agendaUrl: meeting.agendaUrl ?? null,
    documentUrl: newest?.documentUrl ?? null,
    sourceOrg: sharedAcrossGovernments ? null : (newest?.sourceOrg ?? null),
    retrievedAt: newest?.retrievedAt ?? null,
    items,
    summary: translated ? { text: translated.text, sourceUrl: translated.sourceUrl,
      sourceHash: translated.sourceHash, writtenAt: translated.writtenAt } : null,
    documentsHeld: forMeeting.length,
    readable: publication.acquisition === "ITEMS_READER_READY" || publication.acquisition === "READ_NO_ITEMS_EXTRACTED" ? 1 : 0,
    publication,
    listingIdentity: meetingListingKnowledgeFor(snapshot.meetings, [meeting.id]).readback,
    dataState: read.kind,
    dataMetadata: read.metadata,
  };
  return Response.json(reply);
}
