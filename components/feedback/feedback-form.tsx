"use client";

import { useState } from "react";

import { submitFeedback } from "@/lib/feedback/client";
import { FEEDBACK_MAX_CHARS, type FeedbackSurface } from "@/lib/feedback/shape";

/**
 * The feedback form (R40, 2026-08-17, the author's ruling: 1A, in-app).
 *
 * ## What it replaced
 *
 * `mailto:` links to the author's personal address, on the sidebar footer and
 * twice on /transparency. A personal address in a shipped product is a
 * standing invitation for every scraper that reads the page, and it is also a
 * worse reader experience than it looks: a `mailto:` on a phone opens
 * whatever mail client the OS thinks is default, which for a lot of people is
 * nothing at all.
 *
 * ## The one rule that shaped it
 *
 * **A submission never silently succeeds into a void.** Three states, and
 * they are never blurred:
 *
 * - `idle`/`sending` — the button says which.
 * - `stored` — a 204 came back. Only then is anyone thanked.
 * - `failed` — anything else, rendered with the SERVER'S OWN sentence about
 *   what happened, and with the reader's text still in the box. A form that
 *   clears the field on failure has destroyed the thing it failed to save.
 *
 * ## Register
 *
 * The ask is playful (it is an interaction surface); everything that makes a
 * CLAIM — what we store, what we scrub, that we cannot write back — is level.
 * The seam runs right down the middle of this component and that is the rule
 * working, not an inconsistency.
 */
export function FeedbackForm({ surface }: { surface: FeedbackSurface }) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "stored" | "failed">(
    "idle",
  );
  const [failure, setFailure] = useState<string | null>(null);

  const trimmed = message.trim();
  const tooLong = message.length > FEEDBACK_MAX_CHARS;

  if (state === "stored") {
    return (
      <div className="mt-6 rounded border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <p className="text-[0.9375rem] font-medium text-paper">Got it — thank you.</p>
        {/* Level, because it is a claim about what happens next. */}
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-paper-dim">
          It is stored and the author reads it. There is no way for us to write
          back, because this form does not collect one.
        </p>
        <button
          type="button"
          className="mt-3 cursor-pointer text-[0.8125rem] text-link underline decoration-dotted underline-offset-2"
          onClick={() => {
            setMessage("");
            setState("idle");
            setFailure(null);
          }}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!trimmed || tooLong || state === "sending") return;
        setState("sending");
        setFailure(null);
        const outcome = await submitFeedback(trimmed, surface);
        if (outcome.kind === "STORED") {
          setState("stored");
        } else {
          // The text stays in the box. It is the reader's, and we just failed
          // to keep it.
          setFailure(outcome.message);
          setState("failed");
        }
      }}
    >
      <label
        htmlFor="feedback-message"
        className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-label"
      >
        Your message
      </label>
      <textarea
        id="feedback-message"
        data-feedback-input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={8}
        placeholder="What is wrong, missing, or confusing?"
        className="mt-2 w-full rounded border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-[0.9375rem] leading-relaxed text-paper outline-none focus:border-[var(--link)]"
      />

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
        {/* Level: a limit is a fact, and a reader who hits it needs the number. */}
        <p className="text-[0.75rem] text-muted">
          {message.length > FEEDBACK_MAX_CHARS - 200
            ? `${message.length} of ${FEEDBACK_MAX_CHARS} characters`
            : `Up to ${FEEDBACK_MAX_CHARS} characters.`}
        </p>
      </div>

      <button
        type="submit"
        disabled={!trimmed || tooLong || state === "sending"}
        className="mt-3 cursor-pointer rounded bg-[var(--action)] px-4 py-2 text-[0.875rem] font-semibold text-[var(--action-on)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Send it"}
      </button>

      {state === "failed" && failure && (
        <p
          data-feedback-error
          role="alert"
          className="mt-3 rounded border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-[0.875rem] leading-relaxed text-paper"
        >
          {failure}
        </p>
      )}
    </form>
  );
}
