"use client";

import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { CardSource } from "@/lib/officials/card-sources";

import { CheckedLink } from "@/components/ui/checked-link";
import { useEffect, useState } from "react";
import { agendaSentenceFor } from "@/lib/ask/agenda-sentence";
import type { AgendaPublicationReading } from "@/lib/ask/agenda-publication";

import { noticeSummaryFor } from "@/lib/meetings/notice-summary";

import { agendaItems } from "@/lib/routing/agenda-search";
import type { MeetingReaderRecords } from "@/lib/meetings/reader-records";
import { MeetingRecords } from "./meeting-records";
import { minutesSummaryForMeeting } from "@/lib/meetings/minutes-summaries";

/**
 * The meeting's stored notice or agenda text on the meeting surface: public
 * hearing items called out, the document's own text below, and the link where
 * extraction failed.
 */

interface AgendaDocumentView {
  /** Present on every row `/api/agenda` returns; optional for hand-built views. */
  id?: string;
  documentUrl: string;
  contentHash: string;
  retrievedAt: string;
  contentType: string;
  extraction: "html" | "pdf" | "failed";
  extractionNote: string | null;
  text: string | null;
  sourceOrg: string;
}

interface AgendaSectionProps {
  meetingId: string;
  /** The body the meeting belongs to; a meeting is read from its body's record. */
  bodyId: string;
  /** The meeting's own agenda link, for the no-document and failed cases. */
  agendaUrl: string | null;
  /**
   * The meeting record's publisher observation, passed through. With
   * `agendaUrl` it separates an unmeasured gap from a measured one;
   * `observationFromMeetingRecord` refuses one without the other.
   */
  agendaSlotObservedEmpty?: boolean;
  provenance?: {
    sourceUrl: string | null;
    sourceOrg: string;
    collectedAt: string;
    secondHand?: boolean;
  };
  carried?: unknown;
}

/** Case-insensitive; the phrase boards actually print on notices. */
function hasPublicHearing(text: string): boolean {
  return /public hearing/i.test(text);
}

/** Decodes `&times;`-style literals in rows stored before the extractor decoded them. */
function sanitizeStoredText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&times;/gi, "×")
    .replace(/&amp;/g, "&");
}

export function AgendaSection(props: AgendaSectionProps) {
  // Keyed on the meeting so the previous one's records never flash.
  return <AgendaForMeeting key={props.meetingId} {...props} />;
}

function AgendaForMeeting({
  meetingId,
  bodyId,
  agendaUrl,
  agendaSlotObservedEmpty,
  provenance,
  carried,
}: AgendaSectionProps) {
  /* The same decider the meeting panel uses for a null `agendaUrl`. */
  const agendaState = agendaSentenceFor(
    { id: meetingId, agendaUrl, agendaSlotObservedEmpty, provenance, carried },
  );
  const [documents, setDocuments] = useState<AgendaDocumentView[] | null>(null);
  const [records, setRecords] = useState<MeetingReaderRecords | null>(null);
  const [publication, setPublication] = useState<AgendaPublicationReading | null>(null);
  const [holdingUnavailable, setHoldingUnavailable] = useState(false);
  const [unavailableAuthorities, setUnavailableAuthorities] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/agenda?meetingId=${encodeURIComponent(meetingId)}&bodyId=${encodeURIComponent(bodyId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as {
          documents: AgendaDocumentView[];
          records: MeetingReaderRecords;
          holdingStatus: string;
          publication: AgendaPublicationReading | null;
          supportingHoldingStatus?: "HELD" | "PARTIAL";
          unavailableAuthorities?: string[];
        };
        setDocuments(payload.documents);
        setRecords(payload.records);
        setPublication(payload.publication);
        setHoldingUnavailable(payload.holdingStatus === "HOLDING_UNAVAILABLE");
        setUnavailableAuthorities(payload.unavailableAuthorities ?? []);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [meetingId, bodyId]);

  if (failed) {
    return <>
      <CardGapContribution id={`meeting:${meetingId}:agenda-text`} label="agenda contents" />
      {agendaUrl && <p className="mt-1.5 t-detail"><CheckedLink href={agendaUrl} target="_blank" rel="noreferrer" className="text-signal hover:underline">Read the agenda</CheckedLink></p>}
    </>;
  }

  if (documents === null) {
    return null;
  }

  return <>
    {unavailableAuthorities.length > 0 && <CardGapContribution id={`meeting:${meetingId}:supporting-records`} label="supporting meeting records" />}
    <MinutesRecord meetingId={meetingId} />
    <MeetingRecords records={records} />
    {holdingUnavailable ? <>
      <CardGapContribution id={`meeting:${meetingId}:agenda-text`} label="agenda contents" />
      {agendaUrl && <p className="mt-1.5 t-detail"><CheckedLink className="text-signal underline" href={agendaUrl} target="_blank" rel="noreferrer">Read the source document</CheckedLink></p>}
    </> : <AgendaDocuments documents={documents} meetingId={meetingId} agendaUrl={agendaUrl} gapKind={agendaState.whose === "THEIRS" ? "not-posted" : "not-held"} publication={publication} />}
  </>;
}

function MinutesRecord({ meetingId }: { meetingId: string }) {
  const summary = minutesSummaryForMeeting(meetingId);
  if (!summary) return null;
  return <details className="mb-3 t-detail leading-relaxed" open data-minutes-summary={meetingId}>
    <summary className="cursor-pointer text-signal">What happened — plain language</summary>
    <p className="mt-2 font-semibold">{summary.summary}</p>
    <CardSourcesContribution id={`minutes:${meetingId}`} sources={[{ what: "Meeting minutes; plain-language paraphrase is ours", provenance: { sourceUrl: summary.minutesUrl, sourceOrg: summary.sourceOrg, collectedAt: summary.readAt, verifiedAt: null } }]} />
  </details>;
}

/**
 * One row per distinct content of the sitting's document, newest first; the
 * count is the rows rendered, never a fetch count. An earlier version read at
 * the same address is not linked, since that address now serves the newer one.
 */
export function AgendaDocuments(props: {
  documents: AgendaDocumentView[]; meetingId: string; agendaUrl: string | null; gapKind?: "not-posted" | "not-held";
  publication?: AgendaPublicationReading | null;
}) {
  const { documents, meetingId, publication } = props;
  return <><CardSourcesContribution id={`agenda-documents:${meetingId}`} sources={agendaDocumentSources(documents, publication)} /><AgendaDocumentContents {...props} /></>;
}

export function agendaDocumentSources(documents: readonly AgendaDocumentView[], publication?: AgendaPublicationReading | null): CardSource[] {
  const indexPages = publication?.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX";
  return documents.map((document, index) => ({
    what: `${indexPages ? index === 0 ? "Current listing page" : "another listing page" : index === 0 ? "Current agenda document" : "earlier version read"}${index === 0 && documents.length > 1 && !indexPages ? ` · ${documents.length} ${publication?.revised !== false ? "versions on file — a revised agenda is itself news" : "documents on file"}` : ""}${document.extractionNote ? ` · ${document.extractionNote}` : ""}`,
    dataAttrs: indexPages ? { "data-agenda-listing-page": document.id ?? document.documentUrl } : { "data-agenda-version": document.id ?? document.contentHash, ...(index === 0 && documents.length > 1 ? { "data-agenda-versions": documents.length } : {}) },
    provenance: { sourceUrl: index > 0 && documents.slice(0,index).some(prior => prior.documentUrl === document.documentUrl) ? "" : document.documentUrl, sourceOrg: document.sourceOrg, collectedAt: document.retrievedAt, verifiedAt: null },
  }));
}

function AgendaDocumentContents({ documents, meetingId, agendaUrl, gapKind, publication }: {
  documents: AgendaDocumentView[]; meetingId: string; agendaUrl: string | null; gapKind?: "not-posted" | "not-held";
  publication?: AgendaPublicationReading | null;
}) {
  const latest = documents[0] ?? null;

  if (latest && publication?.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX") {
    // Only publication-index pages are held: shown as listing pages, never versions.
    return <div data-agenda-publication="ACQUIRED_IS_PUBLICATION_INDEX" className="mt-1.5 t-detail leading-relaxed text-muted">
      <CardGapContribution id={`meeting:${meetingId}:agenda`} label="agendas" count={1} unit="meeting" />
      <CheckedLink href={latest.documentUrl} target="_blank" rel="noreferrer" className="text-signal underline">{publication.documentSharedAcrossGovernments ? "Inspect the stored link" : "Open the publisher's agenda portal"}</CheckedLink>
    </div>;
  }

  if (!latest) return <>
    <CardGapContribution id={`meeting:${meetingId}:${agendaUrl ? "agenda-text" : "agenda"}`} label={agendaUrl ? "agenda contents" : "agendas"} count={1} unit="meeting" kind={gapKind} />
    {agendaUrl && <p className="mt-1.5 t-detail"><CheckedLink href={agendaUrl} target="_blank" rel="noreferrer" className="text-link underline">Read the agenda</CheckedLink></p>}
  </>;

  if (!latest.text || publication?.acquisition === "ACQUIRED_NOT_READABLE") return <p data-agenda-publication="ACQUIRED_NOT_READABLE" className="mt-1.5 t-detail text-muted">
    <CardGapContribution id={`meeting:${meetingId}:agenda-text`} label="agenda contents" />
    <CheckedLink href={latest.documentUrl} target="_blank" rel="noreferrer" className="text-link underline">Open the document</CheckedLink>
  </p>;

  const summary = noticeSummaryFor(meetingId, latest.contentHash);
  /*
   * The clerk's own numbered lines, verbatim, cut only at length; never a
   * summary. Extraction is best-effort, so an empty list renders nothing.
   */
  const items = agendaItems(sanitizeStoredText(latest.text));

  return (
    <div className="mt-1.5">
      {items.length > 0 && (
        <div className="mb-2">
          <p className="trailing-space-trimmed-15 font-mono t-caption uppercase tracking-[0.15em] text-muted">
            On the docket — the agenda&apos;s own items, in its words
          </p>
          <ol className="mt-1.5 space-y-1">
            {items.map((item) => (
              <li
                key={item}
                className="t-detail leading-relaxed text-paper-dim"
              >
                {item}
              </li>
            ))}
          </ol>
          <p className="mt-1 t-caption text-muted">
            Read straight off the document below — nothing here is
            summarised, and the full text is the record.
          </p>
        </div>
      )}
      {summary && (
        // Curated from this exact document version; never replaces the official text below.
        <div className="mb-2 rounded bg-[var(--surface,rgba(255,255,255,0.04))] p-3">
          <p className="trailing-space-trimmed-15 font-mono t-caption uppercase tracking-[0.15em] text-muted">
            Plain-language summary — read the official text below
          </p>
          <p className="mt-1.5 t-detail font-semibold leading-relaxed">
            {summary.summary}
          </p>
        </div>
      )}
      {hasPublicHearing(latest.text) && (
        // The meeting takes public input on something specific.
        <p className="mb-2 rounded border border-[var(--signal)] px-3 py-2 t-detail font-semibold text-signal">
          This meeting includes a public hearing — a set time when members of
          the public can speak on a listed item.
        </p>
      )}
      <p className="max-h-56 overflow-y-auto whitespace-pre-line rounded border border-[var(--panel-border)] p-3 t-detail leading-relaxed text-paper-dim">
        {sanitizeStoredText(latest.text)}
      </p>

    </div>
  );
}
