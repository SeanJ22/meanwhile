"use client";

import { useEffect, useState } from "react";

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
  documentUrl: string;
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
}

/** Case-insensitive; the phrase boards actually print on notices. */
function hasPublicHearing(text: string): boolean {
  return /public hearing/i.test(text);
}

export function AgendaSection({ meetingId, agendaUrl }: AgendaSectionProps) {
  const [documents, setDocuments] = useState<AgendaDocumentView[] | null>(null);
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
        };
        setDocuments(payload.documents);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [meetingId]);

  if (failed) {
    // Couldn't check ≠ none — the standing rule, here too.
    return (
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
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
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
        Looking for the agenda…
      </p>
    );
  }

  const latest = documents[0] ?? null;

  if (!latest) {
    return (
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
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
          "No agenda posted yet."
        )}
      </p>
    );
  }

  if (!latest.text) {
    return (
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
        We fetched this meeting&apos;s document but couldn&apos;t read its
        text ({latest.extractionNote ?? "extraction failed"}).{" "}
        <a
          href={latest.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="text-signal hover:underline"
        >
          Open the document
        </a>
        .
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      {hasPublicHearing(latest.text) && (
        // The thing a reader most needs called out: the meeting takes
        // public input on something specific.
        <p className="mb-2 rounded border border-[var(--signal)] px-3 py-2 text-[0.75rem] font-semibold text-signal">
          This meeting includes a public hearing — a set time when members of
          the public can speak on a listed item.
        </p>
      )}
      <p className="max-h-56 overflow-y-auto whitespace-pre-line rounded border border-[var(--panel-border)] p-3 text-[0.75rem] leading-relaxed text-paper-dim">
        {latest.text}
      </p>
      <p className="mt-1 text-[0.625rem] text-muted">
        From{" "}
        <a
          href={latest.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-signal"
        >
          the {latest.sourceOrg} document
        </a>{" "}
        · read {latest.retrievedAt.slice(0, 10)}
        {documents.length > 1 &&
          ` · ${documents.length} versions on file — a revised agenda is itself news`}
      </p>
    </div>
  );
}
