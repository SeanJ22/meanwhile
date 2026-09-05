import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { classifyAgendaPublication } from "./agenda-publication.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { AskSitting } from "./answer.ts";

/** The same native documents and publication classifier the meeting leaf uses. */
export function heldAgendaDocumentRecords(meeting: Pick<AskSitting, "id" | "bodyId" | "title" | "bodyName" | "startsAt">,
  documents: readonly AgendaDocument[], meetings: readonly { id: string; ocdId: string | null }[]): EvidenceRecord[] {
  return documents.filter(document => document.meetingId === meeting.id).map(document => {
    const publication = classifyAgendaPublication({ bodyName: meeting.bodyName, meetingId: meeting.id,
      documentsForMeeting: [document], documentsAcrossCorpus: documents, meetingsAcrossCorpus: meetings, now: Date.now() });
    const portal = publication.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX";
    const suppliedTitle = "title" in document && typeof document.title === "string" ? document.title : null;
    return {
      kind: "AGENDA_DOCUMENT", id: document.id, bodyId: meeting.bodyId, meetingId: meeting.id, documentId: document.id,
      text: publication.documentSharedAcrossGovernments
        ? "A stored source link shared across governments; it has not been verified as this body's agenda."
        : portal ? `A publication index for ${meeting.title}; this is not a single meeting's agenda.`
          : suppliedTitle ?? `${meeting.title} — held agenda document`,
      sourceUrl: document.documentUrl, sourceOrg: publication.documentSharedAcrossGovernments ? null : document.sourceOrg,
      retrievedAt: document.retrievedAt, occurredAt: meeting.startsAt,
      agendaDocument: { contentHash: document.contentHash, title: suppliedTitle, publicationIndex: portal },
    };
  });
}
