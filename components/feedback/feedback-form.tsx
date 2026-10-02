"use client";

import { useState } from "react";

import { submitFeedback } from "@/lib/feedback/client";
import {
  FEEDBACK_MAX_CHARS,
  REPLY_TO_MAX_CHARS,
  isReplyToShaped,
  type FeedbackSurface,
  type FeedbackContext,
} from "@/lib/feedback/shape";

/**
 * The feedback form (R40, 2026-08-17: 1A, in-app).
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
 *
 * ## The optional reply address (R41, 2026-08-17, option A)
 *
 * One more field, and everything about it is designed so that leaving it
 * alone stays the effortless default: it is blank, it is labelled optional in
 * its own label rather than in fine print below it, and the submit button
 * never waits on it. The claim beside it is level and says exactly what the
 * two outcomes are — an address means a reply is possible, blank means it is
 * not — because the previous version of this form promised flatly that nobody
 * could write back, and that sentence is now only true of the blank case.
 */
export function FeedbackForm({
  surface,
  initialMessage = "",
  context = {},
}: {
  surface: FeedbackSurface;
  /** Opened from a card: the message starts by naming it. */
  initialMessage?: string;
  context?: FeedbackContext;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [replyTo, setReplyTo] = useState("");
  /**
   * Whether the submission that SUCCEEDED carried an address — captured at
   * send time, not read off the live field, because the confirmation is a
   * claim about what was stored and the field is cleared behind it.
   */
  const [sentWithReply, setSentWithReply] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "stored" | "failed">(
    "idle",
  );
  const [failure, setFailure] = useState<string | null>(null);

  const trimmed = message.trim();
  const tooLong = message.length > FEEDBACK_MAX_CHARS;
  const trimmedReply = replyTo.trim();
  // Only ever a complaint about something the reader actually typed. An
  // untouched field is never wrong, because blank is what the form expects.
  const replyMalformed = trimmedReply.length > 0 && !isReplyToShaped(trimmedReply);

  if (state === "stored") {
    return (
      <div className="mt-6 rounded border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <p className="text-[0.9375rem] font-medium text-paper">Got it — thank you.</p>
        {/* Level, because it is a claim about what happens next. */}
        {/*
          Two different facts, and they may not render as the same sentence.
          A reader who gave an address is told a reply is possible; a reader
          who did not is told plainly that it is not, rather than being left
          to wonder.
        */}
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-paper-dim">
          {sentWithReply
            ? "It is stored and the author reads it. Because you left an address, a reply is possible — though this is one person reading, so it may take a while."
            : "It is stored and the author reads it. You left no address, so there is no way for us to write back."}
        </p>
        <button
          type="button"
          className="mt-3 cursor-pointer text-[0.8125rem] text-link underline decoration-dotted underline-offset-2"
          onClick={() => {
            setMessage("");
            setReplyTo("");
            setSentWithReply(false);
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
        if (!trimmed || tooLong || replyMalformed || state === "sending") return;
        setState("sending");
        setFailure(null);
        const outcome = await submitFeedback(trimmed, surface, trimmedReply, context);
        if (outcome.kind === "STORED") {
          setSentWithReply(trimmedReply.length > 0);
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
        className="font-mono text-[0.6875rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-label"
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

      {/*
        R41. The optionality is in the LABEL, not in fine print underneath it:
        a reader scanning the form sees "optional" at the moment they see the
        field, and skipping it costs nothing — no asterisk, no confirmation,
        no disabled button waiting on it.
      */}
      <div className="mt-5">
        <label
          htmlFor="feedback-reply-to"
          className="font-mono text-[0.6875rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-label"
        >
          Your email — optional
        </label>
        <input
          id="feedback-reply-to"
          data-feedback-reply
          type="email"
          inputMode="email"
          autoComplete="email"
          value={replyTo}
          maxLength={REPLY_TO_MAX_CHARS}
          placeholder="Leave blank if you would rather not hear back"
          onChange={(event) => setReplyTo(event.target.value)}
          className="mt-2 w-full rounded border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-[0.9375rem] leading-relaxed text-paper outline-none focus:border-[var(--link)]"
        />
        {/*
          Level: this is a claim about what we store and what we do with it.
          It states the scrub asymmetry out loud, because a reader who has
          read the old promise deserves to know why this field survives when
          an address typed into the message above does not.
        */}
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
          Only used to reply to you, and stored with your message and nothing
          else. Anything that looks like contact details in the message itself
          is still removed before it is stored — this field is the exception,
          because you chose to put it here.
        </p>
        {replyMalformed && (
          <p
            data-feedback-reply-error
            role="alert"
            className="mt-1.5 text-[0.75rem] leading-relaxed text-paper"
          >
            That does not look like an email address. Fix it, or clear the field
            to send without one.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!trimmed || tooLong || replyMalformed || state === "sending"}
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
