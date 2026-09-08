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
          {/*
            ADM-56 — A SENTENCE THAT COULD NOT SAY ANYTHING ELSE.

            This read "N still waiting on the work they set off", and N was
            arithmetically identical to the total: every branch of `lifecycleOf`
            returns DECIDED or QUEUED, and `awaitingImplementation` counts
            exactly that union. It could never report anything but the whole
            list, and it implied a thing that had not happened — that recording
            an answer had SET WORK OFF.

            Nothing in the scheduler, the workers or the agents reads the
            tracker stores, so a recorded decision terminates as a durable row
            waiting for a session to pick it up. That is a real and defensible
            design; presenting it as work already in motion is not.

            So the sentence says what is true, and the count that carries no
            information is gone rather than dressed up.
          */}
          <span className="dq-summary">
            {counts.decided === 0
              ? "Nothing decided yet. The first answer you record appears here at once."
              : `${count(counts.decided)} recorded and durable. None of them starts work by itself.`}
          </span>
        </summary>
        <p className="note" id="recorded">
          What became of each answer you recorded. A card stays here after its row has left the queue, so the receipt outlives the card.{" "}
          {SYNC_CADENCE[0].toUpperCase() + SYNC_CADENCE.slice(1)}.
        </p>
        {/*
          ADM-56. The owner, having ruled that a photograph was approved:
          *"That needs to be resolved, right? You need to then go grab that
          picture, put it on Dr. Trujillo."*

          It does need to be, and it is not what happens today. The chain that
          exists is intent, pull, tracker close, decided row, receipt — a
          RECORDING chain, complete and durable. The chain the owner is
          describing continues into execution, and nothing reads the tracker
          stores to start it.

          Saying so is the whole of the fix in this pass. The alternative was a
          page that implies the work is moving, which is the failure he has now
          hit three times: a surface that looks like it did something.
        */}
        <p className="note">
          Recording an answer closes the row in your name and makes the decision durable. It does not carry
          the work out: nothing here dispatches a worker, and the work an answer implies is picked up by a
          later session rather than by the runner. When that changes, this line changes with it.
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
