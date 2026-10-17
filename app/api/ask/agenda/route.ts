import { readerRoute } from "@/lib/api/reader-route";
import { readReaderEdgeMeetings } from "@/lib/meetings/edge-serving";
import type { CivicDataReadMetadata } from "@/lib/civic-data/read-model";
import { readMeetingTranslation } from "@/lib/translate/reader";
import { classifyAgendaPublication, type AgendaPublicationReading } from "@/lib/ask/agenda-publication";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { ripcordPulled } from "@/lib/ripcords";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import { meetingListingKnowledgeFor } from "@/lib/ask/meeting-knowledge";
import { readRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model";
import { statesForRegistryDivisions } from "@/lib/civic-data/state-scopes";



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

export const POST = readerRoute("/api/ask/agenda", async function POST(request: Request) {
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
  if (typeof body.meetingId !== "string" || !body.meetingId) {
    return Response.json({ error: "this route answers one meeting's agenda; pass meetingId" }, { status: 400 });
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

  let read;
  try {
    read = await readReaderEdgeMeetings({
      meetingId: typeof body.meetingId === "string" ? body.meetingId.slice(0, 200) : undefined,
      window: "HELD",
    });
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

  if (typeof body.meetingId === "string" && body.meetingId.length > 0) {
    const meetingId = body.meetingId;
    const meeting = snapshot.meetings.find((m) => m.id === meetingId);
    if (!meeting) {
      return Response.json({ error: "unknown meeting" }, { status: 400 });
    }
    await readRegistryRuntimeProjection(statesForRegistryDivisions([meeting.ocdId ?? "", meeting.bodyId ?? ""]));
    const forMeeting = documents.filter((d) => d.meetingId === meetingId);
    // Newest retrieval wins — an agenda is revised, and the revision is the
    // one the reader is going to.
    const newest = [...forMeeting].sort((a, b) =>
      a.retrievedAt < b.retrievedAt ? 1 : -1,
    )[0];


    const publication = classifyAgendaPublication({ meetingId, bodyName: meeting.bodyName,
      documentsForMeeting: forMeeting, documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings,
      discoveredDocumentUrl: meeting.agendaUrl, now: Date.now() });
    const sharedAcrossGovernments = publication.documentSharedAcrossGovernments === true;
    const items = newest && !sharedAcrossGovernments ? [...publication.items] : [];
    const translated = newest?.text && meeting.ocdId && meeting.bodyId && !sharedAcrossGovernments
      ? await readMeetingTranslation({ kind: "AGENDA", meetingId, ocdId: meeting.ocdId,
        bodyId: meeting.bodyId, documentUrl: newest.documentUrl, contentHash: newest.contentHash }).catch(() => null) : null;
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
      /* Not attributed when the document belongs to more than one government. */
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

  return Response.json(
    { error: "this route answers one meeting's agenda; pass meetingId" },
    { status: 400 },
  );
}, ["registry-runtime"]);
