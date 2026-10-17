"use client";

import { useRef, useState } from "react";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";

import {
  SPEAK_CONFIRMATION,
  SPEAK_LABEL,
  SPEAK_PLACEHOLDER,
  speakFraming,
} from "@/lib/speak/copy";
import {
  submitSpeakYourMind,
  type SpeakResult,
  type SpeakSubjectType,
} from "@/lib/speak/client";
import { SPEAK_MAX_CHARS } from "@/lib/speak/limits";

/**
 * Speak Your Mind: what the reader would say if this subject were in front of
 * them. Nothing written here is shown to anybody. Only `RECORDED` is thanked;
 * "no store" and "failed" get their own sentences.
 */

/**
 * Unsent drafts per subject, in memory for this tab only, so moving deeper in
 * the card and coming back keeps the words; a reload starts clean.
 */
const drafts = new Map<string, string>();

export function SpeakYourMind({
  subjectType,
  subjectId,
  subject,
  context,
}: {
  subjectType: SpeakSubjectType;
  /** Who is spoken to, never who speaks. */
  subjectId: string;
  /** The subject's name for the framing question. */
  subject: string;
  context?: { lat?: number | null; lng?: number | null };
}) {
  const draftKey = `${subjectType}:${subjectId}`;
  const [open, setOpen] = useState(() => (drafts.get(draftKey) ?? "") !== "");
  const rootRef = useRef<HTMLDivElement>(null);

  /* The pill toggles; a press outside closes the panel too. */
  useDismissOnOutside(rootRef, () => setOpen(false), open);

  /*
   * Call sites key this component on the tab and the subject, so a change
   * remounts it and clears `text`, `sending` and `result` with `open`.
   */
  const [text, setTextState] = useState(() => drafts.get(draftKey) ?? "");
  const setText = (value: string) => {
    setTextState(value);
    if (value) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SpeakResult | null>(null);

  const remaining = SPEAK_MAX_CHARS - text.length;

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const outcome = await submitSpeakYourMind(subjectType, subjectId, trimmed, context);
    setResult(outcome);
    setSending(false);
    if (outcome === "RECORDED") setText("");
  }



  /* Officials get the person framing; bodies and meetings the body framing. */
  const framing = speakFraming(subject, subjectType === "OFFICIAL" ? "person" : "body");

  return (
    <div
      ref={rootRef}
      className="speak-block"
      {...(open ? { "data-speak-open": true } : {})}
    >
      {/* The pill is always here and toggles. */}
      <button
        type="button"
        className="speak-pill"
        data-speak-pill
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {SPEAK_LABEL}
      </button>

      {!open ? null : (
      <>
      <p className="speak-framing">{framing}</p>

      <label className="sr-only" htmlFor={`speak-${subjectId}`}>
        {framing}
      </label>
      <textarea
        id={`speak-${subjectId}`}
        className="speak-input"
        placeholder={SPEAK_PLACEHOLDER}
        value={text}
        maxLength={SPEAK_MAX_CHARS}
        rows={4}
        onChange={(e) => {
          setText(e.target.value);
          // A new keystroke makes the previous outcome stale.
          if (result !== null) setResult(null);
        }}
      />

      <div className="speak-actions">
        <button
          type="button"
          className="speak-send"
          data-speak-send
          disabled={sending || text.trim().length === 0}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : "Send it"}
        </button>
        <span className="speak-count">{remaining}</span>
      </div>

      {result !== null && (
        <p className="speak-outcome" data-speak-outcome={result}>
          {result === "RECORDED"
            ? SPEAK_CONFIRMATION
            : result === "NOT_STORED"
              ? "This isn't connected to a store right now, so that wasn't kept."
              : result === "REFUSED"
                ? "We're not taking submissions at the moment. Nothing was kept."
                : "We couldn't confirm that this was saved. Your draft is still here."}
        </p>
      )}
      </>
      )}
    </div>
  );
}
