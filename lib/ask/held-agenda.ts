import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { classifyAgendaPublication, readerAgendaDocuments } from "./agenda-publication.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { AskSitting } from "./answer.ts";

type HeldAgendaSitting = Pick<AskSitting, "id" | "bodyId" | "title" | "bodyName" | "startsAt">;

/** What Ask holds for one sitting's agenda, read exactly as the meeting leaf reads it. */
export interface SittingAgendaHoldings {
  /**
   * The documents a reader is shown for the sitting, newest first
   * (`readerAgendaDocuments`, as `/api/agenda` serves). `documents[0]` is the
   * document every agenda item and portal record cites.
   */
  readonly documents: readonly AgendaDocument[];
  /** One AGENDA_DOCUMENT record per shown document. */
  readonly records: EvidenceRecord[];
}

/**
 * One reading of a sitting's held agenda for every part of the answer: the
 * records, the count the model is given and the cited document all come from
 * this projection. Stored rows are untouched.
 */
export function sittingAgendaHoldings(
  meeting: HeldAgendaSitting,
  documents: readonly AgendaDocument[],
  meetings: readonly { id: string; ocdId: string | null }[],
): SittingAgendaHoldings {
  const held = documents.filter(document => document.meetingId === meeting.id);
  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: documents, meetingsAcrossCorpus: meetings });
  return {
    documents: shown.documents,
    records: shown.documents.map(document => {
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
      } satisfies EvidenceRecord;
    }),
  };
}

/** The AGENDA_DOCUMENT records of `sittingAgendaHoldings`. */
export function heldAgendaDocumentRecords(meeting: HeldAgendaSitting,
  documents: readonly AgendaDocument[], meetings: readonly { id: string; ocdId: string | null }[]): EvidenceRecord[] {
  return sittingAgendaHoldings(meeting, documents, meetings).records;
}
