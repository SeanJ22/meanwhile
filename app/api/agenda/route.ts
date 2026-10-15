import { ensureReaderAuthorityEdge, readReaderAuthorityManifest, readReaderEdgeMeetings, readReaderManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { settleAgendaSupportingHoldings } from "@/lib/civic-data/agenda-support";
import { meetingReaderRecords } from "@/lib/meetings/reader-records";
import { classifyAgendaPublication, observationFromMeetingRecord, publisherAgendaObservationsFor, readerAgendaDocuments } from "@/lib/ask/agenda-publication";
import { meetingListingKnowledgeFor } from "@/lib/ask/meeting-knowledge";
import { settleOutcomeRead } from "@/lib/outcomes/store";
import { settleRegistryAuthorityReads } from "@/lib/registry/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const meetingId = new URL(request.url).searchParams.get("meetingId");
  if (!meetingId || meetingId.length > 200) {
    return Response.json({ error: "meetingId required" }, { status: 400 });
  }

  let read;
  try {
    const [manifest, authorityManifest] = await Promise.all([
      readReaderManifest().catch(() => null), readReaderAuthorityManifest().catch(() => null),
    ]);
    const authority = authorityManifest ? await ensureReaderAuthorityEdge(authorityManifest, undefined, ["registry-runtime", "meeting-outcomes"]).catch(() => null) : null;
    if (authority) enterReaderAuthorityEdge(authority);
    read = await readReaderEdgeMeetings({ meetingId, manifest, window: "HELD" });
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
  const meeting = snapshot.meetings.find((row) => row.id === meetingId || row.mergedMeetingIds?.includes(meetingId));
  const support = await settleAgendaSupportingHoldings(meetingId, meeting?.bodyId ?? null, {
    outcomes: async () => {
      await settleOutcomeRead();
      return meetingReaderRecords(meetingId, meeting?.bodyId, meeting?.mergedMeetingIds);
    },
    listingIdentity: async () => {
      await settleRegistryAuthorityReads("REGISTRY");
      return meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).readback;
    },
  });
  const observation = meeting ? observationFromMeetingRecord(meeting) : null;
  const heldDocuments = snapshot.agendaDocuments.filter(doc => doc.meetingId === (meeting?.id ?? meetingId));
  const bodyName = meeting?.bodyName ?? heldDocuments[0]?.sourceOrg;
  const publication = bodyName ? classifyAgendaPublication({
    meetingId, bodyName,
    documentsForMeeting: heldDocuments,
    meetingsAcrossCorpus: snapshot.meetings,
    documentsAcrossCorpus: snapshot.agendaDocuments ?? [], discoveredDocumentUrl: meeting?.agendaUrl,
    observations: [...publisherAgendaObservationsFor(meetingId), ...(observation ? [observation] : [])],
    now: Date.now(),
  }) : null;

  const shown = readerAgendaDocuments(heldDocuments, {
    documentsAcrossCorpus: snapshot.agendaDocuments ?? [],
    meetingsAcrossCorpus: snapshot.meetings,
  });
  const documents = shown.documents
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
    documentAccounting: {
      heldRows: shown.heldRows,
      shown: documents.length,
      identicalContentRows: shown.identicalContentRows,
      publicationIndexRowsSetAside: shown.publicationIndexRowsSetAside,
      anotherBodysPagesSetAside: shown.anotherBodysPagesSetAside,
      sittingSpecific: shown.sittingSpecific,
    },
    holdingStatus: "HELD", dataState: read.kind, dataMetadata: read.metadata,
    supportingHoldingStatus: support.supportingHoldingStatus,
    unavailableAuthorities: support.unavailableAuthorities,
    records: support.records, publication,
    listingIdentity: support.listingIdentity });
}
