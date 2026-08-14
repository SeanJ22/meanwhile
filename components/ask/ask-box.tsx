"use client";

import { useState } from "react";

import { answerQuestion, REFUSAL_LOG_MAX_CHARS, type AskAnswer } from "@/lib/routing/ask";
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

  const ask = () => {
    const question = text.trim();
    if (!question) return;
    const result = answerQuestion(question, coverage);
    setAsked(result);
    if (result.answer.kind === "ROUTED" && result.match) {
      logEvent("QUESTION_ASKED", ocdIds, {
        topic: result.match.topicId,
        routed: true,
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
  };

  return (
    <div className="mt-3 rounded border border-dashed border-[var(--panel-border)] p-2.5">
      <label
        htmlFor="ask-box-input"
        className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted"
      >
        Who do I talk to about…?
      </label>
      <div className="mt-1.5 flex gap-1.5">
        <input
          id="ask-box-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
          placeholder="the library, a pothole, my kid's school…"
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5 text-[0.8125rem] placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
        />
        <button
          type="button"
          onClick={ask}
          className="shrink-0 cursor-pointer rounded border border-[var(--panel-border)] px-2.5 text-[0.75rem] text-paper-dim hover:border-[var(--signal)] hover:text-paper"
        >
          Ask
        </button>
      </div>

      {asked && asked.answer.kind === "NO_ROUTE" && (
        <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
          {asked.answer.statement}
        </p>
      )}

      {asked && asked.answer.kind === "ROUTED" && asked.answer.topic && (
        <div className="mt-2">
          <p className="text-[0.75rem] font-semibold">
            {asked.answer.topic.label}
          </p>
          <ol className="mt-1 space-y-2">
            {asked.answer.steps.map((step, i) => (
              <li key={i} className="text-[0.75rem] leading-relaxed">
                <p className="text-paper-dim">{step.why}</p>
                {step.bodies.length > 0 && (
                  <p className="mt-0.5">
                    {step.bodies.map((body, j) => (
                      <span key={body.label}>
                        {j > 0 && <span className="text-muted"> · </span>}
                        {body.homepageUrl ? (
                          <a
                            href={body.homepageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-signal underline decoration-dotted"
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
                  <p className="mt-0.5">
                    {step.people.map((person, j) => (
                      <span key={person.id}>
                        {j > 0 && <span className="text-muted">, </span>}
                        <span className="text-paper">{person.name}</span>
                        <span className="text-muted"> · {person.officeTitle}</span>
                        {person.sourceUrl && (
                          <>
                            {" "}
                            <a
                              href={person.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-signal"
                            >
                              source
                            </a>
                          </>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {step.gap && (
                  <p className="mt-0.5 text-[0.6875rem] text-muted">{step.gap}</p>
                )}
              </li>
            ))}
          </ol>
          {/* The denominator, always stated — never implied completeness. */}
          <p className="mt-1.5 text-[0.625rem] text-muted">
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
