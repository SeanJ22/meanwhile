"use client";

/**
 * **SUGGESTED NEXT STEPS — the decisions only the owner can make.** (Admin
 * redesign, 2026-09-23; the design's Fleet · Now list.)
 *
 * Each card offers its settled options and, where the card is a real fork, an
 * answer in the owner's own words. Every answer goes through the one
 * authenticated write the console has for this, `decision.record`, and the
 * card says what was recorded and what happens next — in the system's actual
 * terms, not the design's hoped-for ones:
 *
 * ```
 *   recorded       the answer, verbatim, on the append-only decision log
 *   who applies it the decision sync, run by an engineering session (not the
 *                  runner), turns it into the work it implies
 *   free text      read by a person; no supported check interprets it, so
 *                  nothing starts on its own from the words (MW-030)
 * ```
 *
 * Two defects in the previous queue are not carried over: its idempotency key
 * contained spaces, which the gateway refuses before recording anything, and
 * it quoted a page revision the gateway computes differently, so a runner
 * heartbeat made a good click stale. Here the key is shaped as the gateway
 * requires, and the pulse is read at the moment of the click: the answer is
 * refused only when the decision list itself moved since the page was drawn.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { fnv } from "./fnv.ts";
import { actionReplyWords, decodeAdminActionResponse } from "./action-receipt.ts";
import s from "./mw.module.css";
import { Pill } from "./ui.tsx";

export interface StepCard {
  readonly rowId: string;
  readonly rank: number;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly why: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  readonly priority: string;
  readonly ageDays: number | null;
  readonly kind: "DECISION" | "ACKNOWLEDGE" | "BLOCKED_WHILE";
  readonly blocker: string | null;
  readonly ownWords: boolean;
}

/** The gateway's own limit on an answer in the owner's words. */
export const ANSWER_MAX_CHARS = 2000;

const STARTERS = [
  "Neither of these — tell me what else would settle it.",
  "Not now. Raise it with me again in a week.",
  "Do the first, but tell me before anything is spent.",
];

type Phase =
  | { readonly kind: "IDLE" }
  | { readonly kind: "CONFIRM"; readonly option: string; readonly consequence: string }
  | { readonly kind: "SAVING"; readonly what: string }
  | { readonly kind: "SAVED"; readonly what: string; readonly quoted: string | null; readonly ref: string; readonly says: string }
  | { readonly kind: "PENDING" | "REFUSED" | "UNCONFIRMED"; readonly what: string; readonly says: string }
  | { readonly kind: "FAILED"; readonly what: string; readonly says: string };

/** Card-relevant parts of the pulse revision: the published snapshot and the decision log. */
function listPart(revision: string): string {
  const parts = revision.split("|");
  return `${parts[1] ?? "-"}|${parts[2] ?? "-"}`;
}

export function NextSteps(props: {
  readonly cards: readonly StepCard[];
  readonly renderedRevision: string;
  readonly actionRoute: string;
  readonly liveRoute: string;
  readonly returnTo: string;
  /** How many to show before "Show all". */
  readonly firstShown: number;
}) {
  const router = useRouter();
  // One nonce per page, made on the first record (never during render), so a retry of the same answer dedupes.
  const nonceRef = useRef<string | null>(null);
  const nonce = (): string => (nonceRef.current ??= Math.random().toString(36).slice(2, 10));
  const [phase, setPhase] = useState<Readonly<Record<string, Phase>>>({});
  const [otherOpen, setOtherOpen] = useState<string | null>(null);
  const [text, setText] = useState<Readonly<Record<string, string>>>({});
  const [showAll, setShowAll] = useState(false);

  const set = (rowId: string, p: Phase) => setPhase((was) => ({ ...was, [rowId]: p }));

  async function record(card: StepCard, chosenOption: string, consequenceShown: string, ownerAnswer: string | null) {
    const what = ownerAnswer === null ? chosenOption : "Your own words";
    set(card.rowId, { kind: "SAVING", what });
    try {
      const live = await fetch(props.liveRoute, { headers: { accept: "application/json" }, cache: "no-store" });
      const pulse = (await live.json().catch(() => null)) as { revision?: string } | null;
      const current = pulse?.revision ?? null;
      if (!live.ok || current === null || current === "unread") {
        set(card.rowId, { kind: "FAILED", what, says: "The console could not read the current state of the list, so nothing was recorded. Try again in a moment." });
        return;
      }
      if (listPart(current) !== listPart(props.renderedRevision)) {
        set(card.rowId, {
          kind: "FAILED",
          what,
          says: "The list of decisions changed after this page was drawn, so nothing was recorded — an answer to a card that may have moved is not safe to keep. Reload the page and answer again.",
        });
        return;
      }
      const idempotencyKey = `decision:${card.rowId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40)}:${fnv(`${chosenOption}\u0000${ownerAnswer ?? ""}`)}:${nonce()}`;
      const res = await fetch(props.actionRoute, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "decision.record",
          subject: card.rowId,
          input: { subjectId: card.rowId, chosenOption: ownerAnswer === null ? chosenOption : "", consequenceShown, ownerAnswer },
          idempotencyKey,
          stateVersion: current,
          returnTo: props.returnTo,
        }),
      });
      const reply = decodeAdminActionResponse(res.status, await res.json().catch(() => null));
      if (reply.kind !== "DONE") {
        set(card.rowId, { kind: reply.kind, what, says: actionReplyWords(reply) });
        return;
      }
      set(card.rowId, {
        kind: "SAVED",
        what,
        quoted: ownerAnswer,
        ref: reply.receiptId,
        says: actionReplyWords(reply),
      });
      router.refresh();
    } catch {
      set(card.rowId, { kind: "UNCONFIRMED", what, says: "The response was lost. The answer may have been recorded; check the action ledger before retrying." });
    }
  }

  const shown = showAll ? props.cards : props.cards.slice(0, props.firstShown);

  return (
    <div className={s.stack14} style={{ marginBottom: 36 }}>
      {shown.map((card) => {
        const p = phase[card.rowId] ?? { kind: "IDLE" };
        const isOther = otherOpen === card.rowId;
        const words = text[card.rowId] ?? "";
        const pillWords =
          card.kind === "ACKNOWLEDGE"
            ? "OPTIONAL · NOTHING TO DECIDE"
            : card.kind === "BLOCKED_WHILE"
              ? "WAITS ON A CHECK, NOT ON YOU"
              : `${card.priority}${card.ageDays !== null ? ` · WAITING ${card.ageDays} ${card.ageDays === 1 ? "DAY" : "DAYS"}` : ""}`;
        const done = p.kind === "SAVED";
        return (
          <div key={card.rowId} className={`${s.card} ${s.cardList}`} id={`step-${card.rowId}`}>
            <div className={s.row}>
              <span className={s.rank}>{card.rank}</span>
              <h3 className={`${s.h3} ${s.h3Wide}`}>{card.title}</h3>
              <Pill tone={card.kind === "DECISION" ? "slate" : "stone"}>{pillWords}</Pill>
            </div>
            <p className={s.body}>{card.whatIsNeeded}</p>
            {card.why && <p className={s.bodyStrong}>{card.why}</p>}
            {card.kind === "BLOCKED_WHILE" && card.blocker && <p className={s.body}>Blocked while: {card.blocker}</p>}

            {!done && card.kind !== "BLOCKED_WHILE" && (
              <div className={s.actions}>
                {card.options.map((o, i) => (
                  <button
                    key={o.option}
                    type="button"
                    className={i === 0 ? s.btnPrimary : s.btnSecondary}
                    disabled={p.kind === "SAVING"}
                    onClick={() => set(card.rowId, { kind: "CONFIRM", option: o.option, consequence: o.consequence })}
                  >
                    {o.option}
                  </button>
                ))}
                {card.ownWords && (
                  <button
                    type="button"
                    className={`${s.btnToggle} ${isOther ? s.btnToggleOn : ""}`}
                    aria-expanded={isOther}
                    onClick={() => setOtherOpen(isOther ? null : card.rowId)}
                  >
                    {isOther ? "Close" : "Something else"}
                  </button>
                )}
              </div>
            )}

            {p.kind === "CONFIRM" && (
              <div className={s.ringBox}>
                <div className={s.label}>If you choose this</div>
                <p className={s.note}>
                  <strong className={s.strong}>{p.option}.</strong> {p.consequence !== "" ? p.consequence : "No consequence is written on the card for this option."}
                </p>
                <div className={s.actions}>
                  <button type="button" className={s.btnPrimary} onClick={() => void record(card, p.option, p.consequence, null)}>
                    Record this decision
                  </button>
                  <button type="button" className={s.btnSecondary} onClick={() => set(card.rowId, { kind: "IDLE" })}>
                    Cancel
                  </button>
                </div>
                <p className={`${s.note} ${s.noteTop}`}>
                  It goes on the decision log with the words above as what you were shown. The decision sync — run by an engineering session, not the runner — applies it.
                </p>
              </div>
            )}

            {isOther && !done && (
              <div className={s.ringBox}>
                <div className={s.label}>Something else</div>
                <p className={s.note} style={{ marginBottom: 14, maxWidth: "76ch" }}>
                  Neither of those. Say what you want instead, in your own words — they are kept verbatim against this row and shown back to you. Before you send, know
                  what the system does with them: a person reads them; no supported check interprets free text, so nothing starts on its own from these words.
                </p>
                <textarea
                  className={s.textarea}
                  value={words}
                  maxLength={ANSWER_MAX_CHARS}
                  placeholder={STARTERS[0]}
                  aria-label={`Your answer to ${card.title}`}
                  onChange={(e) => setText((was) => ({ ...was, [card.rowId]: e.target.value }))}
                />
                <div className={s.rowCenter} style={{ marginTop: 12, gap: 8 }}>
                  {STARTERS.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`${s.chip} ${words === st ? s.chipOn : ""}`}
                      onClick={() => setText((was) => ({ ...was, [card.rowId]: st }))}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <div className={s.rowCenter} style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className={s.btnPrimary}
                    disabled={words.trim() === "" || p.kind === "SAVING"}
                    onClick={() => void record(card, "", "", words.trim())}
                  >
                    Send this instead
                  </button>
                  <span className={s.note}>
                    {words.trim() === "" ? "Write something, or start from one of the three above." : `Nothing moves until you press this. ${words.trim().length} of ${ANSWER_MAX_CHARS} characters.`}
                  </span>
                </div>
              </div>
            )}

            {p.kind === "SAVING" && (
              <p className={`${s.note} ${s.noteTop}`} role="status">
                Recording “{p.what}”…
              </p>
            )}
            {p.kind === "FAILED" && (
              <p className={`${s.goldNote}`} role="alert">
                Not recorded. {p.says}
              </p>
            )}
            {(p.kind === "PENDING" || p.kind === "REFUSED" || p.kind === "UNCONFIRMED") && (
              <p className={s.goldNote} role="status">
                {p.kind === "PENDING" ? "Still pending. " : p.kind === "REFUSED" ? "Refused. " : "Outcome unconfirmed. "}{p.says}
              </p>
            )}
            {p.kind === "SAVED" && (
              <div className={s.divider} role="status">
                <div className={s.row} style={{ marginBottom: 12 }}>
                  <Pill tone="teal">RECORDED</Pill>
                  <strong className={s.titleStrong}>{p.quoted === null ? `You chose: ${p.what}` : "Your words are on the record"}</strong>
                  <span className={`${s.mono} ${s.pushRight}`}>{p.ref}</span>
                </div>
                {p.quoted !== null && <p className={s.record}>“{p.quoted}”</p>}
                <div className={s.stack10}>
                  <div className={s.row}>
                    <Pill tone="teal">RECORDED VERBATIM</Pill>
                    <span className={`${s.note} ${s.growWide}`}>{p.says}</span>
                  </div>
                  <div className={s.row}>
                    <Pill tone="gold">A PERSON APPLIES IT</Pill>
                    <span className={`${s.note} ${s.growWide}`}>
                      The decision sync, run by an engineering session, closes this row in your name and opens the work it implies. The runner does not apply decisions.
                    </span>
                  </div>
                  {p.quoted !== null && (
                    <div className={s.row}>
                      <Pill tone="slate">NOTHING IS INTERPRETED</Pill>
                      <span className={`${s.note} ${s.growWide}`}>
                        No supported check reads free text, so no work was created or reordered from these words. Turning an answer like this into work is MW-030 and is not built.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {props.cards.length > props.firstShown && (
        <button type="button" className={s.btnSecondary} style={{ alignSelf: "flex-start" }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? `Show the first ${props.firstShown} only` : `Show all ${props.cards.length}`}
        </button>
      )}
    </div>
  );
}
