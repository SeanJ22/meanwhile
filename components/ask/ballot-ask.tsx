"use client";

import { useRef, useState } from "react";

import { hostOf } from "@/lib/ask/host";
import { readBrowserKey } from "@/lib/state/browser-key";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import type { AskSubjectRef } from "@/lib/ask/subject";

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

interface GroundedRecord {
  kind: string;
  id: string;
  text: string;
  sourceUrl?: string | null;
  sourceOrg?: string | null;
}

interface GroundedGap {
  whose: "OURS" | "THEIRS";
  statement: string;
}

interface GroundedContact {
  id: string;
  name: string;
  officeTitle: string;
  relationship: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  sourceOrg: string | null;
}

interface GroundedReply {
  mode: string;
  subject?: { kind: string; id: string; name: string; office?: string | null } | null;
  answer?: string | null;
  records?: GroundedRecord[];
  gaps?: GroundedGap[];
  contacts?: GroundedContact[];
  mention?: string;
  candidates?: string[];
}

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

  async function ask() {
    const question = text.trim();
    if (!question || working) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setWorking(true);
    setFailed(false);
    try {
      const res = await fetch("/api/ask/grounded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ocdIds,
          approximateLocation: zip,
          surface: "BALLOT",
          activeSubjects,
          priorSubjects,
          priorTurns,
          /* WHAT THE READER DID, never what it proves — `stampResidency` on
             the server decides that, so no client can assert a confidence. */
          locationOrigin: readLocationOriginFor(zip),
          /* READ, never minted — the capture path is gated, and putting a new
             identifier on a device for a switched-off capability is storage
             nobody consented to. Its OWN slot for the day it is switched on:
             sharing one with reactions or Speak Your Mind would make one browser
             produce one value across stores that share no key. */
          continuityKey: readBrowserKey("wtp.ask_key") ?? "",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setFailed(true);
        setReply(null);
        return;
      }
      const body = (await res.json()) as GroundedReply;
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
  const gaps = reply?.gaps ?? [];
  const sources = records.filter((r) => r.sourceUrl);

  return (
    <section className="mt-8 rounded-lg border border-[var(--line)] p-4" data-ballot-ask>
      <h2 className="text-base font-semibold">Ask about this ballot</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Questions are answered from records this site holds, with the source shown.
      </p>

      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="ballot-ask-input">
          Ask a question about this ballot
        </label>
        <input
          id="ballot-ask-input"
          data-ask-input
          className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          placeholder="What does this office control?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <button
          type="button"
          data-ask-submit
          className="rounded border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          onClick={ask}
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
        <p className="mt-3 text-sm" data-ask-state="TRANSPORT_FAILED">
          That didn&rsquo;t reach us. Try again in a moment.
        </p>
      )}

      {reply && (
        <div className="mt-4 text-sm" data-ask-mode={reply.mode} data-ask-question={answered}>
          {/* A named government that fits more than one thing: ASKED, never chosen. */}
          {reply.mode === "CLARIFY" && (
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
            <p>We don&rsquo;t have anything recorded under &ldquo;{reply.mention}&rdquo;.</p>
          )}

          {reply.subject && (
            <p className="font-medium">
              {reply.subject.name}
              {reply.subject.office ? (
                <span className="font-normal text-[var(--muted)]">
                  {" "}
                  · {reply.subject.office}
                </span>
              ) : null}
            </p>
          )}

          {/* The grounded sentence, when there is one that passed validation. */}
          {reply.answer && <p className="mt-2">{reply.answer}</p>}

          {/*
            THE RECORDS RENDER WHETHER OR NOT PROSE DID. This is the structured
            half of the degradation ladder: grounded → structured → honest gap.
            A reply whose synthesis was unavailable or was REJECTED still
            carries everything needed to answer truthfully, and throwing it away
            because `answer` is null is the exact defect class this guards.
          */}
          {!reply.answer && records.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {records
                /* Contacts render in their own block below with the
                   relationship spelled out; listing them here as well would
                   print every board member twice. */
                .filter((r) => r.kind !== "CONTACT")
                .slice(0, 8)
                .map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
            </ul>
          )}

          {/* Named gaps, each one saying whose gap it is. */}
          {gaps.map((g) => (
            <p key={g.statement} className="mt-2 text-[var(--muted)]" data-gap={g.whose}>
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
              <p data-ask-state="NOTHING_HELD">
                {reply.subject
                  ? `We hold ${reply.subject.name}, but nothing recorded that answers that.`
                  : "We have not recorded anything that answers that yet. Naming a government — a school district, a county board, a person on this ballot — is what this can answer from."}
              </p>
            )}

          {/*
            **THE CONTACTS, AND WHY EACH ONE IS HERE.**

            Not a ranking and not "who to call" — this product may not order
            people by influence. Each line states the sourced RELATIONSHIP
            between that person and what the reader asked about, and stops.
          */}
          {(reply.contacts?.length ?? 0) > 0 && (
            <div className="mt-3" data-ask-contacts={reply.contacts?.length}>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Who this is
              </p>
              <ul className="mt-1 space-y-0.5">
                {(reply.contacts ?? []).map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.name}</span> — {c.relationship}
                    {c.email ? (
                      <>
                        {" · "}
                        <a className="underline" href={`mailto:${c.email}`}>
                          {c.email}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sources.length > 0 && (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Source
              {sources.length > 1 ? "s" : ""}:{" "}
              {[...new Map(sources.map((r) => [r.sourceUrl, r])).values()].map((r, i) => (
                <span key={r.sourceUrl}>
                  {i > 0 ? ", " : ""}
                  <a
                    className="underline"
                    href={r.sourceUrl ?? undefined}
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
                    {r.sourceOrg ?? hostOf(r.sourceUrl)}
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
