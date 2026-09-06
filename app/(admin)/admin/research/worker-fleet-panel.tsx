/**
 * **THE INSTRUMENT DETAIL, ONE ROLE AT A TIME — plain first, table beneath.**
 * (ADM-10 and ADM-12, the 9.4.26 evening admin feedback.)
 *
 * Each role section leads with one or two plain sentences from the SAME
 * readback the table renders — what the role is doing right now, and whether
 * anything here needs the owner (and if nothing does, it says so in the first
 * line so he can move on). The attempt table stays beneath as the evidence,
 * with every key rendered as a name and the raw id on hover, and every code in
 * words in a glossary above it.
 *
 * Server-only presentation of the canonical readback; no parallel operational
 * store.
 */
import { auditWorkerFleetView, type WorkerFleetMetric, type WorkerFleetReadback } from "@/lib/control-plane/workers/readback.ts";
import { findingPlain, roleLead, verdictPlain, workItemStatePlain } from "@/lib/control-plane/workers/plain-roles.ts";

import { Name, When, usd } from "../../console-ui.tsx";
import { FLEET_GROUP_WORDING, ROLE_GROUP, ROLE_WORDS } from "../../fleet-wording.ts";

function Metric({ value }: { value: WorkerFleetMetric }) {
  // A dollar figure reads to four places, never as the float it was stored as ($0.09661750000000001 measured on the live page, Admin Pass A).
  return (
    <details className="worker-fleet-metric">
      <summary>{value.unit === "USD" ? usd(value.value) : `${value.value} ${value.unit}`} / {value.denominator}</summary>
      <small className="note">
        {value.contract}<br />
        Source: {value.source}<br />
        Observed: <When iso={value.observedAt} />
      </small>
    </details>
  );
}

export function WorkerFleetPanel({ view, candidateNames }: { readonly view: WorkerFleetReadback; readonly candidateNames?: Readonly<Record<string, string>> }) {
  if (view.status === "UNAVAILABLE") return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">Disposable workers</h2>
      <p className="refusal">Worker state could not be read. Counts and verdicts are unavailable.</p>
      <ul>{view.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
      <p className="note">Observed: <When iso={view.observedAt} /></p>
    </section>
  );
  const audit = auditWorkerFleetView(view);
  if (!audit.ok) return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">Disposable workers</h2>
      <p className="refusal">This panel refused inconsistent measurements.</p>
      <ul>{audit.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
    </section>
  );
  const leads = view.roles.map((role) => ({ role, lead: roleLead(role) }));
  const needing = leads.filter((l) => l.lead.needsYou !== null);
  return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">Disposable workers</h2>
      <p className="plain">
        {needing.length === 0
          ? "Nothing in any role needs a decision from you right now."
          : `${needing.length} role${needing.length === 1 ? "" : "s"} ${needing.length === 1 ? "has" : "have"} work waiting on you: ${needing.map((l) => l.lead.title).join(", ")}.`}
      </p>
      <p className="note">Canonical Attempts, results and queue state, observed <When iso={view.observedAt} />. Open any measurement for its definition and source. Worker verdicts do not authorize reader promotion.</p>
      {view.notices.length > 0 && <ul>{view.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>}
      {leads.map(({ role, lead }) => {
        // The role as a name, and the fleet group it reports under on Pilot health (Admin Pass A).
        const roleName = (ROLE_WORDS as Record<string, string>)[role.role] ?? role.role;
        const groupKey = (ROLE_GROUP as Record<string, keyof typeof FLEET_GROUP_WORDING | null>)[role.role] ?? null;
        const group = groupKey ? FLEET_GROUP_WORDING[groupKey] : null;
        return (
        <section key={role.role} className="role-section card" aria-labelledby={`role-${role.role}`}>
          <h3 id={`role-${role.role}`}>
            {lead.title}{" "}
            <span className="fleet-roles" title={role.role}>
              {roleName}
              {group ? ` · ${group.name}` : ""}
            </span>
          </h3>
          <p className="fleet-what">They {lead.job}.</p>
          <p className="role-lead">
            <strong>Needs you?</strong> {lead.needsYou ?? "No — nothing here needs a decision from you."}
          </p>
          <p className="role-doing">{lead.doing}</p>
          <div className="fleet-nums">
            <div className="rq-tile"><div className="rq-figure">{role.shown.value}</div><div className="rq-caption">newest attempts shown of {role.shown.denominator} recorded</div></div>
            <div className="rq-tile"><div className="rq-figure">{role.pending.value}</div><div className="rq-caption">tasks waiting of {role.pending.denominator} registered</div></div>
            <div className="rq-tile"><div className="rq-figure">{role.due.value}</div><div className="rq-caption">due now of {role.due.denominator} waiting</div></div>
          </div>
          {lead.glossary.length > 0 && (
            <details className="ph-evidence">
              <summary>What the codes in this table mean</summary>
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
            <div style={{ overflowX: "auto" }}>
              <table>
                <caption>Newest {lead.title.toLowerCase()} attempts</caption>
                <thead><tr><th scope="col">Attempt / worker</th><th scope="col">Execution</th><th scope="col">Duration</th><th scope="col">Cost</th><th scope="col">Artifacts</th><th scope="col">Verdict / work state</th></tr></thead>
                <tbody>{role.attempts.map((attempt) => (
                  <tr key={attempt.attemptId} data-worker-attempt={attempt.attemptId}>
                    <th scope="row">
                      <Name raw={attempt.attemptId} />
                      <br />
                      <small className="note">{attempt.worker.provider} · {attempt.worker.version}</small>
                      <details className="raw-ids"><summary>ids</summary><small className="note"><code>{attempt.attemptId}</code><br />instance <code>{attempt.worker.instance}</code></small></details>
                    </th>
                    <td>
                      <span className={`outcome outcome-${attempt.outcome.toLowerCase()}`}>{attempt.outcome.toLowerCase()}</span>
                      <br />
                      <small className="note">
                        Started <When iso={attempt.startedAt} /><br />
                        Ended {attempt.endedAt ? <When iso={attempt.endedAt} /> : "not recorded"}<br />
                        {attempt.executionMode === "MODEL_ASSISTED" ? "with a model" : attempt.executionMode === "DETERMINISTIC" ? "plain code, no model" : "execution mode not recorded"}
                      </small>
                    </td>
                    <td>{attempt.duration ? <Metric value={attempt.duration} /> : "not measured"}</td>
                    <td>{attempt.cost ? <Metric value={attempt.cost} /> : attempt.executionMode === "DETERMINISTIC" ? <span className="free">$0 by design</span> : "not measured"}</td>
                    <td><Metric value={attempt.artifacts} /></td>
                    <td>
                      <strong>{attempt.verdict ? attempt.verdict.toLowerCase().replaceAll("_", " ") : "no typed result"}</strong>
                      <span className="note"> — {verdictPlain(attempt.verdict)}</span>
                      <br />
                      <small className="note">
                        <Name raw={attempt.workItemId} candidateNames={candidateNames} /> is {workItemStatePlain(attempt.workItemState)}{attempt.reopenedByResult ? " · reopened by this result" : ""}.
                      </small>
                      {attempt.findings.length > 0 && <ul className="findings">{attempt.findings.map((finding, index) => <li key={`${finding.code}:${index}`}><strong>{findingPlain(finding.code)}</strong><small className="note"> — {finding.detail}</small></li>)}</ul>}
                      <details className="raw-ids"><summary>instrument text</summary><small className="note">{attempt.resultDetail}<br />verdict <code>{attempt.verdict ?? attempt.resultStatus}</code>; work item <code>{attempt.workItemId}</code> state <code>{attempt.workItemState}</code>{attempt.findings.map((f) => <span key={f.code}><br /><code>{f.code}</code></span>)}</small></details>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        );
      })}
    </section>
  );
}
