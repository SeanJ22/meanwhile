import { auditWorkerFleetView, type WorkerFleetMetric, type WorkerFleetReadback } from "@/lib/control-plane/workers/readback.ts";

function Metric({ value }: { value: WorkerFleetMetric }) {
  return (
    <details className="worker-fleet-metric">
      <summary>{value.unit === "USD" ? `$${value.value}` : `${value.value} ${value.unit}`} / {value.denominator}</summary>
      <small className="note">
        {value.contract}<br />
        Source: {value.source}<br />
        Observed: <time dateTime={value.observedAt}>{value.observedAt}</time>
      </small>
    </details>
  );
}

/** Server-only presentation of the canonical readback; no parallel operational store. */
export function WorkerFleetPanel({ view }: { readonly view: WorkerFleetReadback }) {
  if (view.status === "UNAVAILABLE") return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">Disposable workers</h2>
      <p className="refusal">Worker state could not be read. Counts and verdicts are unavailable.</p>
      <ul>{view.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
      <p className="note">Observed: <time dateTime={view.observedAt}>{view.observedAt}</time></p>
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
  return (
    <section aria-labelledby="worker-fleet-heading">
      <h2 id="worker-fleet-heading">Disposable workers</h2>
      <p className="note">Canonical Attempts, results and queue state, observed <time dateTime={view.observedAt}>{view.observedAt}</time>. Open any measurement for its definition and source. Worker verdicts do not authorize reader promotion.</p>
      {view.notices.length > 0 && <ul>{view.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>}
      {view.roles.map((role) => (
        <div key={role.role}>
          <h3>{role.role.replaceAll("_", " ")}</h3>
          <dl>
            <dt>Attempts shown / recorded for this role</dt><dd><Metric value={role.shown} /></dd>
            <dt>Queued / registered tasks</dt><dd><Metric value={role.pending} /></dd>
            <dt>Due / queued tasks</dt><dd><Metric value={role.due} /></dd>
          </dl>
          {role.attempts.length === 0 ? <p className="note">No Attempts for this role have been recorded in this control plane.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <caption>Latest {role.role.replaceAll("_", " ")} Attempts</caption>
                <thead><tr><th scope="col">Attempt / worker</th><th scope="col">Execution</th><th scope="col">Duration</th><th scope="col">Cost</th><th scope="col">Artifacts</th><th scope="col">Verdict / work state</th></tr></thead>
                <tbody>{role.attempts.map((attempt) => (
                  <tr key={attempt.attemptId} data-worker-attempt={attempt.attemptId}>
                    <th scope="row"><code>{attempt.attemptId}</code><br /><small className="note">{attempt.worker.provider} · {attempt.worker.version}<br />Instance: {attempt.worker.instance}</small></th>
                    <td>{attempt.outcome}<br /><small className="note">Started: <time dateTime={attempt.startedAt}>{attempt.startedAt}</time><br />Ended: {attempt.endedAt ? <time dateTime={attempt.endedAt}>{attempt.endedAt}</time> : "Not recorded"}<br />{attempt.executionMode ?? "Execution mode not recorded"}</small></td>
                    <td>{attempt.duration ? <Metric value={attempt.duration} /> : "NOT MEASURED"}</td>
                    <td>{attempt.cost ? <Metric value={attempt.cost} /> : "NOT MEASURED"}</td>
                    <td><Metric value={attempt.artifacts} /></td>
                    <td><strong>{attempt.verdict ?? attempt.resultStatus}</strong><br /><small className="note">{attempt.resultDetail}<br />WorkItem: <code>{attempt.workItemId}</code><br />Current state: {attempt.workItemState}{attempt.reopenedByResult ? " · reopened by this result" : ""}</small>
                      {attempt.findings.length > 0 && <ul>{attempt.findings.map((finding, index) => <li key={`${finding.code}:${index}`}><strong>{finding.code}</strong>: {finding.detail}</li>)}</ul>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
