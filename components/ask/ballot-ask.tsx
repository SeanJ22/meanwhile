"use client";

import { WorkingOnIt } from "@/components/demand/working-on-it";
import { AskBodyConfirmation } from "./body-confirmation";
import type { BodyConfirmation } from "@/lib/ask/body-confirmation";

import { useEffect, useRef, useState } from "react";

import { AskAnswerRecords } from "@/components/ask/answer-records";
import { AskAnswerContacts } from "./answer-contacts";
import { readAskAnswer, unresolvedReadLine, type AskAnswerPayload } from "@/lib/ask/answer";
import { sourceLinks } from "@/lib/ask/host";
import { getOrCreateBrowserKey } from "@/lib/state/browser-key";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import type { AskSubjectRef } from "@/lib/ask/subject";
import { gapsNotInAnswer } from "@/lib/text/say-once";

/**
 * Ask on the ballot page. Uses the same `/api/ask/grounded` engine as the map
 * Ask; this surface only contributes the reader's divisions, zip and the
 * contests, candidates and measures on the page as canonical references.
 * Records and gaps render whenever present, even when `answer` is null.
 */

type GroundedReply = AskAnswerPayload;

export function BallotAsk({
  zip,
  ocdIds,
  activeSubjects,
}: {
  zip: string | null;
  ocdIds: string[];
  /**
   * The contests, candidates and measures on this page, with CANONICAL IDS,
   * for referent resolution and for retrieval. See `lib/ask/subject.ts`.
   */
  activeSubjects: AskSubjectRef[];
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<GroundedReply | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  /* The question that produced the reply on screen. */
  const [answered, setAnswered] = useState("");
  /* Follow-up context: the last few resolved subjects, in memory for this mount only. */
  const [priorSubjects, setPriorSubjects] = useState<AskSubjectRef[]>([]);
  const [priorTurns, setPriorTurns] = useState<
    { question: string; resolvedSubject: string | null }[]
  >([]);
  const inFlight = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  async function ask(confirmation?: BodyConfirmation) {
    const question = confirmation?.question ?? text.trim();
    if (!question || working) return;
    if (confirmation) setText(question);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setWorking(true);
    setFailed(false);
    setReply(null);
    setAnswered("");
    try {
      const res = await fetch("/api/ask/grounded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          confirmation,
          ocdIds,
          approximateLocation: zip,
          surface: "BALLOT",
          activeSubjects,
          priorSubjects,
          priorTurns,
          /* What the reader did; the server decides the confidence. */
          locationOrigin: readLocationOriginFor(zip),
          /* Anonymous per-browser key in its own storage slot. */
          continuityKey: getOrCreateBrowserKey("wtp.ask_key"),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setFailed(true);
        setReply(null);
        return;
      }
      const body = readAskAnswer(await res.json());
      if (!body) { setFailed(true); return; }
      setReply(body);
      setAnswered(question);
      /* Only a canonical resolution becomes a referent for later turns. */
      if (body.subject) {
        const resolved = body.subject;
        setPriorSubjects((prior) =>
          [...prior, { id: resolved.id, name: resolved.name }].slice(-4),
        );
        setPriorTurns((prior) =>
          [...prior, { question, resolvedSubject: resolved.name }].slice(-4),
        );
      } else {
        setPriorTurns((prior) => [...prior, { question, resolvedSubject: null }].slice(-4));
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      setFailed(true);
      setReply(null);
    } finally {
      if (inFlight.current === controller) setWorking(false);
    }
  }

  const records = reply?.records ?? [];
  // A gap the answer's own sentence already states is not printed a second time.
  const gaps = gapsNotInAnswer(reply?.answer, reply?.gaps ?? []);
  const sources = records.filter((r) => r.sourceUrl);

  return (
    <section className="mt-2 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4" data-ballot-ask>
      <h2 className="t-heading font-semibold">Ask about this ballot</h2>
      <p className="mt-1 t-body text-[var(--text-muted)]">
        Questions are answered from records this site holds, with the source shown.
      </p>

      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="ballot-ask-input">
          Ask a question about this ballot
        </label>
        <input
          ref={input}
          id="ballot-ask-input"
          data-ask-input
          className="min-w-0 flex-1 rounded-[10px] border border-[var(--panel-border)] bg-transparent px-3 py-2 t-body"
          placeholder="What does this office control?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              ask();
              return;
            }
            /*
             * The first Escape on a non-empty field clears it and stops
             * propagation so the panel stays open; an empty field lets it
             * through to close the panel. Either way an in-flight request aborts.
             */
            if (e.key === "Escape" && text.length > 0) {
              e.stopPropagation();
              inFlight.current?.abort();
              setText("");
              setReply(null);
              setAnswered("");
              setWorking(false);
            }
          }}
        />
        <button
          type="button"
          data-ask-submit
          className="rounded-[10px] border border-[var(--panel-border)] px-3 py-2 t-body disabled:opacity-50"
          onClick={() => ask()}
          disabled={working || text.trim().length === 0}
        >
          {working ? "Looking…" : "Ask"}
        </button>
      </div>

      {failed && (
        <p className="mt-3 t-body" data-ask-state="TRANSPORT_FAILED">
          That didn&rsquo;t reach us. Try again in a moment.
        </p>
      )}

      {reply && (
        <div className="mt-4 t-body" data-ask-mode={reply.mode} data-ask-question={answered}>
          {/* A named government that fits more than one thing: ASKED, never chosen. */}
          <AskBodyConfirmation answer={reply} working={working} onConfirm={ask} onClarify={() => {
            setReply(null);
            document.getElementById("ballot-ask-input")?.focus();
          }} />
          {reply.mode === "CLARIFY" && !reply.confirmation && !reply.clarification && (
            <p>
              More than one government here matches &ldquo;{reply.mention}&rdquo;
              {reply.candidates?.length ? `: ${reply.candidates.join(", ")}.` : "."} Which did you
              mean?
            </p>
          )}

          {reply.mode === "UNRESOLVED" && (
            <p>{unresolvedReadLine(reply)}</p>
          )}

          {reply.subject && (
            <p className="font-medium">
              {reply.subject.name}
              {reply.subject.office ? (
                <span className="font-normal text-[var(--text-muted)]">
                  {" "}
                  · {reply.subject.office}
                </span>
              ) : null}
            </p>
          )}

          {/* The grounded sentence, when there is one that passed validation. */}
          {reply.answer && !reply.agendaLead && <p className="mt-2">{reply.answer}</p>}

          {/* Records render whether or not prose did. */}
          <AskAnswerRecords records={records} initiallyOpen={!reply.answer} agendaLead={reply.agendaLead} prose={reply.agendaLead ? reply.answer : null} />

          {/* Named gaps, each one saying whose gap it is. */}
          {gaps.map((g) => (
            <p key={g.statement} className="mt-2 text-[var(--text-muted)]" data-gap={g.whose}>
              {g.statement}
            </p>
          ))}

          {/* No branch may render silence. */}
          {!reply.answer &&
            records.length === 0 &&
            gaps.length === 0 &&
            reply.mode !== "CLARIFY" &&
            reply.mode !== "UNRESOLVED" && (
              <WorkingOnIt
                attrs={{ "data-ask-state": "NOTHING_HELD" }}
                about={reply.subject?.name}
                subject={reply.subject?.kind === "BODY" ? { type: "BODY", id: reply.subject.id } : null}
              />
            )}

          <AskAnswerContacts contacts={reply.contacts ?? []} />

          {sources.length > 0 && (
            <p className="mt-3 t-detail text-[var(--text-muted)]">
              {/* One line per publisher, not per document. */}
              Source
              {sourceLinks(sources).length > 1 ? "s" : ""}:{" "}
              {sourceLinks(sources).map((l, i) => (
                <span key={l.label}>
                  {i > 0 ? ", " : ""}
                  <a
                    className="underline"
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* A null publisher renders as the URL's host. */}
                    {l.label}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
