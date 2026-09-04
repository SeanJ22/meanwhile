import { readSnapshot } from "@/lib/meetings/snapshot";
import { meetingReaderRecords } from "@/lib/meetings/reader-records";
import { classifyAgendaPublication, observationFromMeetingRecord, publisherAgendaObservationsFor } from "@/lib/ask/agenda-publication";

/**
 * GET /api/agenda?meetingId=<source-namespaced id>
 *
 * The stored agenda documents for one meeting, from the committed snapshot —
 * the append-only versions the retrieval pass already fetched (4c). The
 * documents are ALREADY in the repository; this route exists because the
 * meeting surface was linking them while rendering their content as absent.
 *
 * Newest version first. A document whose extraction failed is returned with
 * its note and null text — the surface says so honestly and links the
 * document rather than pretending nothing exists.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const meetingId = new URL(request.url).searchParams.get("meetingId");
  if (!meetingId || meetingId.length > 200) {
    return Response.json({ error: "meetingId required" }, { status: 400 });
  }

  let snapshot;
  try { snapshot = readSnapshot(); } catch { snapshot = null; }
  const meeting = snapshot?.meetings.find((row) => row.id === meetingId);
  const records = meetingReaderRecords(meetingId, meeting?.bodyId);
  const observation = meeting ? observationFromMeetingRecord(meeting) : null;
  const heldDocuments = (snapshot?.agendaDocuments ?? []).filter(doc => doc.meetingId === meetingId);
  const bodyName = meeting?.bodyName ?? heldDocuments[0]?.sourceOrg;
  const publication = snapshot && bodyName ? classifyAgendaPublication({
    meetingId, bodyName,
    documentsForMeeting: heldDocuments,
    meetingsAcrossCorpus: snapshot.meetings,
    documentsAcrossCorpus: snapshot.agendaDocuments ?? [], discoveredDocumentUrl: meeting?.agendaUrl,
    observations: [...publisherAgendaObservationsFor(meetingId), ...(observation ? [observation] : [])],
    now: Date.now(),
  }) : null;

  const documents = (snapshot?.agendaDocuments ?? [])
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
    holdingStatus: snapshot ? "HELD" : "HOLDING_UNAVAILABLE", records, publication });
}
