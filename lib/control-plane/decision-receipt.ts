/**
 * **WHAT HAPPENED TO THE ANSWER THE OWNER RECORDED — three steps, each with a
 * state.** (ADM-16, the 9.4.26 evening admin feedback.)
 *
 * The owner's question, verbatim: *"If I select something, where do these
 * things go? Does it update the tracker? Does it remove the row?"* And the
 * closing line of the session: *"Make sure decisions are flowing somewhere
 * and I'm not just marking them independently in the site and nothing
 * happens to it."*
 *
 * The path exists — intent → `pnpm owner:decisions:pull` → `tracker:move` →
 * `owner:canonicalize` — and the page said so in one sentence. What it did not
 * do was SHOW him each leg landing. This module is the receipt: from one
 * collapsed decision it derives the three legs he asked about and the state of
 * each, so the card can say "recorded · closed in the tracker as … · work
 * opened as …" and never "recorded; trust us".
 *
 * ```
 *   RECORDED   always DONE for a decision that exists at all (the log is the
 *              record; a failed write never redirects to a page that shows it)
 *   TRACKER    WAITING until the sync has applied it; DONE with the resolved
 *              row's reference once the canonicalizer recorded the close;
 *              REFUSED when the gates refused the close, with the reason
 *   WORK       WAITING while the tracker leg waits; DONE with the follow-up
 *              row(s) once opened; DONE "no work implied" for a decline/defer/
 *              acknowledge option, which closes the row and opens nothing
 * ```
 *
 * PURE: one decision in, three steps out. The clock is a parameter.
 */
import { isRowDecision } from "./fix-queue.ts";
import { ANSWERED_IN_OWN_WORDS, type OwnerDecisionCard, type OwnerDecisionIntent } from "./owner-surface.ts";

/**
 * The tracker applier's own rule for an option that implies no work
 * (`NO_FOLLOW_UP_OPTION` in `scripts/tracker-core.mjs`). Repeated here rather
 * than imported, because this module is bundled into the admin page and a
 * script that reads the tracker must never ride into a Netlify function;
 * `tests/admin-feedback-9-4-pm.test.ts` asserts the two agree.
 */
export const NO_FOLLOW_UP_OPTION = /^(decline|defer|refuse|open none|say it is no longer|acknowledge|confirm)\b/i;

export type ReceiptState = "DONE" | "WAITING" | "REFUSED";

export interface ReceiptStep {
  readonly key: "recorded" | "tracker" | "work";
  readonly label: string;
  readonly state: ReceiptState;
  /** One plain sentence. */
  readonly says: string;
}

/** How the next sync is described while a leg waits. One sentence, used everywhere. */
export const SYNC_CADENCE =
  "the standing runner applies recorded decisions to the tracker after every cycle it runs (about every twenty minutes while it is running)";

function chosen(d: OwnerDecisionIntent): string {
  if (d.chosenOption === ANSWERED_IN_OWN_WORDS) return `you answered in your own words: "${d.ownerAnswer ?? ""}"`;
  return `you chose "${d.chosenOption}"${d.ownerAnswer ? ` and wrote: "${d.ownerAnswer}"` : ""}`;
}

/** Does the chosen option imply no follow-up work (the tracker applier's own rule)? */
export function impliesNoWork(d: Pick<OwnerDecisionIntent, "chosenOption">): boolean {
  return d.chosenOption !== ANSWERED_IN_OWN_WORDS && NO_FOLLOW_UP_OPTION.test(d.chosenOption);
}

export function decisionReceipt(d: OwnerDecisionIntent): readonly ReceiptStep[] {
  const recorded: ReceiptStep = {
    key: "recorded",
    label: "Recorded",
    state: "DONE",
    says: `${chosen(d)}. Recorded in the control plane at once, under your admin session.`,
  };

  if (d.state === "REJECTED_BY_GATES") {
    const reason = d.refusedReason ?? "no reason was recorded";
    return [
      recorded,
      { key: "tracker", label: "Tracker", state: "REFUSED", says: `The sync refused to apply it: ${reason}. The row stays open and the decision stays on record.` },
      { key: "work", label: "Work", state: "REFUSED", says: "Nothing was opened, because the close was refused." },
    ];
  }

  if (d.state === "CANONICALIZED") {
    const opened = d.openedWork ?? [];
    const ref = d.canonicalRef;
    const tracker: ReceiptStep = {
      key: "tracker",
      label: "Tracker",
      state: "DONE",
      says:
        ref === null
          ? "Closed in the tracker; the sync recorded the close without a row reference."
          : /\.csv#/.test(ref)
            ? `Closed in the tracker as ${ref}. This row has left the queue.`
            : /^R-\d+$/.test(ref)
              ? `Recorded against ruling ${ref} in the governance ledger; the tracker row it answers closes under that ruling.`
              : `Applied as ${ref}.`,
    };
    const work: ReceiptStep =
      opened.length > 0
        ? {
            key: "work",
            label: "Work",
            state: "DONE",
            says: `Work opened for a session: ${opened.map((w) => `${w.id} — ${w.title}`).join("; ")}.`,
          }
        : impliesNoWork(d)
          ? { key: "work", label: "Work", state: "DONE", says: "No work is implied by this choice; the row closed on the decision and nothing was opened." }
          : { key: "work", label: "Work", state: "DONE", says: "The sync recorded the close and no follow-up row; the work this choice implies was not minted (a refusal would be listed on the runner's console line)." };
    return [recorded, tracker, work];
  }

  // RECORDED / PENDING_CANONICALIZATION: the two later legs wait on the sync.
  return [
    recorded,
    { key: "tracker", label: "Tracker", state: "WAITING", says: `Waiting for the next sync — ${SYNC_CADENCE}. The row closes in docs/tracker-working.csv then, in your name.` },
    {
      key: "work",
      label: "Work",
      state: "WAITING",
      says: impliesNoWork(d)
        ? "This choice implies no work: the row will close and nothing will be opened."
        : "The work this choice implies is opened for a session in the same sync, as a row that names this decision.",
    },
  ];
}

/** The one-line state of a decision, for a list. */
export function receiptHeadline(steps: readonly ReceiptStep[]): string {
  const tracker = steps.find((s) => s.key === "tracker");
  const work = steps.find((s) => s.key === "work");
  if (tracker?.state === "REFUSED") return "recorded · refused by the gates";
  if (tracker?.state === "DONE" && work?.state === "DONE") return "recorded · closed in the tracker · work opened";
  return "recorded · waiting for the next sync";
}

/* ------------------------------------------------------------ the split */

export interface DecidedEntry {
  /** The card, when the snapshot still carries it; null once the row has left the working store. */
  readonly card: OwnerDecisionCard | null;
  readonly decision: OwnerDecisionIntent;
  readonly steps: readonly ReceiptStep[];
}

/**
 * Split the published cards against the live decision log: a card with a
 * recorded decision is DECIDED and leaves the "waiting on you" count at once,
 * whatever the sync has done since; a card without one is still waiting.
 *
 * Decisions whose card has already left the snapshot (the sync closed the row
 * and the runner republished) are still listed, from the log alone, so the
 * receipt survives the card.
 */
export function splitDecided(
  cards: readonly OwnerDecisionCard[],
  collapsed: readonly OwnerDecisionIntent[],
): { readonly waiting: readonly OwnerDecisionCard[]; readonly decided: readonly DecidedEntry[] } {
  const latestBySubject = new Map<string, OwnerDecisionIntent>();
  for (const d of collapsed) {
    if (!isRowDecision(d)) continue;
    const held = latestBySubject.get(d.subjectId);
    if (!held || held.decidedAt < d.decidedAt) latestBySubject.set(d.subjectId, d);
  }
  const waiting = cards.filter((c) => !latestBySubject.has(c.rowId));
  const cardById = new Map(cards.map((c) => [c.rowId, c]));
  const decided = [...latestBySubject.values()]
    .map((decision): DecidedEntry => ({
      card: cardById.get(decision.subjectId) ?? null,
      decision,
      steps: decisionReceipt(decision),
    }))
    .sort((a, b) => (a.decision.decidedAt < b.decision.decidedAt ? 1 : a.decision.decidedAt > b.decision.decidedAt ? -1 : 0));
  return { waiting, decided };
}
