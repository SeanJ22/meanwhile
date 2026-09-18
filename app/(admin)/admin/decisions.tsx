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
  /** True when the owner may answer in his own words. */
  readonly ownWords: boolean;
  /** Null means not measured — never rendered as 0. */
  readonly blockedDescendants: number | null;
  /** The tracker row's own "Last verified" stamp, when present. */
  readonly lastVerified: string | null;
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
  heading,
  defaultOpen,
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
  readonly heading?: string;
  /** The dedicated /admin/fleet?tab=decisions surface mounts this queue as the
   *  whole tab, so it opens expanded there. The control centre keeps its
   *  collapsed-by-default (ADM-31) behaviour by leaving this unset. */
  readonly defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen ?? false);

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
        { rowId: card.rowId, title: card.title, chosen: chosenOption, state: "SAVING", says: nextStepFor(chosenOption), detail: null },
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
        const body: unknown = await res.json().catch(() => null);
        const receipt = (body as { receipt?: { says?: string; outcome?: string } } | null)?.receipt;
        if (!res.ok || receipt?.outcome === "REFUSED") {
          setDecided((was) =>
            was.map((d) =>
              d.rowId === card.rowId
                ? { ...d, state: "FAILED", says: "Not recorded.", detail: receipt?.says ?? `The server answered ${res.status}. Nothing was written, so the row is still waiting on you.` }
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
              ? { ...d, state: "FAILED", says: "Not recorded.", detail: e instanceof Error ? e.message : "The console could not reach the server. Nothing was written." }
              : d,
          ),
        );
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
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
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
          {heading ?? "Decisions waiting on you"} <span className="dq-count">{waitingNow}</span>
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
                                      ? `Rechecked on the last tracker generation: ${card.checkedThisRun}.`
                                      : "No recheck was recorded on the last tracker generation."}
                                    {card.lastVerified ? ` Last verified: ${card.lastVerified}.` : ""}{" "}
                                    This clears itself the moment the blocker stops being true; it is not a decision.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p>
                                    <strong>What is needed:</strong> {card.whatIsNeeded}
                                  </p>
                                  <p className="note">
                                    <strong>Blocked descendants:</strong>{" "}
                                    {card.blockedDescendants === null
                                      ? "not measured"
                                      : `${card.blockedDescendants} waiting behind this decision`}
                                  </p>
                                  <details>
                                    <summary>Why no machine can decide it</summary>
                                    <p>{card.whyNoMachineCanDecide}</p>
                                  </details>
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
