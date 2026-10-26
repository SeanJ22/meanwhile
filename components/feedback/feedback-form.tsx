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
 * The in-app feedback form. Only a 204 thanks the reader; any other outcome
 * shows the server's own message and keeps the text in the box. The reply
 * address is optional and blank by default.
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
  /** Whether the stored submission carried an address, captured at send time. */
  const [sentWithReply, setSentWithReply] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "stored" | "failed">(
    "idle",
  );
  const [failure, setFailure] = useState<string | null>(null);

  const trimmed = message.trim();
  const tooLong = message.length > FEEDBACK_MAX_CHARS;
  const trimmedReply = replyTo.trim();
  const replyMalformed = trimmedReply.length > 0 && !isReplyToShaped(trimmedReply);

  if (state === "stored") {
    return (
      <div className="mt-6 rounded border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <p className="text-[0.9375rem] font-medium text-paper">Got it — thank you.</p>
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
          // The text stays in the box.
          setFailure(outcome.message);
          setState("failed");
        }
      }}
    >
      <label
        htmlFor="feedback-message"
        className="font-mono text-[0.6875rem] trailing-space-trimmed-20 tracking-[0.2em] text-label"
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
        <p className="text-[0.75rem] text-muted">
          {message.length > FEEDBACK_MAX_CHARS - 200
            ? `${message.length} of ${FEEDBACK_MAX_CHARS} characters`
            : `Up to ${FEEDBACK_MAX_CHARS} characters.`}
        </p>
      </div>

      <div className="mt-5">
        <label
          htmlFor="feedback-reply-to"
          className="font-mono text-[0.6875rem] trailing-space-trimmed-20 tracking-[0.2em] text-label"
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
