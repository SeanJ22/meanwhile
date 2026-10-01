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
 * ## What this surface says

 * The honest outcome only: a submission never silently succeeds into a void, so
 * "there is no store" and "it failed" get different sentences and only
 * `RECORDED` is thanked. There is no notice at the box; what the site collects
 * is stated once, on /transparency (Sean, October 1, 2026).
 */
/**
 * Unsent drafts, per subject, for this tab only (approved reader design:
 * "keep unsent drafts through navigation"). In memory — never written to
 * storage and never sent — so moving deeper in the card and coming Back
 * finds the words where the reader left them; a reload starts clean.
 */
const drafts = new Map<string, string>();

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
  const draftKey = `${subjectType}:${subjectId}`;
  const [open, setOpen] = useState(() => (drafts.get(draftKey) ?? "") !== "");
  const rootRef = useRef<HTMLDivElement>(null);

  /*
   * **BC-22 (2026-08-25) — IT MUST CLOSE. Today nothing dismisses it.**
   *
   * The author found the panel with no way out: the pill is replaced by the
   * panel on open, so there is nothing left to re-click, and the panel has no
   * control of its own. A surface a reader cannot dismiss is worse than one
   * they cannot open.
   *
   * Three exits, which is what he asked for, and they are three because each
   * covers a reader the others miss:
   *
   *  - **The pill stays and TOGGLES.** It is rendered above the panel now
   *    rather than replaced by it, so "collapses to its pill" is literally
   *    what happens. This is the discoverable exit.
   *  - **Click-away**, through the same hook every card on the map uses. The
   *    gesture a phone reader reaches for first.
   *  - **A tab switch**, below.
   *
   * The explicit control STAYS — that hook doc says it in as many words: a
   * gesture nobody discovers is not an exit at all.
   */
  useDismissOnOutside(rootRef, () => setOpen(false), open);

  /*
   * **BC-20 — A TAB SWITCH COLLAPSES IT, AND THE KEY IS WHAT DOES IT.**
   *
   * The panel lives inside a tabbed card and inside a sectioned one. Moving
   * away and back should not find half-typed text under a heading a reader
   * has stopped looking at, so the subject changing collapses it — and
   * `subjectId` changing is also what happens when a reader opens a
   * different card entirely, which wants the same answer.
   *
   * **This used to be an effect calling `setOpen(false)` on `[subjectId]`,
   * and it was removed 2026-08-25 (RO04).** It was `react-hooks/
   * set-state-in-effect`, one of the two errors that held `main` red — and
   * the comment it carried already named its own replacement: *the parent
   * keys this component on the tab, so a tab change unmounts and remounts
   * it.* Every call site now keys on the SUBJECT as well, so a subject
   * change is the same unmount-and-remount a tab change always was. There is
   * no effect, no handler, and nothing for a future call site to forget.
   *
   * **The effect was also strictly weaker than the key, and the gap was a
   * data one.** It reset `open` and nothing else, so `text` survived a
   * subject change: type about one person, switch, reopen, and their words
   * are sitting in the box under somebody else's name — one Send away from
   * being stored against the wrong `subjectId`. Remounting clears `text`,
   * `sending` and `result` with `open`, which is what the first paragraph
   * asked for all along.
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



  /*
   * **BC-18 (2026-08-25) — the framing branches, and it branches on data this
   * component ALREADY HAS.**
   *
   * A person can stand in front of you; Tucson Unified District cannot.
   * `subjectType` is already a required prop and already knows which of the
   * two this is, so the branch is DERIVED rather than passed — no call site
   * can forget it, and a new surface cannot ship the person sentence about a
   * board by omission. A MEETING is a body speaking, so it takes the body
   * form.
   */
  const framing = speakFraming(subject, subjectType === "OFFICIAL" ? "person" : "body");

  return (
    <div
      ref={rootRef}
      className="speak-block"
      {...(open ? { "data-speak-open": true } : {})}
    >
      {/* BC-22: the pill is always here, and it TOGGLES. Replacing it with the
          panel is what left the reader with no way out. */}
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
      </>
      )}
    </div>
  );
}
