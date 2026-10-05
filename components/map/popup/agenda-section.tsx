"use client";

import { useEffect, useState } from "react";
import { agendaSentenceFor } from "@/lib/ask/agenda-sentence";
import type { AgendaPublicationReading } from "@/lib/ask/agenda-publication";

import { noticeSummaryFor } from "@/lib/meetings/notice-summary";
import { formatDateMDY } from "@/lib/map/format";
import { agendaItems } from "@/lib/routing/agenda-search";
import type { MeetingReaderRecords } from "@/lib/meetings/reader-records";
import { MeetingRecords } from "./meeting-records";
import { minutesSummaryForMeeting } from "@/lib/meetings/minutes-summaries";

/**
 * What the meeting is actually about (4c) — the stored notice/agenda text,
 * rendered on the meeting surface instead of merely linked from it.
 *
 * "School board meeting I may not care about — revising the instructional
 * time model I may very much care about." The documents are already fetched
 * and stored; this section puts their words in front of the reader:
 * public hearing items called out prominently, the document's own text
 * below, and an honest statement plus the link where extraction failed.
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
  /** The meeting's own agenda link, for the no-document and failed cases. */
  agendaUrl: string | null;
  /**
   * The meeting record's own publisher observation, passed straight through.
   *
   * SWEEP-01: this component took only `meetingId` and `agendaUrl`, so a null
   * link was the ONLY thing it could reason from — and it reasoned "the body
   * has not posted". These two fields are what let it tell an unmeasured gap
   * from a measured one, and they travel together because
   * `observationFromMeetingRecord` refuses an observation missing either.
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

/**
 * Stored rows extracted before the extractor learned numeric entities can
 * carry `&times;`-style literals — decode at render so a legacy row never
 * shows markup to a reader. (The extractor itself now decodes; this covers
 * documents whose bytes haven't changed since.)
 */
function sanitizeStoredText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&times;/gi, "×")
    .replace(/&amp;/g, "&");
}

export function AgendaSection(props: AgendaSectionProps) {
  // A different meeting owns different network state. Never flash the previous
  // body's agenda or vote records while the next exact identity is loading.
  return <AgendaForMeeting key={props.meetingId} {...props} />;
}

function AgendaForMeeting({
  meetingId,
  agendaUrl,
  agendaSlotObservedEmpty,
  provenance,
  carried,
}: AgendaSectionProps) {
  /*
   * SWEEP-01 (2026-08-31): the same decider the meeting panel uses. Two
   * components independently deciding what `agendaUrl === null` means is how
   * one of them came to say a clerk had not posted a packet on the strength of
   * our own empty record.
   */
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
          `/api/agenda?meetingId=${encodeURIComponent(meetingId)}`,
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
  }, [meetingId]);

  if (failed) {
    // Couldn't check ≠ none — the standing rule, here too.
    return (
      <p className="mt-1.5 t-detail leading-relaxed text-muted">
        Couldn&apos;t check for the agenda just now.
        {agendaUrl && (
          <>
            {" "}
            <a
              href={agendaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-signal hover:underline"
            >
              Read it at the source
            </a>
            .
          </>
        )}
      </p>
    );
  }

  if (documents === null) {
    return (
      <p className="mt-1.5 t-detail leading-relaxed text-muted">
        Looking for the agenda…
      </p>
    );
  }

  return <>
    {unavailableAuthorities.length > 0 && <p className="mb-2 t-caption leading-relaxed text-muted" data-agenda-supporting-holding="PARTIAL">
      The meeting and agenda remain available, but these supporting records could not be checked: {unavailableAuthorities.join(", ")}.
    </p>}
    <MinutesRecord meetingId={meetingId} />
    <MeetingRecords records={records} />
    {holdingUnavailable ? <p className="mt-1.5 t-detail text-muted">The stored document is unavailable here.{agendaUrl && <> <a className="text-signal underline" href={agendaUrl} target="_blank" rel="noreferrer">Read the source document</a>.</>}</p>
      : <AgendaDocuments documents={documents} meetingId={meetingId} agendaUrl={agendaUrl} agendaSentence={agendaState.sentence} publication={publication} />}
  </>;
}

function MinutesRecord({ meetingId }: { meetingId: string }) {
  const summary = minutesSummaryForMeeting(meetingId);
  if (!summary) return null;
  return <details className="mb-3 t-detail leading-relaxed" open data-minutes-summary={meetingId}>
    <summary className="cursor-pointer text-signal">What happened — plain language</summary>
    <p className="mt-2 font-semibold">{summary.summary}</p>
    <p className="mt-1 text-muted">Our paraphrase of <a href={summary.minutesUrl} target="_blank" rel="noreferrer" className="text-signal underline">the {summary.sourceOrg} minutes</a> · read {formatDateMDY(summary.readAt)}.</p>
  </details>;
}

/**
 * **THE VERSIONS LINE STATES THE ROWS IT RENDERS.** (2026-09-22.)
 *
 * `documents` is `/api/agenda`'s reader projection: one row per DISTINCT
 * content of the sitting's own document, newest first. It used to be every
 * stored fetch, and the card told readers Tucson Unified sitting 499 had "89
 * versions on file — a revised agenda is itself news" when its page had never
 * changed. So the count is the length of the list below it, each version is a
 * rendered row, and the revision wording needs two or more distinct contents
 * that the publication reading also calls revised — never a fetch count.
 *
 * An earlier version read at the SAME address is not linked: that address now
 * serves the newer content, and a link would hand the reader the wrong
 * version. Every distinct address is linked exactly where its version is.
 */
function VersionsOnFile({ documents, publication }: {
  documents: readonly AgendaDocumentView[]; publication?: AgendaPublicationReading | null;
}) {
  if (documents.length < 2) return null;
  const latestUrl = documents[0].documentUrl;
  const linked = new Set([latestUrl]);
  const revised = publication?.revised !== false;
  return <span data-agenda-versions={documents.length}>
    {revised
      ? ` · ${documents.length} versions on file — a revised agenda is itself news: `
      : ` · ${documents.length} documents on file: `}
    {documents.map((document, index) => {
      const label = `${index === 0 ? "current" : "earlier"} version read ${formatDateMDY(document.retrievedAt.slice(0, 10))}`;
      const link = !linked.has(document.documentUrl);
      if (link) linked.add(document.documentUrl);
      return <span key={document.id ?? `${document.contentHash}:${document.retrievedAt}`} data-agenda-version={document.id ?? document.contentHash}>
        {index > 0 && ", "}
        {link
          ? <a href={document.documentUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-signal">{label}</a>
          : label}
      </span>;
    })}
  </span>;
}

export function AgendaDocuments({ documents, meetingId, agendaUrl, agendaSentence, publication }: {
  documents: AgendaDocumentView[]; meetingId: string; agendaUrl: string | null; agendaSentence: string;
  publication?: AgendaPublicationReading | null;
}) {
  const latest = documents[0] ?? null;

  if (latest && publication?.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX") {
    // Only publication-index pages are held for this sitting. They are shown
    // for what they are — listing pages, never versions of its agenda — and a
    // second distinct listing page is linked rather than counted as a revision.
    const otherListingPages = documents.filter((document, index, all) =>
      document.documentUrl !== latest.documentUrl &&
      all.findIndex((candidate) => candidate.documentUrl === document.documentUrl) === index);
    return <div data-agenda-publication="ACQUIRED_IS_PUBLICATION_INDEX" className="mt-1.5 t-detail leading-relaxed text-muted">
      <p>{publication.gap?.statement} <a href={latest.documentUrl} target="_blank" rel="noreferrer" className="text-signal underline">{publication.documentSharedAcrossGovernments ? "Inspect the stored link" : "Open the publisher's agenda portal"}</a>.</p>
      <p className="mt-1 t-caption">{publication.documentSharedAcrossGovernments ? "Unresolved source link" : `From ${latest.sourceOrg}`} · read {formatDateMDY(latest.retrievedAt.slice(0, 10))}.
        {otherListingPages.map((document) => <span key={document.documentUrl} data-agenda-listing-page={document.id ?? document.documentUrl}>
          {" "}Also held: <a href={document.documentUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-signal">another listing page, read {formatDateMDY(document.retrievedAt.slice(0, 10))}</a>.
        </span>)}
      </p>
    </div>;
  }

  if (!latest) {
    return (
      <p className="mt-1.5 t-detail leading-relaxed text-muted">
        {agendaUrl ? (
          <>
            We haven&apos;t stored this agenda&apos;s text yet —{" "}
            <a
              href={agendaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-signal hover:underline"
            >
              read it at the source
            </a>
            .
          </>
        ) : (
          `${agendaSentence}.`
        )}
      </p>
    );
  }

  if (!latest.text || publication?.acquisition === "ACQUIRED_NOT_READABLE") {
    return (
      <p data-agenda-publication="ACQUIRED_NOT_READABLE" className="mt-1.5 t-detail leading-relaxed text-muted">
        We fetched this meeting&apos;s document but couldn&apos;t read its
        {/*
          **A REASON WE DO NOT HOLD IS NOT "extraction failed"**
          (2026-08-23, item 3). The branch is already inside "we could not
          read it", so restating that as the REASON says nothing while
          looking like an explanation. Where no note was recorded, the gap is
          named as ours.
        */}
        text ({latest.extractionNote ?? (latest.text ? "the stored extraction contains document bytes rather than readable text" : "we haven't recorded why")}).{" "}
        <a
          href={latest.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="text-signal hover:underline"
        >
          Open the document
        </a>
        . From {latest.sourceOrg} · read {formatDateMDY(latest.retrievedAt.slice(0, 10))}
        <VersionsOnFile documents={documents} publication={publication} />.
      </p>
    );
  }

  const summary = noticeSummaryFor(meetingId, latest.contentHash);
  /*
   * A05's reader-facing surface (2026-08-19, g20) — the row's remainder,
   * and the last thing between it and Done.
   *
   * g19 built the extraction and `POST /api/ask/agenda` in meeting mode and
   * said plainly that nothing rendered it. This is where it renders: on the
   * meeting card, above the document's own text, beside the raw link the
   * row requires it to sit beside and never replace.
   *
   * It calls `agendaItems` DIRECTLY rather than posting to the route. Same
   * function, so the two can never disagree about what an item is — and it
   * is one fewer request for a reader who already has the text on screen,
   * which the friction rule makes the default rather than the optimisation.
   *
   * NOT A SUMMARY. These are the clerk's own numbered and lettered lines,
   * verbatim, cut only at length. The row's word is "summarized" and this
   * deliberately is not one: a summary of an agenda is a claim about what a
   * government is about to do, made by us.
   *
   * An empty list renders NOTHING — never "no items". The extraction is
   * best-effort against collapsed PDF text (see A05's note: adjacent items
   * merge where neither ends in a sentence mark), and the full document is
   * directly below, so silence here costs the reader nothing while a "none"
   * would be our parser's failure wearing the agenda's clothes.
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
        // Curated from this exact document version (4d): labeled, above,
        // never replacing the official text below.
        <div className="mb-2 rounded bg-[var(--surface,rgba(255,255,255,0.04))] p-3">
          <p className="trailing-space-trimmed-15 font-mono t-caption uppercase tracking-[0.15em] text-muted">
            Plain-language summary — read the official text below
          </p>
          {/* 3b: the product's voice renders BOLD. */}
          <p className="mt-1.5 t-detail font-semibold leading-relaxed">
            {summary.summary}
          </p>
        </div>
      )}
      {hasPublicHearing(latest.text) && (
        // The thing a reader most needs called out: the meeting takes
        // public input on something specific.
        <p className="mb-2 rounded border border-[var(--signal)] px-3 py-2 t-detail font-semibold text-signal">
          This meeting includes a public hearing — a set time when members of
          the public can speak on a listed item.
        </p>
      )}
      <p className="max-h-56 overflow-y-auto whitespace-pre-line rounded border border-[var(--panel-border)] p-3 t-detail leading-relaxed text-paper-dim">
        {sanitizeStoredText(latest.text)}
      </p>
      <p className="mt-1 t-caption text-muted">
        From{" "}
        <a
          href={latest.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-signal"
        >
          the {latest.sourceOrg} document
        </a>{" "}
        · read {formatDateMDY(latest.retrievedAt.slice(0, 10))}
        <VersionsOnFile documents={documents} publication={publication} />
      </p>
    </div>
  );
}
