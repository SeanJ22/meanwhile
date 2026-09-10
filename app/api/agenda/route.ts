import { readMeetingsProjection } from "@/lib/meetings/snapshot";
import { meetingReaderRecords } from "@/lib/meetings/reader-records";
import { classifyAgendaPublication, observationFromMeetingRecord, publisherAgendaObservationsFor } from "@/lib/ask/agenda-publication";
import { meetingListingKnowledgeFor } from "@/lib/ask/meeting-knowledge";
import { refreshOutcomeSnapshotFromPromoted } from "@/lib/outcomes/store";
import { refreshRegistryRuntimeFromPromoted } from "@/lib/registry/runtime-read-model";

/**
 * GET /api/agenda?meetingId=<source-namespaced id>
 *
 * The stored agenda documents for one meeting, from the promoted projection —
 * the append-only versions the retrieval pass already fetched (4c). The
 * documents are already in the canonical holding; this route exists because the
 * meeting surface was linking them while rendering their content as absent.
 *
 * Newest version first. A document whose extraction failed is returned with
 * its note and null text — the surface says so honestly and links the
 * document rather than pretending nothing exists.
 */

export const runtime = "nodejs";

export interface AgendaSupportingReaders<TListing> {
  readonly outcomes: () => Promise<ReturnType<typeof meetingReaderRecords>>;
  readonly listingIdentity: () => Promise<TListing>;
}

/** Supporting outcomes and body identity cannot erase held meeting documents. */
export async function settleAgendaSupportingHoldings<TListing>(
  meetingId: string,
  bodyId: string | null,
  readers: AgendaSupportingReaders<TListing>,
): Promise<{
  records: ReturnType<typeof meetingReaderRecords>;
  listingIdentity: TListing | null;
  supportingHoldingStatus: "HELD" | "PARTIAL";
  unavailableAuthorities: string[];
}> {
  const [outcomeResult, listingResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.outcomes()),
    Promise.resolve().then(() => readers.listingIdentity()),
  ]);
  const unavailableAuthorities: string[] = [];
  if (outcomeResult.status === "rejected") unavailableAuthorities.push("MEETING_OUTCOME");
  if (listingResult.status === "rejected") unavailableAuthorities.push("REGISTRY_RUNTIME_BINDING");
  return {
    records: outcomeResult.status === "fulfilled" ? outcomeResult.value : {
      meetingId,
      bodyId,
      status: "HOLDING_UNAVAILABLE",
      agenda: [],
      actions: [],
      rollCalls: [],
      counts: { agenda: 0, actions: 0, rollCalls: 0, votes: 0 },
      sourceUrl: null,
      sourceOrg: null,
    },
    listingIdentity: listingResult.status === "fulfilled" ? listingResult.value : null,
    supportingHoldingStatus: unavailableAuthorities.length ? "PARTIAL" : "HELD",
    unavailableAuthorities,
  };
}

export async function GET(request: Request) {
  const meetingId = new URL(request.url).searchParams.get("meetingId");
  if (!meetingId || meetingId.length > 200) {
    return Response.json({ error: "meetingId required" }, { status: 400 });
  }

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
  const meeting = snapshot.meetings.find((row) => row.id === meetingId);
  const support = await settleAgendaSupportingHoldings(meetingId, meeting?.bodyId ?? null, {
    outcomes: async () => {
      await refreshOutcomeSnapshotFromPromoted();
      return meetingReaderRecords(meetingId, meeting?.bodyId);
    },
    listingIdentity: async () => {
      await refreshRegistryRuntimeFromPromoted();
      return meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).readback;
    },
  });
  const observation = meeting ? observationFromMeetingRecord(meeting) : null;
  const heldDocuments = snapshot.agendaDocuments.filter(doc => doc.meetingId === meetingId);
  const bodyName = meeting?.bodyName ?? heldDocuments[0]?.sourceOrg;
  const publication = bodyName ? classifyAgendaPublication({
    meetingId, bodyName,
    documentsForMeeting: heldDocuments,
    meetingsAcrossCorpus: snapshot.meetings,
    documentsAcrossCorpus: snapshot.agendaDocuments ?? [], discoveredDocumentUrl: meeting?.agendaUrl,
    observations: [...publisherAgendaObservationsFor(meetingId), ...(observation ? [observation] : [])],
    now: Date.now(),
  }) : null;

  const documents = snapshot.agendaDocuments
    .filter((doc) => doc.meetingId === meetingId)
    .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))
    .map((doc) => ({
      id: doc.id,
      documentUrl: doc.documentUrl,
      /** Cited by curated notice summaries — an exact-version key. */
      contentHash: doc.contentHash,
      retrievedAt: doc.retrievedAt,
      contentType: doc.contentType,
      extraction: doc.extraction,
      extractionNote: doc.extractionNote,
      text: doc.text,
      sourceOrg: doc.sourceOrg,
    }));

  return Response.json({ meetingId, documents, documentCount: documents.length,
    holdingStatus: "HELD", dataState: read.kind, dataMetadata: read.metadata,
    supportingHoldingStatus: support.supportingHoldingStatus,
    unavailableAuthorities: support.unavailableAuthorities,
    records: support.records, publication,
    listingIdentity: support.listingIdentity });
}
