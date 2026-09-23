import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { classifyAgendaPublication, readerAgendaDocuments } from "./agenda-publication.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { AskSitting } from "./answer.ts";

type HeldAgendaSitting = Pick<AskSitting, "id" | "bodyId" | "title" | "bodyName" | "startsAt">;

/** What Ask holds for one sitting's agenda, read exactly as the meeting leaf reads it. */
export interface SittingAgendaHoldings {
  /**
   * The documents a reader is shown for the sitting, newest first: one per
   * DISTINCT content, and no publication-index page once the sitting's own
   * document is held (`readerAgendaDocuments`, which `/api/agenda` serves).
   * `documents[0]` is the document every agenda item and portal record cites.
   */
  readonly documents: readonly AgendaDocument[];
  /** One AGENDA_DOCUMENT record per shown document. */
  readonly records: EvidenceRecord[];
}

/**
 * **ONE READING OF A SITTING'S HELD AGENDA, FOR EVERY PART OF THE ANSWER.**
 * (2026-09-22.)
 *
 * Ask listed every stored fetch as its own record, told the answer model a
 * sitting held 89 agenda documents, and cited agenda items to the newest
 * STORED row — for Tucson Unified sitting 499 that was 88 re-reads of one
 * unchanged page plus the board's site root, the same false revision the
 * meeting card told. The records, the count the model is given and the
 * document every item and portal record cites now all come from this one
 * projection. The stored rows are untouched; each shown document is the
 * newest row carrying its content.
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
