"use client";

/**
 * **THE DECISION QUEUE THAT VISIBLY MOVES WHEN YOU DECIDE.** (ADM-31, ADM-32;
 * §9A.8. Critical, and the third pass on the same complaint.)
 *
 * The owner, 2026-09-06, having recorded three decisions:
 *
 * > *"When I click on one it doesn't look like anything happens. Nothing
 * > disappears. It doesn't say 'decided.' It doesn't move. It just looks like
 * > I'm clicking on nothing."*
 *
 * ## Why the old version looked dead when it was working
 *
 * Every option was its own `<form method="post">`. The browser navigated, the
 * route wrote the intent, and answered a 303 back to `/admin` — a whole new
 * server render of a thirty-eight-thousand-pixel page, landing at the top,
 * seventy-eight cards down from the one he clicked. The card really had moved.
 * He could not possibly have seen it.
 *
 * ## What this does instead
 *
 * The submit is a `fetch`, and the card changes **before** the network answers:
 *
 * ```
 *   0 ms      the card says "Decided", turns, and collapses out of the list
 *             the waiting count in the header drops
 *             a plain next-step line appears, and an Undo
 *   ~200 ms   the write lands; the line firms up with what the sync will do
 *   on error  the card comes BACK, with what went wrong. Nothing is lost and
 *             nothing is claimed that did not happen.
 * ```
 *
 * ## Undo is a correction, never an erasure
 *
 * §9A.8: *"Do not erase append-only history."* The decision log is append-only
 * by construction — `lib/control-plane/decision-log.ts` collapses an original
 * and a later superseding record rather than deleting either. So Undo posts a
 * SUPERSEDING record; the original stays on the log and stays readable. The
 * button is offered only while the browser still holds the record it wrote, so
 * the console never offers an undo it cannot actually perform.
 *
 * ## Collapsed by default (ADM-31)
 *
 * *"I would like the entire list to be collapsible … It should default to
 * collapsed and I should be able to expand it. Once it's expanded it should
 * break them out by priority."* So: one header with the count, then priority
 * groups, then owner-type groups, then title lines. A card's body opens on
 * click. Nothing is removed — seventy-eight cards are still all there.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { addresses, currentFragment } from "../reveal.tsx";

import {
  OWNER_TYPE_WORDS,
  type OwnerType,
} from "@/lib/control-plane/decision-queue.ts";
import { readRefusal } from "@/lib/control-plane/admin-refusal.ts";

/** One waiting card, flattened by the server into what the island needs. */
export interface WaitingCardView {
  readonly rowId: string;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  readonly meta: string;
  readonly priority: string;
  readonly type: OwnerType;
  /** BLOCKED_WHILE cards carry a blocker and no options. */
  readonly blocker: string | null;
  readonly checkedThisRun: string | null;
  /**
   * The tracker row's own "Last verified" stamp (ADM-50).
   *
   * It has been on `OwnerDecisionCard` all along and was never rendered, so a
   * wall could show a blocker with no indication of when anything had last
   * looked at it.
   */
  readonly lastVerified: string | null;
  /** True when the owner may answer in his own words. */
  readonly ownWords: boolean;
}

export interface PriorityGroupView {
  readonly priority: string;
  readonly count: number;
  readonly types: readonly { readonly type: OwnerType; readonly cards: readonly WaitingCardView[] }[];
}

/** What the console did with a decision the owner just recorded, in this tab. */
interface JustDecided {
  readonly rowId: string;
  readonly title: string;
  readonly chosen: string;
  readonly state: "SAVING" | "SAVED" | "FAILED" | "UNDOING" | "UNDONE";
  readonly says: string;
  readonly detail: string | null;
  /**
   * ADM-49. What the owner can DO about a refusal, and which control to offer.
   *
   * The old card had `detail` and nothing else, so a refusal it could not
   * explain became `The server answered 401` — a number the owner read as a
   * verdict on his decision. These three fields are what turns that into a
   * sentence and a door.
   */
  readonly whatToDo: string | null;
  /** Offer "Sign in again" — only when signing in is actually the fix. */
  readonly offerSignIn: boolean;
  /**
   * The exact submission that failed, so Try again re-runs THAT and not a
   * reconstruction of it. Held as its arguments rather than as a closure over
   * `record`, which would make `record` depend on itself.
   */
  readonly retry: { readonly card: WaitingCardView; readonly chosenOption: string; readonly ownerAnswer: string | null } | null;
}

const ANSWER_MAX = 4000;

/** The next-step sentence for a choice, before the sync has run. */
function nextStepFor(chosen: string): string {
  if (/^(decline|defer|refuse|open none|say it is no longer|acknowledge|confirm)\b/i.test(chosen)) {
    return "Done — nothing else is needed from you. The row closes on the next runner cycle and nothing is opened.";
  }
  return "Decision recorded. The next runner cycle closes the row in your name and opens the work this implies; you will see it on the work queue.";
}

export function DecisionQueue({
  groups,
  total,
  summary,
  actionRoute,
  returnTo,
  stateVersion,
}: {
  readonly groups: readonly PriorityGroupView[];
  readonly total: number;
  readonly summary: string;
  /** The one gateway route both the buttons and the chat use. */
  readonly actionRoute: string;
  readonly returnTo: string;
  /**
   * The revision the page was drawn from. `decision.record` declares
   * `requiresStateVersion`, so the gateway refuses a submission that quotes
   * nothing — and refuses one quoting a revision the world has moved past,
   * which is the whole point: an answer to a card drawn ten minutes ago,
   * against a queue that has since changed, is not the answer he thinks it is.
   */
  readonly stateVersion: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /**
   * OPEN WHEN THIS IS WHERE HE WAS SENT. (9.6.26 owner feedback, ACLOSE-6.)
   *
   * Collapsed by default is deliberate (ADM-31) and stays that way. But the
   * command centre's *"What is blocked?"* card counts these rows and its Open
   * control now lands on `#blocked`, the region this queue sits inside — and
   * arriving at a shut disclosure that shows only a count is the same no-op the
   * dead anchor was. `RevealTarget` opens the plain `<details>` around it
   * through the DOM; this queue owns its open state in React, so it watches the
   * fragment itself rather than being reached into.
   *
   * It only ever opens. A hash change never re-collapses a queue the owner
   * opened himself.
   */
  useEffect(() => {
    const reveal = (): void => {
      if (addresses("blocked", ["decisions"], currentFragment())) setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  const [decided, setDecided] = useState<readonly JustDecided[]>([]);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  /** ADM-50: which wall is being asserted, and what the server said about each. */
  const [asserting, setAsserting] = useState<string | null>(null);
  const [assertSays, setAssertSays] = useState<Readonly<Record<string, string>>>({});

  const goneRows = useMemo(
    () => new Set(decided.filter((d) => d.state !== "FAILED" && d.state !== "UNDONE").map((d) => d.rowId)),
    [decided],
  );
  const waitingNow = total - goneRows.size;

  const record = useCallback(
    async (card: WaitingCardView, chosenOption: string, ownerAnswer: string | null) => {
      // The card leaves the list and says so BEFORE the network is asked. This
      // is the whole defect: the write was always fine; the silence was not.
      setDecided((was) => [
        {
          rowId: card.rowId,
          title: card.title,
          chosen: chosenOption,
          state: "SAVING",
          says: nextStepFor(chosenOption),
          detail: null,
          whatToDo: null,
          offerSignIn: false,
          retry: null,
        },
        ...was.filter((d) => d.rowId !== card.rowId),
      ]);
      setOpenCard(null);
      try {
        const res = await fetch(actionRoute, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            type: "decision.record",
            subject: card.rowId,
            input: { subjectId: card.rowId, chosenOption, consequenceShown: card.options.find((o) => o.option === chosenOption)?.consequence ?? "", ownerAnswer },
            idempotencyKey: `${card.rowId}:${chosenOption}:${ownerAnswer ?? ""}`,
            stateVersion,
            returnTo,
          }),
        });
        /*
         * ADM-49: the content type is read BEFORE the body, because the case
         * that hurt most is the one where `res.json()` throws — a refusal from
         * something in front of the console, which used to collapse into the
         * same bare status as every other failure.
         */
        const contentType = res.headers.get("content-type");
        const body: unknown = await res.json().catch(() => null);
        const receipt = (body as { receipt?: { says?: string; outcome?: string } } | null)?.receipt;
        if (!res.ok || receipt?.outcome === "REFUSED") {
          /*
           * A receipt means the gateway LOOKED at the request and refused it on
           * the merits — that is an answer about the decision, and it is the
           * right sentence. Everything else is a refusal before the gateway,
           * which is about the session or the console, and `readRefusal` is the
           * one reader for those (RULING 103).
           */
          const resolved =
            typeof receipt?.says === "string" && receipt.says.trim() !== ""
              ? { says: receipt.says, whatToDo: null, offerSignIn: false, offerRetry: false }
              : readRefusal({ status: res.status, body, contentType });
          setDecided((was) =>
            was.map((d) =>
              d.rowId === card.rowId
                ? {
                    ...d,
                    state: "FAILED",
                    says: "Not recorded.",
                    detail: resolved.says,
                    whatToDo: resolved.whatToDo,
                    offerSignIn: resolved.offerSignIn,
                    // Nothing was written, so re-running the identical
                    // submission is safe: the gateway is idempotent on the key.
                    retry: { card, chosenOption, ownerAnswer },
                  }
                : d,
            ),
          );
          return;
        }
        setDecided((was) => was.map((d) => (d.rowId === card.rowId ? { ...d, state: "SAVED", detail: receipt?.says ?? null } : d)));
        // Pull the server's own view in the background so the Decided list and
        // the receipt below are the durable record, not this tab's memory.
        router.refresh();
      } catch (e) {
        setDecided((was) =>
          was.map((d) =>
            d.rowId === card.rowId
              ? {
                  ...d,
                  state: "FAILED",
                  says: "Not recorded.",
                  /*
                   * ADM-49: a thrown fetch is a REACHABILITY failure, and its
                   * `message` is browser text ("Failed to fetch") that means
                   * nothing to the owner. Say the fact instead and keep the
                   * machine's words in the disclosure below.
                   */
                  detail: "The console could not reach the server at all, so nothing was written.",
                  whatToDo:
                    e instanceof Error
                      ? `Check the connection and try again. The browser said: ${e.message}`
                      : "Check the connection and try again.",
                  offerSignIn: false,
                  retry: { card, chosenOption, ownerAnswer },
                }
              : d,
          ),
        );
      }
    },
    [actionRoute, returnTo, router, stateVersion],
  );

  /**
   * ADM-50 — "I did this — recheck now".
   *
   * It records the owner's assertion and says what will and will not follow.
   * Deliberately NOT optimistic: the other controls on this page move the card
   * before the network answers because the write was always fine and only the
   * silence was wrong. Here the card genuinely must not move — the wall stays
   * up until the check itself disagrees — so showing it leave would be the
   * blind trust the row forbids.
   */
  const assertDone = useCallback(
    async (card: WaitingCardView) => {
      setAsserting(card.rowId);
      setAssertSays((was) => ({ ...was, [card.rowId]: "Recording…" }));
      try {
        const res = await fetch(actionRoute, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            type: "wall.recheck",
            subject: card.rowId,
            input: { rowId: card.rowId },
            idempotencyKey: `${card.rowId}:wall-recheck`,
            stateVersion,
            returnTo,
          }),
        });
        const contentType = res.headers.get("content-type");
        const body: unknown = await res.json().catch(() => null);
        const receipt = (body as { receipt?: { says?: string } } | null)?.receipt;
        if (!res.ok) {
          const refusal = readRefusal({ status: res.status, body, contentType });
          setAssertSays((was) => ({
            ...was,
            [card.rowId]: refusal.whatToDo === null ? refusal.says : `${refusal.says} ${refusal.whatToDo}`,
          }));
          return;
        }
        setAssertSays((was) => ({ ...was, [card.rowId]: receipt?.says ?? "Recorded." }));
        router.refresh();
      } catch (e) {
        setAssertSays((was) => ({
          ...was,
          [card.rowId]: `Nothing was recorded — the console could not reach the server${e instanceof Error ? ` (${e.message})` : ""}.`,
        }));
      } finally {
        setAsserting(null);
      }
    },
    [actionRoute, returnTo, router, stateVersion],
  );

  const undo = useCallback(
    async (entry: JustDecided) => {
      setDecided((was) => was.map((d) => (d.rowId === entry.rowId ? { ...d, state: "UNDOING" } : d)));
      try {
        const res = await fetch(actionRoute, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            type: "decision.record",
            subject: entry.rowId,
            input: {
              subjectId: entry.rowId,
              chosenOption: "Change my answer",
              consequenceShown: "This supersedes the answer recorded a moment ago. The original stays on the record.",
              ownerAnswer: `Superseding my previous answer ("${entry.chosen}") — I want to answer this again.`,
            },
            idempotencyKey: `${entry.rowId}:undo:${entry.chosen}`,
            stateVersion,
            returnTo,
          }),
        });
        if (!res.ok) {
          /*
           * ADM-49 (class): "Change my answer" had the same defect as the
           * record path and was missed on the first pass — the class guard in
           * tests/admin-refusal-adm49.test.ts found it. A superseding answer
           * refused for a signed-out session must say so, not print a number.
           */
          const contentType = res.headers.get("content-type");
          const body: unknown = await res.json().catch(() => null);
          const refusal = readRefusal({ status: res.status, body, contentType });
          throw new Error(refusal.whatToDo === null ? refusal.says : `${refusal.says} ${refusal.whatToDo}`);
        }
        setDecided((was) =>
          was.map((d) =>
            d.rowId === entry.rowId
              ? { ...d, state: "UNDONE", says: "Your change is on the record. The original answer stays on the log — nothing is erased — and the row is back on the list.", detail: null }
              : d,
          ),
        );
        router.refresh();
      } catch (e) {
        setDecided((was) =>
          was.map((d) => (d.rowId === entry.rowId ? { ...d, state: "SAVED", detail: `The change was not recorded: ${e instanceof Error ? e.message : "unknown"}.` } : d)),
        );
      }
    },
    [actionRoute, returnTo, router, stateVersion],
  );

  return (
    <section className="dq" aria-labelledby="dq-heading">
      <button type="button" className="dq-header" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="dq-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <h2 id="dq-heading">
          Decisions waiting on you <span className="dq-count">{waitingNow}</span>
        </h2>
        <span className="dq-summary">{summary}</span>
      </button>

      {decided.length > 0 && (
        <ul className="dq-just" aria-live="polite">
          {decided.map((d) => (
            <li key={d.rowId} className={`dq-just-row dq-${d.state.toLowerCase()}`}>
              <i className="dq-mark" aria-hidden="true" />
              <span className="dq-just-text">
                <strong>
                  {d.state === "FAILED" ? "Not recorded" : d.state === "UNDONE" ? "Back on your list" : "Decided"} — {d.title}
                </strong>
                <span className="dq-next">{d.says}</span>
                {d.detail && <span className="dq-detail">{d.detail}</span>}
                {/*
                  ADM-49: what to do about it, and the door. The owner read a red
                  dot beside "401" as the console rejecting his decision; a
                  refusal that offers no next step invites exactly that reading.
                */}
                {d.whatToDo && <span className="dq-detail">{d.whatToDo}</span>}
                {(d.offerSignIn || d.retry) && (
                  <span className="dq-fix">
                    {d.offerSignIn && (
                      <a className="dq-signin" href="/admin/login">
                        Sign in again
                      </a>
                    )}
                    {d.retry && (
                      <button
                        type="button"
                        className="dq-retry"
                        onClick={() => {
                          const again = d.retry;
                          if (again) void record(again.card, again.chosenOption, again.ownerAnswer);
                        }}
                      >
                        Try again
                      </button>
                    )}
                  </span>
                )}
              </span>
              {(d.state === "SAVED" || d.state === "SAVING") && (
                <button type="button" className="dq-undo" onClick={() => void undo(d)}>
                  Change my answer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open &&
        (waitingNow === 0 ? (
          <p className="note">Nothing is waiting on you.</p>
        ) : (
          groups.map((g) => {
            const visible = g.types
              .map((t) => ({ ...t, cards: t.cards.filter((c) => !goneRows.has(c.rowId)) }))
              .filter((t) => t.cards.length > 0);
            if (visible.length === 0) return null;
            const count = visible.reduce((n, t) => n + t.cards.length, 0);
            return (
              <div key={g.priority} className="dq-priority">
                <h3>
                  {g.priority} <span className="dq-count">{count}</span>
                </h3>
                {visible.map((t) => (
                  <div key={t.type} className="dq-type">
                    <h4>
                      {OWNER_TYPE_WORDS[t.type].title} <span className="dq-count">{t.cards.length}</span>
                      <span className="dq-type-means">{OWNER_TYPE_WORDS[t.type].means}</span>
                    </h4>
                    <ul className="dq-cards">
                      {t.cards.map((card) => (
                        <li key={card.rowId} className={`dq-card${openCard === card.rowId ? " dq-card-open" : ""}`} id={`row-${card.rowId}`}>
                          <button
                            type="button"
                            className="dq-title"
                            aria-expanded={openCard === card.rowId}
                            onClick={() => setOpenCard((c) => (c === card.rowId ? null : card.rowId))}
                          >
                            <span className="dq-rowid">{card.rowId}</span>
                            <span className="dq-card-title">{card.title}</span>
                            <span className="dq-meta">{card.meta}</span>
                          </button>
                          {openCard === card.rowId && (
                            <div className="dq-body">
                              {card.blocker ? (
                                <>
                                  <p>
                                    <strong>Blocked while</strong> {card.blocker}
                                  </p>
                                  <p className="note">
                                    {card.checkedThisRun
                                      ? `What the check last found: ${card.checkedThisRun}.`
                                      : "No recheck is recorded against this wall."}
                                    {card.lastVerified ? ` Last verified ${card.lastVerified}.` : ""}
                                  </p>
                                  {/*
                                    ADM-50. The owner: *"I actually already
                                    rotated these keys, this is completely done
                                    and resolved, but there's no way for me to
                                    click anything to say hey, this is actually
                                    good now."*

                                    The old copy said this "clears itself the
                                    moment the blocker stops being true", which
                                    is true of the PREDICATE and false about
                                    when anyone would find out. The check is
                                    re-evaluated by `scripts/tracker.mjs views`,
                                    which writes docs/tracker-reconciliation.json;
                                    the owner snapshot publisher only READS that
                                    file, and the runner's cycle does not run
                                    the re-evaluation at all. So a wall can stay
                                    up long after its blocker is gone, and
                                    nothing on this page was admitting it.
                                  */}
                                  <p className="note">
                                    This clears when the check re-reads its evidence and disagrees with the wall — not
                                    when the blocker stops being true. That re-read happens when the tracker views are
                                    regenerated from the repository, and nothing in the runner&rsquo;s cycle does it
                                    today, so it waits for a work session.
                                  </p>
                                  <div className="dq-fix">
                                    <button
                                      type="button"
                                      className="primary"
                                      disabled={asserting === card.rowId}
                                      onClick={() => void assertDone(card)}
                                    >
                                      {asserting === card.rowId ? "Recording…" : "I did this — recheck now"}
                                    </button>
                                  </div>
                                  {assertSays[card.rowId] && (
                                    <p className="note">{assertSays[card.rowId]}</p>
                                  )}
                                </>
                              ) : (
                                <>
                                  <p>
                                    <strong>What is needed:</strong> {card.whatIsNeeded}
                                  </p>
                                  <details>
                                    <summary>Why no machine can decide it</summary>
                                    <p>{card.whyNoMachineCanDecide}</p>
                                  </details>
                                  {/*
                                    ADM-55. The owner, on NH274: *"if I click
                                    'Supply it / rule on it', does it go install
                                    Tesseract, or do I need to install
                                    something? I don't really know what it's
                                    asking for."*

                                    That question has one answer and it is the
                                    same for every option on every card, so it
                                    is stated once here rather than guessed at
                                    per row: recording an answer RECORDS A
                                    RULING and runs nothing. It is not authored
                                    copy — it is what the code does. The write
                                    path appends an intent and stops, and the
                                    work it implies is opened by a later runner
                                    cycle. Saying it plainly is the difference
                                    between an owner who knows he still has to
                                    install Tesseract and one who thinks the
                                    button did it.
                                  */}
                                  <p className="dq-what-click">
                                    Choosing an option records your ruling. It does not carry the work out by itself: what
                                    it does is close this row in your name and let the next runner cycle open the work your
                                    answer implies. If something has to be done on a machine first, it still has to be done.
                                  </p>
                                  <div className="dq-options">
                                    {card.options.map((o) => (
                                      <button
                                        key={o.option}
                                        type="button"
                                        className="option"
                                        onClick={() => void record(card, o.option, answers[card.rowId]?.trim() || null)}
                                      >
                                        {o.option}
                                        <span className="consequence">{o.consequence}</span>
                                      </button>
                                    ))}
                                  </div>
                                  {card.ownWords && (
                                    <div className="own-words">
                                      <label htmlFor={`ow-${card.rowId}`}>Or answer in your own words</label>
                                      <textarea
                                        id={`ow-${card.rowId}`}
                                        maxLength={ANSWER_MAX}
                                        value={answers[card.rowId] ?? ""}
                                        onChange={(e) => setAnswers((a) => ({ ...a, [card.rowId]: e.target.value }))}
                                      />
                                      <button
                                        type="button"
                                        className="primary"
                                        disabled={(answers[card.rowId] ?? "").trim() === ""}
                                        onClick={() => void record(card, "", answers[card.rowId]?.trim() ?? null)}
                                      >
                                        Record my answer
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })
        ))}
    </section>
  );
}
