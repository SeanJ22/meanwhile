"use client";

import { useState } from "react";

import {
  SPEAK_CONFIRMATION,
  SPEAK_DISCLOSURE,
  SPEAK_LABEL,
  SPEAK_PLACEHOLDER,
  SPEAK_THREAT_NOTICE,
  speakFraming,
} from "@/lib/speak/copy";
import {
  submitSpeakYourMind,
  type SpeakResult,
  type SpeakSubjectType,
} from "@/lib/speak/client";
import { SPEAK_MAX_CHARS } from "@/lib/speak/limits";

/**
 * **BC-11 — SPEAK YOUR MIND.** (The author's ruling, 2026-08-24.)
 *
 * *This is the collection point for verbatim constituent sentiment — product
 * infrastructure, not a comment box.* His reference surface is Mark Kelly's
 * battlecard, and it goes on every battlecard and every large meeting
 * battlecard in the product: above Sources, below Voting record.
 *
 * ## Why the pill is deep navy and everything else here is grey
 *
 * The author asked for it by sight, and the reason holds: every other pill on
 * a battlecard is a label or a disclosure, and this is the one thing a reader
 * is being INVITED to do. A filled control among outline controls reads as the
 * action without a word of instruction — the same grammar the ballot pill and
 * the Ask button already use, and the design system's own reservation of
 * saturated fill for a primary action.
 *
 * ## The framing is the whole instrument
 *
 * *What you'd say if this person were standing in front of you.* That is not
 * decoration; it is what makes the answer worth collecting. A box labelled
 * "comments" collects opinions about the app. This asks for the thing a
 * constituent would actually say, which is the sentiment the product exists to
 * carry.
 *
 * ## Nothing is rendered back, and that is the same rule reactions live under
 *
 * `CLAUDE.md`'s no-user-to-user rule: reactions are write-only from the
 * reader's perspective, because showing aggregates anchors later respondents
 * and corrupts the data. Nothing a reader writes here is shown to anybody.
 * **The author recorded that default as REVERSIBLE** — his call, later.
 *
 * ## The three things this surface says, and each is required by a rule
 *
 * 1. `SPEAK_DISCLOSURE` — RULE 2, at the box, before the reader types.
 * 2. `SPEAK_THREAT_NOTICE` — `CLAUDE.md` requires it adjacent to any free-text
 *    field about named real people, worded "may" rather than "will".
 * 3. The honest outcome — a submission never silently succeeds into a void, so
 *    "there is no store" and "it failed" get different sentences and only
 *    `RECORDED` is thanked.
 */
export function SpeakYourMind({
  subjectType,
  subjectId,
  subject,
  context,
}: {
  subjectType: SpeakSubjectType;
  /** The subject's public identifier. Who is spoken TO, never who speaks. */
  subjectId: string;
  /**
   * How to name the subject in the framing question. A person's name for a
   * person, the body's name for a body — "this person" over a school board
   * would be the kind of default that reads as a bug.
   */
  subject: string;
  context?: { lat?: number | null; lng?: number | null };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
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

  if (!open) {
    return (
      <div className="speak-block">
        <button
          type="button"
          className="speak-pill"
          data-speak-pill
          onClick={() => setOpen(true)}
        >
          {SPEAK_LABEL}
        </button>
      </div>
    );
  }

  return (
    <div className="speak-block" data-speak-open>
      <p className="speak-framing">{speakFraming(subject)}</p>

      <label className="sr-only" htmlFor={`speak-${subjectId}`}>
        {speakFraming(subject)}
      </label>
      <textarea
        id={`speak-${subjectId}`}
        className="speak-input"
        /* The placeholder clears on type because it IS a placeholder — a
           prompt, never a value the reader has to delete. */
        placeholder={SPEAK_PLACEHOLDER}
        value={text}
        maxLength={SPEAK_MAX_CHARS}
        rows={4}
        onChange={(e) => {
          setText(e.target.value);
          // A new keystroke means the previous outcome is stale. Leaving
          // "that's recorded" on screen over fresh unsent text would be the
          // quiet lie this codebase keeps catching.
          if (result !== null) setResult(null);
        }}
      />

      {/* RULE 2 — the honest disclosure, at the box. Level register. */}
      <p className="speak-disclosure">{SPEAK_DISCLOSURE}</p>
      {/* CLAUDE.md: the threat notice, adjacent to the field. "May", never
          "will" — a stated commitment not honoured on every instance is worse
          than a reserved right. */}
      <p className="speak-disclosure">{SPEAK_THREAT_NOTICE}</p>

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
                : "That didn't go through. Nothing was kept."}
        </p>
      )}
    </div>
  );
}
