/**
 * **PILOT HEALTH: THE SCALE AND THE PLAIN LINE STAY; THE SHELL COMMAND GOES.**
 * (ADM-37; POS-13 is a preservation requirement.)
 *
 * The owner explicitly likes the top half of this panel — the GREEN / AMBER /
 * RED / UNKNOWN legend and the one-line reading (*"Nothing is failing, but
 * READER, TRUTH, FRESHNESS are not proven yet"*). POS-13 says keep them, so
 * they are untouched.
 *
 * What changes is the bottom half. The card used to end with:
 *
 * > `Next: To prove it: run the reader suite again (`pnpm reader:suite`).`
 *
 * and the owner's answer was *"What has to happen? Think of someone who is not
 * an engineer and not a coder at all."* A shell command is not an answer to a
 * person who cannot run one.
 *
 * So each card ends with a plain next step and the control that actually
 * advances it — and where no control exists, it says so instead of offering a
 * button that would do nothing. FRESHNESS has one: `RUN_CYCLE_NOW` is a real
 * owner intent the standing runner honours. READER and TRUTH do not: those
 * proofs are produced by a work session on the runner machine and nothing
 * schedules them, so the honest control is the fix queue, which does get a
 * session to run them.
 */
import type { HealthLevel } from "@/lib/control-plane/owner-surface.ts";
import { nextStepFor, type PlainContract } from "@/lib/control-plane/plain-health.ts";

import { Band, HealthScale, QueueButton, Said, When } from "../../console-ui.tsx";
import { NeedsYouLine } from "../../status-ui.tsx";

export interface HealthCardView {
  readonly plain: PlainContract;
  /** The count, when the contract has one: "1 of 7". */
  readonly score: string | null;
  /** How old the newest proof is, in plain words. */
  readonly proofAge: string | null;
  /** The instrument's own sentence, for the disclosure. */
  readonly instrument: string | null;
  /** The proof class and run identity, for the disclosure. */
  readonly provenance: string | null;
}

export interface HealthSectionProps {
  readonly overall: HealthLevel;
  readonly overallSays: string;
  readonly cards: readonly HealthCardView[];
  readonly publishedAt: string | null;
  readonly publisher: string | null;
  readonly publishedFromSha: string | null;
  readonly snapshotNote: string | null;
  readonly intentRoute: string;
  readonly returnTo: string;
}

export function HealthSection(props: HealthSectionProps) {
  return (
    <>
      <h1>
        Pilot health <Band level={props.overall}>{props.overall === "UNKNOWN" ? "NO READING" : props.overall}</Band>
      </h1>
      <HealthScale />
      <p className="ph-overall">{props.overallSays}</p>
      {props.snapshotNote && <p className="note">{props.snapshotNote}</p>}

      <div className="ph-cards">
        {props.cards.map((card) => {
          const step = nextStepFor(card.plain.contract);
          return (
            <section key={card.plain.contract} className={`ph-card card l-${card.plain.level}`}>
              <div className="ph-head">
                <h2>{card.plain.contract}</h2>
                <Band level={card.plain.level}>{card.plain.level === "GREEN" ? "PROVEN" : card.plain.level === "RED" ? "FAILING" : "NOT YET PROVEN"}</Band>
              </div>

              {/* 1 — what this is */}
              <p className="ph-what">{card.plain.what}</p>
              {/* 2 — what happened */}
              <p className="ph-status">
                <strong>{card.plain.status}</strong> {card.plain.why}
              </p>
              {/* 3 — does this need you */}
              <NeedsYouLine
                needs={
                  card.plain.level === "GREEN"
                    ? { needed: false }
                    : { needed: true, action: step.control === "RUN_CYCLE" ? "let a cycle run, or start one now" : "put this check on the queue so a session runs it" }
                }
              />
              {/* 4 — what happens next, with the control that does it */}
              <p className="ph-next">
                <strong>What happens next:</strong> {step.says}
              </p>
              {card.plain.level !== "GREEN" && (
                <div className="ph-control">
                  {step.control === "RUN_CYCLE" ? (
                    <form method="post" action={props.intentRoute}>
                      <input type="hidden" name="action" value="RUN_CYCLE_NOW" />
                      <input type="hidden" name="returnTo" value={props.returnTo} />
                      <button type="submit" className="primary">
                        Start a cycle now
                      </button>
                      <span className="note">{step.expectation}</span>
                    </form>
                  ) : (
                    <>
                      <QueueButton where={`Pilot health · ${card.plain.contract}`} says={step.says} />
                      <span className="note">{step.expectation}</span>
                    </>
                  )}
                </div>
              )}

              {card.proofAge && <p className="ph-age">{card.proofAge}</p>}

              <details className="status-detail">
                <summary>Technical details</summary>
                {card.instrument && (
                  <p className="note">
                    <Said text={card.instrument} />
                  </p>
                )}
                {card.provenance && (
                  <p className="note">
                    <Said text={card.provenance} />
                  </p>
                )}
                {card.score && <p className="note">Score on the newest run: {card.score}.</p>}
              </details>
            </section>
          );
        })}
      </div>

      {props.publishedAt && (
        /*
         * ADM-25 and ADM-44: this line used to read "by pnpm owner:publish at
         * commit 1aa7b9fc" — a shell command and a hash, on the face, in the
         * one sentence that is supposed to tell him how fresh the page is. The
         * publisher's own name and the commit are the machine's identity for
         * this reading and belong on the hover.
         */
        <p
          className="note ph-published"
          title={[props.publisher ? `published by ${props.publisher}` : null, props.publishedFromSha ? `at commit ${props.publishedFromSha}` : null]
            .filter(Boolean)
            .join(" ")}
        >
          Last updated <When iso={props.publishedAt} />. The runner writes this again after every cycle it runs.
        </p>
      )}
    </>
  );
}
