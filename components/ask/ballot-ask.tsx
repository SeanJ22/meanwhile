"use client";

import { WorkingOnIt } from "@/components/demand/working-on-it";
import { AskBodyConfirmation } from "./body-confirmation";
import type { BodyConfirmation } from "@/lib/ask/body-confirmation";

import { useRef, useState } from "react";

import { AskAnswerRecords } from "@/components/ask/answer-records";
import { AskAnswerContacts } from "./answer-contacts";
import { readAskAnswer, unresolvedReadLine, type AskAnswerPayload } from "@/lib/ask/answer";
import { sourceLinks } from "@/lib/ask/host";
import { getOrCreateBrowserKey } from "@/lib/state/browser-key";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import type { AskSubjectRef } from "@/lib/ask/subject";
import { gapsNotInAnswer } from "@/lib/text/say-once";

/**
 * **ASK ON THE BALLOT — the same engine, a different surface.**
 * (ASK04, 2026-08-27.)
 *
 * ## Why this is not `<AskBox>`
 *
 * There is ONE Ask engine and this component uses it: `/api/ask/grounded`,
 * which holds interpretation, canonical resolution, retrieval, the evidence
 * pack, synthesis and validation. Nothing about answering a question lives
 * here.
 *
 * What could not be reused is the map panel's CHROME. `components/ask/ask-box.tsx`
 * reads `useShellData()` — the meetings cascade, the venue list, the drawn
 * districts, the stored location — and `useUi()`, both provided only inside
 * `map-entry.tsx`. Mounting it on the ballot would mean either standing the
 * whole map shell up behind a page that has no map, or threading a second
 * data pipeline through a 1,673-line component. Neither is "one engine"; both
 * are one WIDGET, forced.
 *
 * So the split is: the ENGINE is shared and the SURFACE is thin. A ballot
 * question and a map question reach the identical pipeline, resolve against
 * the identical registry, and are validated by the identical rules. What
 * differs is the context each surface can honestly contribute — and the
 * ballot's context is genuinely different, which is the point of A10.
 *
 * ## What this surface contributes
 *
 * The reader's divisions, their zip, and the contests, candidates and measures
 * actually on the page — **as canonical references, with ids** (PR #212
 * follow-up, 2026-08-28). They used to travel as display strings, which meant
 * they reached the interpretation model as prose and the BINDER never saw them:
 * nothing on this page was an entity Ask could resolve, and retrieval had no id
 * to select on.
 *
 * That is what makes *"what has she done?"* answerable here and correctly
 * REFUSED where more than one person could be meant. The referent is not
 * decided by the model — Claude may propose one, and `lib/ask/resolve.ts`
 * binds it against these references or asks. Where two people fit, it asks.
 *
 * ## What it will not do
 *
 * It renders `answer` when the server says the answer was grounded and
 * validated, and it renders the records and named gaps in every other case.
 * **It never discards a useful reply because one optional field is null** —
 * that exact class of defect was found repeatedly in the previous session's
 * client handling, and it is the reason `records` and `gaps` travel on every
 * response shape this route returns.
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
  /* The question that produced the reply on screen, so the heading cannot
     drift out of step with the answer under it while a new one is in flight. */
  const [answered, setAnswered] = useState("");
  /*
   * **THE BOUNDED FOLLOW-UP, and bounded is the operative word.** What makes
   * a follow-up answerable is knowing what the previous turn resolved to. What
   * would make it a privacy problem is keeping a person's political
   * conversation. This holds the last few turns, in memory, for this mount
   * only — it does not persist and leaving the page ends it.
   */
  const [priorSubjects, setPriorSubjects] = useState<AskSubjectRef[]>([]);
  const [priorTurns, setPriorTurns] = useState<
    { question: string; resolvedSubject: string | null }[]
  >([]);
  const inFlight = useRef<AbortController | null>(null);

  async function ask(confirmation?: BodyConfirmation) {
    const question = confirmation?.question ?? text.trim();
    if (!question || working) return;
    if (confirmation) setText(question);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setWorking(true);
    setFailed(false);
    /*
     * **THE PREVIOUS ANSWER GOES WHEN A NEW QUESTION STARTS.**
     * (Found 2026-08-28 by reading the panel rather than the DOM.)
     *
     * This component already kept `answered` so the heading could not drift
     * out of step with the answer under it — and the answer itself stayed on
     * screen anyway. A reader who asked about Proposition 423 and then asked
     * who is running for Governor sat looking at the Proposition 423 answer
     * with a "Looking…" button beside it, which reads as the product answering
     * the new question with the old subject. That is the substitution defect
     * made out of latency instead of out of routing.
     *
     * Clearing is not discarding a useful reply: it is declining to show an
     * answer to a question the reader has moved on from.
     */
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
          /* WHAT THE READER DID, never what it proves — `stampResidency` on
             the server decides that, so no client can assert a confidence. */
          locationOrigin: readLocationOriginFor(zip),
          /* The returning-reader ID: random, minted on this browser's first
             question, anonymous, and in its OWN slot (sharing one with
             reactions or Speak Your Mind would make one browser produce one
             value across stores that share no key). */
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
      /* The conversation advances only on a CANONICAL resolution: a turn that
         resolved nothing offers no referent, and recording it would let a later
         pronoun point at a question rather than at a person. */
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

  /*
   * Every branch below renders SOMETHING TRUE. There is no branch that renders
   * a generic civics sentence, and none that renders an answer about a
   * government other than the one that resolved.
   */
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
             * **ESCAPE, WHICH THIS HANDLED NOWHERE** (BAL-26, 2026-08-28).
             *
             * Only Enter was handled. On the old placement — a permanently
             * open panel at the foot of the page — nothing was listening for
             * Escape and nothing needed to be. In the pill row it does: the
             * panel is dismissable now, and the map's Ask panel has handled
             * Escape since it shipped.
             *
             * The nested form, deliberately. A half-typed question is what
             * the reader most likely wants Escape to take back, so the first
             * press clears the field and STOPS — `stopPropagation` keeps it
             * from reaching the document listener in
             * `components/ballot/ballot-ask-pill.tsx`, so the panel stays
             * open and the cursor stays where it was. With the field already
             * empty the press falls through and the panel closes.
             *
             * It also aborts a request in flight, for the same reason the new
             * question does: an answer arriving for a question the reader has
             * just abandoned is the substitution defect made out of latency.
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

      {/*
        A transport failure is a fact about US and says so. It is deliberately
        not "we found nothing", which would be a claim about a government made
        out of a failed request.
      */}
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

          {/*
            Named, and we hold no such thing. Said — never quietly swapped.

            **The word is "anything", not "a government".** The first version
            said "a government", and the first thing it was asked on this
            surface was about a person: a reader was told *"We don't have a
            government recorded under 'Katie Hobbs'"*, which is wrong about the
            kind of thing she is as well as wrong about whether we hold her.
            The binding rung resolves bodies, people and measures alike, so the
            sentence may not name one of the three.
          */}
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

          {/*
            THE RECORDS RENDER WHETHER OR NOT PROSE DID. This is the structured
            half of the degradation ladder: grounded → structured → honest gap.
            A reply whose synthesis was unavailable or was REJECTED still
            carries everything needed to answer truthfully, and throwing it away
            because `answer` is null is the exact defect class this guards.
          */}
          <AskAnswerRecords records={records} initiallyOpen={!reply.answer} agendaLead={reply.agendaLead} prose={reply.agendaLead ? reply.answer : null} />

          {/* Named gaps, each one saying whose gap it is. */}
          {gaps.map((g) => (
            <p key={g.statement} className="mt-2 text-[var(--text-muted)]" data-gap={g.whose}>
              {g.statement}
            </p>
          ))}

          {/*
            **NO BRANCH MAY RENDER SILENCE.** (Found 2026-08-27 by reading the
            reader output rather than the DOM.)

            The first version of this component had no such branch, and a reply
            of NO_EVIDENCE with no subject, no records and no gaps rendered
            NOTHING: the reader typed a question, the server answered, and the
            panel showed them the empty form back. Every earlier check passed —
            the panel was present, the mode attribute was correct, the request
            and the reply were both fine. The defect was only visible in the
            sentence, which is the whole lesson of the previous session.

            The wording is the constitution's shape: the ATTRIBUTION is required
            and the verdict on ourselves is struck. "We have not recorded this"
            is a fact about us; "we failed" is a verdict, and RULING 139 strikes
            it. Then it offers the narrowing and stops.
          */}
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

          {/*
            **THE CONTACTS, AND WHY EACH ONE IS HERE.**

            Not a ranking and not "who to call" — this product may not order
            people by influence. Each line states the sourced RELATIONSHIP
            between that person and what the reader asked about, and stops.
          */}
          <AskAnswerContacts contacts={reply.contacts ?? []} />

          {sources.length > 0 && (
            <p className="mt-3 t-detail text-[var(--text-muted)]">
              {/* One line per PUBLISHER, not one per document — see
                  `sourceLinks`. Six documents from one office are one source. */}
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
                    {/*
                      **A NULL PUBLISHER RENDERS AS THE HOST, NOT AS A PHRASE.**
                      This read "the record" until the render-default sweep
                      caught it, and the sweep was right: a link whose publisher
                      we did not record, labelled "the record", reads as an
                      attributed source and is not one. The hostname is a
                      MECHANICAL READ of the URL we are already showing — a fact
                      about where the link goes, never a claim about who
                      published what is there.
                    */}
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
