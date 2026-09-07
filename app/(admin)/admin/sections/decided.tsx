/**
 * **WHAT BECAME OF EACH ANSWER — collapsed, and honest about how far it went.**
 * (ADM-31, ADM-32; §9A.18.)
 *
 * The receipt itself is unchanged: three steps, each with a state, from
 * `decision-receipt.ts`. What changes is the frame around it.
 *
 * The owner read the receipt and asked *"Are we done? I don't know what the
 * next steps are after that."* — so every decided row now leads with the
 * lifecycle sentence from `decision-queue.ts` (what has happened, what happens
 * next) and the three-step receipt is the detail beneath it.
 *
 * §9A.18 asks the collapsed header to say how many are decided, how many are
 * awaiting implementation, how many implemented, integrated and live. Only the
 * first two are derivable from the decision log. The rest render as **not
 * tracked from here**, with the sentence saying which record would carry them —
 * because a zero beside "implemented" is a claim, and the one thing this
 * console may not do is make a claim it cannot support.
 */
import {
  LATER_STAGES_UNKNOWN,
  STAGE_WORDS,
  decidedCounts,
  lifecycleOf,
} from "@/lib/control-plane/decision-queue.ts";
import { SYNC_CADENCE, receiptHeadline, type DecidedEntry } from "@/lib/control-plane/decision-receipt.ts";
import { FIX_QUEUE_SUBJECT, GO_FIX_OPTION, type FixQueueItem, type fixQueueView } from "@/lib/control-plane/fix-queue.ts";
import { count } from "@/lib/control-plane/plain-words.ts";

import { DECISION_ROUTE, When } from "../../console-ui.tsx";

export function DecidedSection({ decided }: { readonly decided: readonly DecidedEntry[] }) {
  const counts = decidedCounts(decided.map((d) => d.decision));
  return (
    <section className="decided" id="decided">
      <details>
        <summary>
          <h2>
            Decided <span className="dq-count">{count(counts.decided)}</span>
          </h2>
          <span className="dq-summary">
            {counts.decided === 0
              ? "Nothing decided yet. The first answer you record appears here at once."
              : `${count(counts.awaitingImplementation)} still waiting on the work they set off.`}
          </span>
        </summary>
        <p className="note" id="recorded">
          What became of each answer you recorded. A card stays here after its row has left the queue, so the receipt outlives the card.{" "}
          {SYNC_CADENCE[0].toUpperCase() + SYNC_CADENCE.slice(1)}.
        </p>
        {counts.furtherUnknown > 0 && <p className="note">{LATER_STAGES_UNKNOWN}</p>}
        {decided.map((entry) => {
          const life = lifecycleOf(entry.decision);
          const title = entry.card?.title ?? entry.decision.subjectTitle ?? entry.decision.subjectId;
          return (
            <section className="queue-card card decided-card" id={`row-${entry.decision.subjectId}`} key={entry.decision.intentId}>
              <div className="queue-head">
                <span className="queue-id" title={entry.decision.subjectId}>
                  {entry.decision.subjectId}
                </span>
                <h3>{title}</h3>
                <span className={`chip stage-${life.stage.toLowerCase()}`}>{STAGE_WORDS[life.stage]}</span>
              </div>
              <p className="queue-meta">
                Decided <When iso={entry.decision.decidedAt} />
                {entry.card ? ` · ${entry.card.priority}` : ""}
              </p>
              <p className="decided-says">{life.says}</p>
              <p className="decided-next">
                <strong>What happens next:</strong> {life.next}
              </p>
              {life.wouldTell && <p className="note">{life.wouldTell}</p>}
              <details className="status-detail">
                <summary>Technical details — {receiptHeadline(entry.steps)}</summary>
                <ol className="receipt">
                  {entry.steps.map((s) => (
                    <li key={s.key} className={`receipt-step step-${s.state.toLowerCase()}`}>
                      <i className="receipt-mark" aria-hidden="true" />
                      <span>
                        <strong>{s.label}</strong> — {s.says}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          );
        })}
      </details>
    </section>
  );
}

/** The fix queue, unchanged in behaviour — the owner likes the button (POS-16). */
export function FixQueueSection({
  items,
  counts,
  lastGo,
  returnTo,
}: {
  readonly items: readonly FixQueueItem[];
  readonly counts: ReturnType<typeof fixQueueView>["counts"];
  readonly lastGo: ReturnType<typeof fixQueueView>["lastGo"];
  readonly returnTo: string;
}) {
  const stateWords: Record<FixQueueItem["state"], string> = {
    QUEUED: "waiting for you to send the queue",
    SENT: "sent — a work row opens at the next sync",
    OPENED: "opened for a work session",
    REFUSED: "refused by the sync",
  };
  return (
    <section className="fix-queue card" id="fix-queue" aria-labelledby="fix-queue-heading">
      <div className="queue-head">
        <h3 id="fix-queue-heading">Things you asked to be fixed — {count(items.length)}</h3>
        <span className="chip">
          {counts.queued} waiting to send · {counts.sent} sent · {counts.opened} opened{counts.refused > 0 ? ` · ${counts.refused} refused` : ""}
        </span>
      </div>
      <p className="note">
        Every gap on this console carries <em>Add this to the queue</em>. <strong>Go fix these</strong> sends everything waiting: the next sync opens one
        work row per gap, in the section a session works from, and each row is listed here once it exists.{" "}
        {lastGo ? (
          <>
            Last sent <When iso={lastGo.decidedAt} />.
          </>
        ) : (
          "Nothing has been sent yet."
        )}
      </p>
      {items.length === 0 ? (
        <p className="note">The queue is empty. Add a gap from anywhere on the console.</p>
      ) : (
        <ul className="fix-items">
          {items.map((i) => (
            <li key={i.subjectId} className={`fix-item fix-${i.state.toLowerCase()}`}>
              <i className="receipt-mark" aria-hidden="true" />
              <span>
                <strong>{i.where}</strong> — {i.says}
                <small>
                  {stateWords[i.state]} · added <When iso={i.queuedAt} />
                  {i.openedWork.length > 0 ? ` · ${i.openedWork.map((w) => `${w.id} — ${w.title}`).join("; ")}` : ""}
                  {i.refusedReason ? ` · ${i.refusedReason}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form method="post" action={DECISION_ROUTE} className="go-fix">
        <input type="hidden" name="subjectId" value={FIX_QUEUE_SUBJECT} />
        <input type="hidden" name="chosenOption" value={GO_FIX_OPTION} />
        <input type="hidden" name="consequenceShown" value={`${counts.queued} queued gap(s) sent for a session to fix`} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button type="submit" className="primary" disabled={counts.queued === 0}>
          {GO_FIX_OPTION}
        </button>
        <span className="note">
          {counts.queued === 0 ? "Nothing waiting to send." : `Sends ${counts.queued} gap${counts.queued === 1 ? "" : "s"}; ${SYNC_CADENCE}.`}
        </span>
      </form>
    </section>
  );
}
