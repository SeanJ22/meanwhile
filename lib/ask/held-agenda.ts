import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { classifyAgendaPublication, readerAgendaDocuments } from "./agenda-publication.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { AskSitting } from "./answer.ts";

/**
 * The same documents the meeting leaf shows, through the same projection
 * (`readerAgendaDocuments`, which `/api/agenda` serves): one record per
 * DISTINCT content of the sitting's document, and no publication-index page
 * once the sitting's own document is held. (2026-09-22.) This listed every
 * stored fetch, so Ask handed a reader 89 "held agenda document" records for
 * Tucson Unified sitting 499 — 88 re-reads of one unchanged page plus the
 * board's site root — the same false revision the card told. The stored rows
 * are untouched; each shown record is the newest row carrying its content.
 */
export function heldAgendaDocumentRecords(meeting: Pick<AskSitting, "id" | "bodyId" | "title" | "bodyName" | "startsAt">,
  documents: readonly AgendaDocument[], meetings: readonly { id: string; ocdId: string | null }[]): EvidenceRecord[] {
  const held = documents.filter(document => document.meetingId === meeting.id);
  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: documents, meetingsAcrossCorpus: meetings });
  return shown.documents.map(document => {
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
