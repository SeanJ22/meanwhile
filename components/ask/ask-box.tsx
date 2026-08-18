"use client";

import { useEffect, useId, useRef, useState } from "react";

import { answerQuestion, REFUSAL_LOG_MAX_CHARS, type AskAnswer } from "@/lib/routing/ask";
import { ROUTABLE_CATEGORIES } from "@/lib/routing/destinations";
import { ASK_BEAT_POOL, beatStem, drawAskBeat } from "@/lib/routing/ask-beat-pool";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { logEvent } from "@/lib/log/client";

/**
 * The ask box, v1 (session brief 5, 2026-08-19): routing without
 * generation. Free text goes through keyword matching into the curated
 * routing map — the answer names real bodies and sourced people with the
 * denominator stated, or refuses honestly (A07). NO LLM, NO generative
 * text: every rendered sentence is curated copy or registry data.
 *
 * The question is stored NOWHERE beyond the identifier-free search log's
 * rules: a routed ask logs its topic id only; a refusal logs the question
 * text (capped) because unanswered questions are the roadmap. No state
 * survives this component and nothing is written to device storage.
 * Disclosed on /transparency in the same commit (tests/ask-box.test.ts
 * pins the coupling).
 */

export function AskBox({
  coverage,
  zip,
  ocdIds,
}: {
  coverage: CoverageSummary;
  /** Orientation only, for the log — never district truth. */
  zip: string | null;
  /** The divisions in view, for the log row. */
  ocdIds: string[];
}) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<AskAnswer | null>(null);
  // The visible-work beat (the author's presentation call, session brief
  // 3). PRESENTATION ONLY — the routing below runs instantly and
  // deterministically on-device before the timer starts, and nothing new
  // is logged. The words come from the author's FIXED pool
  // (lib/routing/ask-beat-pool.ts, CLAUDE.md's register rule): playful,
  // acknowledgment register, and never a deliberation label — nothing a
  // reader sees here is generated, and a deliberation word would claim
  // otherwise. The prohibited list lives with the pool.
  const [working, setWorking] = useState(false);
  // Drawn per ask, in the browser, at click time — never during server
  // render, which would freeze one line into the HTML or mismatch on
  // hydration. Seeded with the first entry so the type is never null.
  const [beat, setBeat] = useState<string>(ASK_BEAT_POOL[0]);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 6e (2026-08-14 second session), the author's retune: the beat showed
  // ~250ms and disappeared too quickly. It now holds ~3 seconds with the
  // trailing dots animating in sequence for the duration. Presentation
  // only, still: routing and logging happen before the timer starts.
  const BEAT_MS = 3000;
  const [dots, setDots] = useState(1);
  useEffect(() => {
    if (!working) return;
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 400);
    return () => clearInterval(interval);
  }, [working]);
  // Two instances mount at once (the who-governs card and the sidebar
  // rail) — the label/input pairing must not share a DOM id.
  const inputId = useId();

  /**
   * The second rung (6d, 2026-08-15). Asked ONLY when the on-device keyword
   * matcher refused, and asked for one thing: which curated topic this
   * question belongs to. It writes none of the answer — the sentences below
   * are the same curated route the keyword path renders. A failure of any
   * kind (off, over ceiling, unreachable) returns null and the reader gets
   * the honest refusal they would have had.
   */
  const classify = async (question: string): Promise<string | null> => {
    try {
      const response = await fetch("/api/ask/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { topic?: string | null };
      return typeof body.topic === "string" ? body.topic : null;
    } catch {
      return null;
    }
  };

  const ask = () => {
    const question = text.trim();
    if (!question) return;

    // The beat starts immediately — it now covers real work on the refusal
    // path (one network call) as well as the deterministic path, and the
    // reader sees the same acknowledgment either way.
    if (beatTimer.current) clearTimeout(beatTimer.current);
    setAsked(null);
    setBeat(drawAskBeat());
    setWorking(true);

    void (async () => {
      const started = Date.now();
      let result = answerQuestion(question, coverage, zip);
      // Keyword-first, structurally: the classifier is consulted only after
      // the deterministic matcher has already refused.
      if (result.answer.kind !== "ROUTED") {
        const topic = await classify(question);
        if (topic) result = answerQuestion(question, coverage, zip, topic);
      }

      /*
       * G05 rule 4d (2026-08-17): a destination IS an answer, so a question
       * that reached one is not a refusal.
       *
       * This mattered more than it looks. The refusal log is the roadmap —
       * A06's whole reason for existing is that every unanswered question is
       * a data gap or a feature. Logging "what's on my ballot" as NO_ROUTE
       * after showing the reader the ballot page would put an ANSWERED
       * question into the list of things this product cannot do, and the
       * roadmap would be built on it. The same rule as everywhere else: a
       * record may never assert something the surface did not do.
       *
       * The destination id is a curated constant — one of four — and carries
       * no more about a reader than a topic id does.
       */
      const routedSomewhere = Boolean(
        (result.answer.kind === "ROUTED" && result.match) || result.destination,
      );
      if (routedSomewhere) {
        // The topic id, as always. `via` marks the rung that found it so a
        // later audit can tell a classifier route from a keyword one — a
        // fact about our machinery, never about the reader.
        logEvent("QUESTION_ASKED", ocdIds, {
          topic: result.match?.topicId ?? "DESTINATION_ONLY",
          routed: true,
          ...(result.match?.via ? { via: result.match.via } : {}),
          ...(result.destination
            ? { destination: result.destination.destination.id }
            : {}),
        });
      } else {
        // The refusal is the roadmap: the question rides along, capped,
        // identifier-free like every row.
        logEvent("QUESTION_ASKED", ocdIds, {
          topic: "NO_ROUTE",
          routed: false,
          question: question.slice(0, REFUSAL_LOG_MAX_CHARS),
        });
      }

      // The beat holds its full length whatever the rung cost, so the box
      // never flickers on a fast answer or feels stalled on a slow one.
      const remaining = Math.max(0, BEAT_MS - (Date.now() - started));
      beatTimer.current = setTimeout(() => {
        setAsked(result);
        setWorking(false);
      }, remaining);
    })();
  };

  // The flagship treatment (design pass, item 1): a standout feature
  // dressed as one — a raised block, a real heading, an input that
  // invites, a filled Ask. Behavior is untouched: same routing, same
  // logging, same beat, same words.
  return (
    <div className="mt-3.5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3.5 shadow-[var(--shadow-panel)]">
      <label
        htmlFor={inputId}
        className="block text-[0.9375rem] font-semibold leading-snug text-paper"
      >
        Who do I talk to about…?
      </label>
      {/*
        G05 rule 4d (2026-08-17): the copy may only promise what the router
        can route. The four in-app categories are READ FROM the router
        (`ROUTABLE_CATEGORIES`), so a category cannot be named here unless a
        route for it exists in destinations.ts, and removing a route removes
        its promise in the same edit. The topic half of the sentence keeps
        its concrete examples, which is what actually teaches the box.
      */}
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
        A pothole, the library, your kid&apos;s school — we&apos;ll point you
        at the office that owns it. Or ask for{" "}
        {ROUTABLE_CATEGORIES.map((category, i) => (
          <span key={category}>
            {i > 0 && (i === ROUTABLE_CATEGORIES.length - 1 ? " or " : ", ")}
            <span className="text-paper">{category.toLowerCase()}</span>
          </span>
        ))}
        .
      </p>
      <div className="mt-2.5 flex gap-2">
        <input
          id={inputId}
          data-ask-box
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
          placeholder="the library, a pothole, my kid's school…"
          className="min-w-0 flex-1 rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-3 py-2 text-[0.875rem] placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
        />
        <button
          type="button"
          onClick={ask}
          className="shrink-0 cursor-pointer rounded-md border border-[var(--action)] bg-[var(--action)] px-3.5 text-[0.8125rem] font-semibold text-[var(--action-on)] transition-opacity hover:opacity-90"
        >
          Ask
        </button>
      </div>

      {working && (
        // The beat — presentation only, and an acknowledgment rather than a
        // claim of deliberation. The static sentence is what a screen
        // reader announces; the cycling dots are visual, which is why the
        // author's trailing ellipsis is stripped from the stem.
        <p
          className="mt-2.5 text-[0.8125rem] italic leading-relaxed text-voice"
          aria-live="polite"
          data-ask-beat
        >
          {beatStem(beat)}
          <span aria-hidden="true">{".".repeat(dots)}</span>
        </p>
      )}

      {asked && asked.destination && (
        /*
          G05 rule 4d: the in-app destination. It rides ALONGSIDE the topic
          answer rather than replacing it — "when does the school board meet"
          is both a meetings destination and a schools topic, and dropping one
          would answer less than we know.

          Level throughout: every word describes what is on a surface, and
          none of it claims the surface is complete. The gaps each surface
          already states stay that surface's job to state.
        */
        <div
          data-ask-destination={asked.destination.destination.id}
          className="mt-3 rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
        >
          <p className="t-eyebrow text-signal">Where to look</p>
          <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-paper">
            {asked.destination.destination.label}
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-voice">
            {asked.destination.destination.statement}
          </p>
          {asked.destination.destination.href && (
            <a
              href={asked.destination.destination.href}
              className="mt-1.5 inline-block text-[0.75rem] text-link underline decoration-dotted underline-offset-2"
            >
              {asked.destination.destination.label}
            </a>
          )}
        </div>
      )}

      {asked && asked.answer.kind === "NO_ROUTE" && (
        <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-voice">
          {asked.answer.statement}
        </p>
      )}

      {asked && asked.answer.kind === "ROUTED" && asked.answer.topic && (
        <div className="mt-3">
          {/* The answer's own header: eyebrow naming the register, the
              topic as the heading. Same data as before, dressed to be
              read as the authoritative answer it is. */}
          <p className="t-eyebrow text-signal">The answer</p>
          <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-paper">
            {asked.answer.topic.label}
          </p>
          {asked.contacts.length > 0 && (
            // The everyday answer: the office that owns the fix, with the
            // real line. A service line that owns the topic IS the answer.
            <div className="mt-2 space-y-2">
              {asked.contacts.map((contact) => (
                <div
                  key={`${contact.body}|${contact.service}`}
                  className="rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
                >
                  <p className="text-[0.875rem] font-semibold text-paper">
                    {contact.body}
                  </p>
                  <p className="text-[0.75rem] leading-relaxed text-voice">
                    {contact.service}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                        className="font-mono text-[0.9375rem] font-semibold text-link"
                      >
                        {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-[0.75rem] text-link underline decoration-dotted underline-offset-2"
                      >
                        {contact.email}
                      </a>
                    )}
                    {contact.requestUrl && (
                      <a
                        href={contact.requestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[0.75rem] text-link underline decoration-dotted underline-offset-2"
                      >
                        online request
                      </a>
                    )}
                  </p>
                  {contact.note && (
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
                      {contact.note}
                    </p>
                  )}
                  <a
                    href={contact.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block source-tag font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted underline decoration-dotted underline-offset-2 hover:text-link"
                  >
                    source — {contact.sourceOrg}
                  </a>
                </div>
              ))}
            </div>
          )}
          <ol className="mt-2 space-y-2.5">
            {asked.answer.steps.map((step, i) => (
              <li key={i} className="text-[0.75rem] leading-relaxed">
                <p className="text-voice">{step.why}</p>
                {step.bodies.length > 0 && (
                  <p className="mt-0.5 text-[0.8125rem]">
                    {step.bodies.map((body, j) => (
                      <span key={body.label}>
                        {j > 0 && <span className="text-muted"> · </span>}
                        {body.homepageUrl ? (
                          <a
                            href={body.homepageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-link underline decoration-dotted underline-offset-2"
                          >
                            {body.label}
                          </a>
                        ) : (
                          <span className="text-paper">{body.label}</span>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {step.people.length > 0 && (
                  <p className="mt-0.5 text-[0.8125rem]">
                    {step.people.map((person, j) => (
                      <span key={person.id}>
                        {j > 0 && <span className="text-muted">, </span>}
                        <span className="font-medium text-paper">
                          {person.name}
                        </span>
                        <span className="text-muted"> · {person.officeTitle}</span>
                        {person.sourceUrl && (
                          <>
                            {" "}
                            <a
                              href={person.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="source-tag font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted underline decoration-dotted underline-offset-2 hover:text-link"
                            >
                              source
                            </a>
                          </>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {/*
                  M94 (2026-08-16), the footnote collapse: a gap sentence is
                  said ONCE per answer, on the first step that hits it.

                  A four-step route where three steps land on bodies we hold
                  and no roster for rendered "We haven't sourced who sits on
                  this body yet." three times, one line apart. Repeating a
                  notice does not make it more honest — it makes the answer
                  look like it is mostly apology, and it buries the steps
                  that DID resolve. The rule is the same one the transparency
                  diet applied to every other repeated line: state it, and
                  state it once.

                  It is still per-SENTENCE, not per-answer: two DIFFERENT gap
                  sentences are two different facts and both are said.
                */}
                {step.gap &&
                  asked.answer.steps.findIndex((s) => s.gap === step.gap) === i && (
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
                      {step.gap}
                    </p>
                  )}
              </li>
            ))}
          </ol>
          {/* The denominator, always stated — never implied completeness. */}
          <p className="mt-2 border-t border-[var(--panel-border)] pt-1.5 text-[0.625rem] leading-relaxed text-muted">
            Based on what we track here
            {zip ? ` around ${zip}` : ""} — {asked.answer.grounding.stepsWithSomeone}{" "}
            of {asked.answer.grounding.totalSteps} steps point at a body or
            person we can actually name.
          </p>
        </div>
      )}
    </div>
  );
}
