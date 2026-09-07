/**
 * **ONE ROLE PER CARD: ONE NAME, ONE SENTENCE, AND WHETHER IT NEEDS YOU.**
 * (ADM-10 and ADM-12 from the 9.4.26 evening feedback; ADM-43, ADM-44, ADM-48
 * and §9A.20 from the 9.6.26 owner review.)
 *
 * Each role section leads with the role's single owner-facing NAME and the one
 * sentence that says what it does — the owner, verbatim: *"it should just
 * simply say Detectives … and next to it in smaller font I want to say, 'What
 * is that? What does that mean? What does a detective do?'"* The two codes
 * that used to sit in the heading (`Parsers PARSER · DETECTIVES`) are gone:
 * the name comes from `fleet-wording.ts`, which derives it from the console's
 * one translation layer, and the fleet grouping is said in a sentence rather
 * than printed as a second code.
 *
 * `Needs you` sits at the TOP of every card, which the owner named as the one
 * thing on this page he liked (POS-14), and the panel says it once for the
 * whole fleet before he reads a single card.
 *
 * Every attempt row answers his three questions — what happened, what happens
 * next, does this need me — through `lib/control-plane/plain-work.ts`. The
 * distinction that module enforces is the one he insisted on: an ATTEMPT can
 * complete while the GOAL stays open, and a public record is never presented
 * as permanently unobtainable (CLAUDE.md's transparency mandate, RULING 248).
 *
 * Identity is a name on the face, the short id beside it, the full id in a
 * disclosure and a copy control (ADM-48) — never a hash squeezed into a
 * vertical strip. The copy control is the release review's, not a second one.
 *
 * Server-only presentation of the canonical readback; no parallel operational
 * store.
 */
import { auditWorkerFleetView, type WorkerFleetMetric, type WorkerFleetReadback } from "@/lib/control-plane/workers/readback.ts";
import { findingMeaning, findingPlain, roleLead, verdictPlain, workItemStatePlain } from "@/lib/control-plane/workers/plain-roles.ts";
import { workerAttemptStory } from "@/lib/control-plane/plain-work.ts";
import { displayNameOf } from "@/lib/control-plane/display-name.ts";
import { modelName, plainCode, plainCount, plainDuration, usdCents } from "@/lib/control-plane/plain-words.ts";

import { CopyButton } from "../release-review/copy-button";
import { Identity } from "./identity";
import { NeedsYouLine } from "../../status-ui.tsx";
import { Name, When } from "../../console-ui.tsx";
import { roleGroupNote, roleOneLiner, roleTitle } from "../../fleet-wording.ts";

/**
 * The unit as the owner says it. (9.6.26 owner feedback, ACLOSE-6.)
 *
 * `unit` is a union member off the readback and it was printed verbatim, so
 * every attempt row read `1 artifacts / 1` and `1552 ms / 1`. The exact
 * millisecond figure and the raw unit are still one disclosure down, with the
 * contract that produced them.
 */
function metricFace(value: WorkerFleetMetric): string {
  if (value.unit === "USD") return usdCents(value.value);
  if (value.unit === "ms") return plainDuration(value.value);
  if (value.unit === "artifacts") return plainCount(value.value, "document kept", "documents kept");
  if (value.unit === "attempts") return plainCount(value.value, "attempt", "attempts");
  if (value.unit === "tasks") return plainCount(value.value, "task", "tasks");
  return `${value.value} ${value.unit}`;
}

function Metric({ value }: { value: WorkerFleetMetric }) {
  // Dollars to the cent on the face (ADM-26); the stored float and its contract stay in the disclosure.
  return (
    <details className="worker-fleet-metric">
      <summary>{metricFace(value)} of {value.denominator}</summary>
      <small className="note">
        {value.contract}<br />
        {value.unit === "ms" ? <>Exactly {value.value} ms.<br /></> : null}
        Source: {value.source}<br />
        Observed: <When iso={value.observedAt} />
      </small>
    </details>
  );
}

export function WorkerFleetPanel({ view, candidateNames }: { readonly view: WorkerFleetReadback; readonly candidateNames?: Readonly<Record<string, string>> }) {
  if (view.status === "UNAVAILABLE") return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">The workers</h2>
      <p className="refusal">Worker state could not be read. Counts and verdicts are unavailable.</p>
      <ul>{view.failures.map((failure) => <li key={failure}>{plainCode(failure)}</li>)}</ul>
      <p className="note">Observed: <When iso={view.observedAt} /></p>
    </section>
  );
  const audit = auditWorkerFleetView(view);
  if (!audit.ok) return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">The workers</h2>
      <p className="refusal">This panel refused inconsistent measurements.</p>
      <ul>{audit.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
    </section>
  );
  const leads = view.roles.map((role) => ({ role, lead: roleLead(role) }));
  const needing = leads.filter((l) => l.lead.needsYou !== null);
  return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">The workers</h2>
      <p className="plain">
        <strong>Needs you?</strong> {needing.length === 0 ? "No." : "Yes."}{" "}
        {needing.length === 0
          ? "Nothing in any role needs a decision from you right now."
          : `${needing.length} role${needing.length === 1 ? "" : "s"} ${needing.length === 1 ? "has" : "have"} work waiting on you: ${needing.map((l) => roleTitle(l.role.role)).join(", ")}.`}
      </p>
      <p className="note">Each of these is a disposable worker with one job. Canonical Attempts, results and queue state, observed <When iso={view.observedAt} />. Open any measurement for its definition and source. A worker verdict never authorises anything reaching a reader.</p>
      {view.notices.length > 0 && (
        <ul>
          {view.notices.map((notice) => (
            <li key={notice} className="note" title={notice}>
              {notice.replace(/^WORKER_RESULT_ATTEMPT_MISSING: /, "A stored result names an Attempt that is not on record, so it certifies nothing: ")}
            </li>
          ))}
        </ul>
      )}
      {leads.map(({ role, lead }) => {
        const title = roleTitle(role.role);
        return (
        <section key={role.role} className="role-section card" aria-labelledby={`role-${role.role}`}>
          <h3 id={`role-${role.role}`} title={role.role}>{title}</h3>
          <p className="fleet-what">{roleOneLiner(role.role)}</p>
          {/* The role lead names its work item by raw id; every key on this console reads as a name (ADM-12). */}
          <NeedsYouLine
            needs={
              lead.needsYou === null
                ? { needed: false }
                : {
                    needed: true,
                    action: lead.needsYou
                      .replace(/^Yes — /, "")
                      .replace(/work item (\S+)/, (_whole, id: string) => displayNameOf(id, { candidateNames }).name),
                  }
            }
          />
          <p className="role-doing">{lead.doing}</p>
          <div className="fleet-nums">
            <div className="rq-tile"><div className="rq-figure">{role.shown.value}</div><div className="rq-caption">newest attempts shown of {role.shown.denominator} recorded</div></div>
            <div className="rq-tile"><div className="rq-figure">{role.pending.value}</div><div className="rq-caption">tasks waiting of {role.pending.denominator} registered</div></div>
            <div className="rq-tile"><div className="rq-figure">{role.due.value}</div><div className="rq-caption">due now of {role.due.denominator} waiting</div></div>
          </div>
          <p className="note">{roleGroupNote(role.role)}</p>
          {lead.glossary.length > 0 && (
            <details className="ph-evidence">
              <summary>The exact words the instrument used</summary>
              <dl className="glossary">
                {lead.glossary.map((g) => (
                  <div key={g.code}>
                    <dt><code>{g.code}</code></dt>
                    <dd>{g.means}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {role.attempts.length === 0 ? <p className="note">No Attempts for this role have been recorded in this control plane.</p> : (
            <div className="scroll-x">
              <table className="wf-attempts">
                <caption>Newest {title.toLowerCase()} attempts</caption>
                <thead><tr><th scope="col">Attempt</th><th scope="col">What happened</th><th scope="col">What happens next</th><th scope="col">Needs you</th><th scope="col">Cost and effort</th></tr></thead>
                <tbody>{role.attempts.map((attempt) => {
                  const story = workerAttemptStory(
                    {
                      outcome: attempt.outcome,
                      verdict: attempt.verdict,
                      resultStatus: attempt.resultStatus,
                      workItemState: attempt.workItemState,
                      findingCount: attempt.findings.length,
                    },
                    /* No retry stamp travels on a WorkerAttemptView, so the sentence says "a later cycle", never a time nobody measured. */
                    { name: displayNameOf(attempt.workItemId, { candidateNames }).name, retryPhrase: null },
                  );
                  return (
                  <tr key={attempt.attemptId} data-worker-attempt={attempt.attemptId}>
                    <th scope="row">
                      <Identity id={attempt.attemptId} what="attempt id" />
                      <small className="note">
                        Started <When iso={attempt.startedAt} /><br />
                        {attempt.executionMode === "MODEL_ASSISTED" ? `Ran with ${modelName(attempt.worker.version)}` : attempt.executionMode === "DETERMINISTIC" ? "Ran as plain code, no model" : "How it ran was not recorded"}
                      </small>
                    </th>
                    <td>
                      {story.happened}
                      {/*
                        The state's SHORT LABEL is deliberately not repeated here. "blocked on a dependency" is the
                        exact phrase the owner read and could not use; the next column says what it means as a whole
                        sentence, and the raw state stays in the technical disclosure beside it.
                      */}
                      <div className="note">On <Name raw={attempt.workItemId} candidateNames={candidateNames} />{attempt.reopenedByResult ? ", which this result reopened" : ""}.</div>
                      {/*
                        THE FINDINGS WERE THE ONE THING ON THIS ROW THAT WAS
                        NEITHER TRANSLATED NOR BEHIND A DISCLOSURE. (9.6.26
                        owner feedback, ACLOSE-6.)

                        It rendered `findingPlain(code)` — a de-underscored noun
                        phrase — followed by the instrument's raw engineering
                        sentence, on the face: "source scope mismatch — The held
                        artifact must bind to the exact observed publisher,
                        source, route, and URL scope." Both halves are correct
                        and neither tells the owner what happened.

                        Now the face carries the whole sentence from
                        `findingMeaning`, and `finding.detail` — the instrument's
                        own words, unchanged — moved into the disclosure beside
                        the code. A code with no owner sentence written for it
                        yet keeps the noun phrase rather than getting a made-up
                        explanation.
                      */}
                      {attempt.findings.length > 0 && <ul className="findings">{attempt.findings.map((finding, index) => {
                        const meaning = findingMeaning(finding.code);
                        return (
                          <li key={`${finding.code}:${index}`}>
                            {meaning ?? <><strong>{findingPlain(finding.code)}</strong><small className="note"> — the instrument&rsquo;s own words for this are in Cost and effort.</small></>}
                          </li>
                        );
                      })}</ul>}
                      {/*
                        "DID WE GET ANYTHING USEFUL?" — the owner's third
                        question, which no column answered. The verdict and the
                        artifact count were both on the row and neither said it
                        outright.
                      */}
                      <div className="note">{attempt.artifacts.value > 0 ? `We kept ${plainCount(attempt.artifacts.value, "document", "documents")} from this run.` : "Nothing was kept from this run."}</div>
                    </td>
                    <td>{story.next}</td>
                    <td className={story.needsYou.needed ? "needs-yes" : "needs-no"}>{story.needsYou.needed ? `Yes — ${story.needsYou.action}` : "No"}</td>
                    <td>
                      {attempt.cost
                        ? <Metric value={attempt.cost} />
                        : attempt.executionMode === "DETERMINISTIC"
                          ? <span className="free" title="No model request was made on this Attempt, so there is nothing to bill.">{usdCents(0)} this run</span>
                          : <span className="gap">cost not measured</span>}
                      {attempt.duration ? <Metric value={attempt.duration} /> : <span className="gap">time not measured</span>}
                      <Metric value={attempt.artifacts} />
                      <details className="raw-ids">
                        <summary>the instrument&rsquo;s own words</summary>
                        <small className="note">
                          {attempt.resultDetail}<br />
                          Execution outcome <code>{attempt.outcome}</code>; verdict <code>{attempt.verdict ?? attempt.resultStatus}</code> ({verdictPlain(attempt.verdict)}); worker {attempt.worker.provider} {attempt.worker.version}, instance <code>{attempt.worker.instance}</code>.<br />
                          Work item <Name raw={attempt.workItemId} candidateNames={candidateNames} /> — <code>{attempt.workItemId}</code>, state <code>{attempt.workItemState}</code> ({workItemStatePlain(attempt.workItemState)})
                          <CopyButton value={attempt.workItemId} what="work item id" />
                          {/* The instrument's raw sentence, moved off the face and kept whole. */}
                          {attempt.findings.map((f, i) => <span key={`${f.code}:${i}`}><br /><code>{f.code}</code> ({f.severity}) — {f.detail}</span>)}
                        </small>
                      </details>
                    </td>
                  </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </section>
        );
      })}
    </section>
  );
}
