/**
 * **RESEARCH — LEVEL 1.** (Level 1 activation, 2026-09-01. RULING 240, RULING 241.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session, both enforced upstream
 * in `middleware.ts`. Reads the durable control plane and nothing else. The
 * verdict is DERIVED at render time by `buildResearchView`; nothing here reads
 * a stored one. Two audits run against what is about to be rendered, and a
 * failure replaces the numbers with a refusal — as the control centre does.
 *
 * The worker credential appears as a NAME and a configured flag. No value is
 * read here, and nothing in this file reads the environment.
 */

import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, readHeartbeat } from "@/lib/control-plane/admin-data.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type Gap,
  type Held,
  type Measured,
} from "@/lib/control-plane/owner-surface.ts";
import {
  buildResearchView,
  countClaimsOf,
  readResearchIntents,
  readResearchState,
  readScoutEvidenceCount,
  readScoutResults,
  readScoutSpend,
  renderedNumbersOf,
} from "@/lib/control-plane/research-view.ts";
import {
  buildWindowView,
  countClaimsOf as windowCountClaimsOf,
  readLastWindow,
  readWindowIncidents,
  renderedNumbersOf as windowNumbersOf,
} from "@/lib/control-plane/window-view.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTENT_ROUTE = "/api/admin/research";

/* ------------------------------------------------------------------ *
 * SMALL RENDER HELPERS
 * ------------------------------------------------------------------ */

function whoseLabel(gap: Gap): string {
  if (gap.whose === "OURS") return "our gap";
  if (gap.whose === "THEIRS") return "their gap";
  return "cannot tell";
}

function GapNote({ gap }: { gap: Gap }) {
  return (
    <span className="gap">
      <span className="gap-whose">{whoseLabel(gap)}</span> {gap.says}
    </span>
  );
}

/** A measured number: value, denominator, and the contract visible beside it. */
function Count({ m, format }: { m: Measured; format?: (value: number) => string }) {
  const show = format ?? ((v: number) => String(v));
  return (
    <span className="measure">
      <strong>{show(m.value)}</strong>
      <span className="denom">
        {" "}
        / {show(m.denominator)}
      </span>{" "}
      <small className="note" title={m.denominatorSource}>
        ({m.contract})
      </small>
    </span>
  );
}

function Stat({ h, format }: { h: Held<Measured>; format?: (value: number) => string }) {
  return h.held ? <Count m={h.value} format={format} /> : <GapNote gap={h.gap} />;
}

const usd = (v: number) => `$${v.toFixed(4)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Refusal({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <main className="admin">
      <h1>Research — Level 1</h1>
      <p className="refusal">
        <strong>{title}</strong>
      </p>
      {lines.map((line) => (
        <p className="note" key={line}>
          {line}
        </p>
      ))}
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * THE PAGE
 * ------------------------------------------------------------------ */

export default async function ResearchPage() {
  const jar = await cookies();
  const hasSession = jar.has(ADMIN_SESSION_COOKIE);

  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <Refusal
        title="We could not ask."
        lines={[
          opened.detail,
          "Nothing below is missing — nothing below has been checked. Those are different facts and this page will not print one as the other.",
        ]}
      />
    );
  }

  const nowIso = new Date().toISOString();
  const [heartbeat, state, intents, results, spend, evidence] = await Promise.all([
    readHeartbeat(opened.repos),
    readResearchState(opened.repos),
    readResearchIntents(opened.repos),
    readScoutResults(opened.repos),
    readScoutSpend(opened.repos, nowIso),
    readScoutEvidenceCount(opened.repos),
  ]);
  const view = buildResearchView({ nowIso, heartbeat, state, intents, results, spend, evidence });

  // THE LAST NIGHTLY WINDOW (RULING 242). Read from the same control plane; a
  // window the runner never ran renders as its named gap, never as zero.
  const lastWindow = await readLastWindow(opened.repos);
  const windowIncidents =
    lastWindow.kind === "HELD"
      ? await readWindowIncidents(opened.repos, lastWindow.value.last.windowId)
      : { kind: "HELD" as const, value: [] };
  const windowView = buildWindowView({ nowIso, lastWindow, incidents: windowIncidents });

  const numberAudit = auditRenderedNumbers([...renderedNumbersOf(view), ...windowNumbersOf(windowView)]);
  const countAudit = checkStatedEqualsRendered([...countClaimsOf(view), ...windowCountClaimsOf(windowView)]);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <Refusal
        title="This page refused to render its own numbers."
        lines={[
          ...(numberAudit.ok ? [] : [numberAudit.detail]),
          ...(countAudit.ok ? [] : [countAudit.detail]),
          "A number without a denominator, or a headline that disagrees with the rows beneath it, is worse than a blank page: you would act on it.",
        ]}
      />
    );
  }

  const verdictClass =
    view.verdict === "ACTIVE" ? "state-green" : view.verdict === "DEGRADED" ? "state-unknown" : "state-red";

  return (
    <main className="admin">
      <p className="note">
        <a href="/admin">← Control centre</a>
      </p>
      <h1>
        Research — Level 1 <span className={verdictClass}>{view.verdict}</span>
      </h1>
      {view.verdict !== "ACTIVE" && (
        <ul>
          {view.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {/* RUNNER */}
      <h2>Runner</h2>
      <p>
        <span className={view.runner.state === "ALIVE" ? "state-green" : "state-red"}>
          {view.runner.state}
        </span>{" "}
        {view.runner.detail}
      </p>
      {view.runner.note && <p className="note">{view.runner.note}</p>}
      {view.cycle.held ? (
        <p className="note">
          Research state written {view.cycle.value.beatAt}; cycle started {view.cycle.value.cycleStartedAt}
          {view.cycle.value.cycleFinishedAt
            ? `, finished ${view.cycle.value.cycleFinishedAt}`
            : ", not finished in this state"}
          ; host {view.cycle.value.host}; SHA {view.cycle.value.testedSha ?? "unrecorded"}; model{" "}
          {view.cycle.value.model}; model lane{" "}
          {view.cycle.value.modelLaneEnabled
            ? "enabled"
            : `off: ${view.cycle.value.modelLaneDisabledReason ?? ""}`}
          .
        </p>
      ) : (
        <p>
          <GapNote gap={view.cycle.gap} />
        </p>
      )}
      {view.workerCredential.held ? (
        <p className="note">
          Worker credential <code>{view.workerCredential.value.name}</code>: configured{" "}
          <strong>{view.workerCredential.value.configured ? "true" : "false"}</strong> (
          {view.workerCredential.value.provider}, {view.workerCredential.value.context}).
        </p>
      ) : (
        <p>
          <GapNote gap={view.workerCredential.gap} />
        </p>
      )}
      {view.cycle.held && view.cycle.value.runtimeConditions.length > 0 && (
        <ul>
          {view.cycle.value.runtimeConditions.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
      )}

      {/* HOST SUPERVISION (RULING 246) */}
      <h2>Host supervision</h2>
      {view.supervision.held ? (
        <>
          <p>
            <span
              className={
                view.supervision.value.condition === null
                  ? "state-unknown"
                  : view.supervision.value.condition.ok
                    ? "state-green"
                    : "state-red"
              }
            >
              {view.supervision.value.condition === null
                ? "NOT DERIVED"
                : view.supervision.value.condition.ok
                  ? "PROVEN"
                  : "NOT PROVEN"}
            </span>{" "}
            {view.supervision.value.condition ? (
              view.supervision.value.condition.reason
            ) : (
              <GapNote
                gap={{
                  whose: "OURS",
                  says: "the derived verdict carried no host-supervision condition; the cycle that wrote this state predates RULING 246",
                }}
              />
            )}
          </p>
          <p className="note">
            Read on {view.supervision.value.host} at {view.supervision.value.checkedAt};{" "}
            {view.supervision.value.measurable
              ? `relaunch trigger present: ${
                  view.supervision.value.relaunchTrigger.present === null
                    ? "could not ask"
                    : view.supervision.value.relaunchTrigger.present
                      ? "true"
                      : "false"
                } (${view.supervision.value.relaunchTrigger.detail})`
              : `not measurable on this host: ${view.supervision.value.notMeasurableReason ?? ""}`}
            .{" "}
            {view.supervision.value.proof
              ? `Proof ${view.supervision.value.proof.verdict} measured ${view.supervision.value.proof.measuredAt}: killed pid ${view.supervision.value.proof.killedPid}, relaunched pid ${view.supervision.value.proof.relaunchedPid} after ${view.supervision.value.proof.secondsToRelaunch} s.`
              : `No relaunch proof at ${view.supervision.value.proofPath} on the runner's checkout.`}
          </p>
        </>
      ) : (
        <p>
          <GapNote gap={view.supervision.gap} />
        </p>
      )}

      {/* DISPATCH ORDERING (Work Item 5) */}
      <h2>Dispatch ordering</h2>
      {view.ordering.held ? (
        <>
          <p className="note">{view.ordering.value.rule}</p>
          <p className="note">{view.ordering.value.scope}</p>
          <ul>
            <li>
              Band 1: <strong>{view.ordering.value.bands[1]}</strong> · Band 2:{" "}
              <strong>{view.ordering.value.bands[2]}</strong> · Band 3:{" "}
              <strong>{view.ordering.value.bands[3]}</strong> — due model-class rows, {view.ordering.value.appliesTo}
            </li>
            <li>
              Inputs: {view.ordering.value.inputs.readerImpactAt}; {view.ordering.value.inputs.pilotJurisdictions}; open
              red reader questions {view.ordering.value.inputs.openRedQuestions.count}
              {view.ordering.value.inputs.openRedQuestions.zips.length > 0
                ? ` (ZIPs ${view.ordering.value.inputs.openRedQuestions.zips.join(", ")})`
                : ""}
              {view.ordering.value.inputs.openRedQuestions.run
                ? ` from ${view.ordering.value.inputs.openRedQuestions.run}`
                : ""}
              ; universe providers {view.ordering.value.inputs.universeProviders.join(", ")}; tie-break{" "}
              {view.ordering.value.inputs.tieBreak}
            </li>
          </ul>
        </>
      ) : (
        <p>
          <GapNote gap={view.ordering.gap} />
        </p>
      )}

      {/* RESEARCH METRICS (RULING 244) */}
      <h2>Research metrics</h2>
      {view.metrics.held ? (
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th>Value</th>
              <th>Denominator / rule</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Capacity", view.metrics.value.rows.capacity],
                ["Queue by band", view.metrics.value.rows.queueBands],
                ["Graduation funnel", view.metrics.value.rows.funnel],
                ["Model vs deterministic share", view.metrics.value.rows.share],
                ["Cache hit rate by role", view.metrics.value.rows.cache],
                ["Cost per useful outcome", view.metrics.value.rows.costPerOutcome],
              ] as const
            ).flatMap(([group, rows]) =>
              rows.map((row) => (
                <tr key={`${group}:${row.label}`}>
                  <td>
                    <span className="gap-whose">{group}</span> {row.label}
                  </td>
                  <td>
                    <strong>{row.value}</strong>
                  </td>
                  <td className="note">{row.denominator}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ) : (
        <p>
          <GapNote gap={view.metrics.gap} />
        </p>
      )}

      {/* SCOUTS */}
      <h2>Scouts</h2>
      <p>
        Concurrency: <Stat h={view.concurrency} />
      </p>
      <p>
        Spend in the rolling window: <Stat h={view.spend.windowUsd} format={usd} />
      </p>
      {view.spend.capDeferredNote && <p className="note">Cap-deferred: {view.spend.capDeferredNote}</p>}
      <p>
        Measured Attempts: <Stat h={view.spend.measuredAttempts} />
      </p>
      <p>
        Unmeasured Attempts: <Stat h={view.spend.unmeasuredAttempts} />
      </p>

      <h3>Queue — bounded model workers</h3>
      {view.queue.held ? (
        <ul>
          <li>
            Due: <Stat h={view.queue.value.due} />
          </li>
          <li>
            Registered to the model lane: <Stat h={view.queue.value.queued} />
          </li>
          <li>
            Dispatched this cycle: <Stat h={view.queue.value.dispatchedThisCycle} />
          </li>
          <li>
            Deferred for the ceiling: <Stat h={view.queue.value.deferredForCeiling} />
          </li>
          <li>
            Deferred for the cycle maximum: <Stat h={view.queue.value.deferredForCycleMax} />
          </li>
          <li>
            Deferred for the lane: <Stat h={view.queue.value.deferredForLane} />
          </li>
          <li>
            Deterministic units dispatched this cycle:{" "}
            <Stat h={view.queue.value.deterministicDispatched} />
          </li>
        </ul>
      ) : (
        <p>
          <GapNote gap={view.queue.gap} />
        </p>
      )}

      <h3>Currently running</h3>
      {view.running.held ? (
        view.running.value.length === 0 ? (
          <p className="note">No Scout was running when the research state was last written.</p>
        ) : (
          <ul>
            {view.running.value.map((scout) => (
              <li key={scout.attemptId}>
                {scout.obligationId} · Attempt <code>{scout.attemptId}</code> · started {scout.startedAt}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p>
          <GapNote gap={view.running.gap} />
        </p>
      )}

      {/* SCOUT ATTEMPTS */}
      <h2>
        Scout Attempts —{" "}
        {view.results.held ? <Count m={view.results.value.shown} /> : <GapNote gap={view.results.gap} />}
      </h2>
      {view.results.held && view.results.value.rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Reason</th>
              <th>Model</th>
              <th>Elapsed</th>
              <th>Cost</th>
              <th>Outcome</th>
              <th>Ids</th>
            </tr>
          </thead>
          <tbody>
            {view.results.value.rows.map((row) => (
              <tr key={`${row.attemptId}:${row.recordedAt}`}>
                <td>
                  {row.subject}
                  <div className="note">{row.obligationId}</div>
                </td>
                <td>{row.reason}</td>
                <td>{row.model}</td>
                <td>{seconds(row.elapsedMs)}</td>
                <td>{row.usd === null ? <span className="gap">unmeasured</span> : usd(row.usd)}</td>
                <td>
                  {row.outcome}
                  <div className="note">
                    stopped by {row.stoppedBy}; {row.artifactCount} artifact(s); {row.candidateCount}{" "}
                    candidate(s); recorded {row.recordedAt}
                  </div>
                </td>
                <td>
                  WorkItem <code>{row.workItemId}</code>
                  <br />
                  Attempt <code>{row.attemptId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* EVIDENCE AND METHOD CANDIDATES */}
      <h2>Evidence and method candidates</h2>
      <p>
        Scout evidence:{" "}
        {view.evidence.held ? (
          <>
            distinct artifacts <Count m={view.evidence.value.distinctArtifacts} />; Attempts with
            evidence <Count m={view.evidence.value.attemptsWithEvidence} />
          </>
        ) : (
          <GapNote gap={view.evidence.gap} />
        )}
      </p>
      <p>
        Method candidates:{" "}
        {view.methodCandidates.held ? (
          <>
            validated <Stat h={view.methodCandidates.value.validated} />; admitted{" "}
            <Stat h={view.methodCandidates.value.admitted} />; rejected{" "}
            <Stat h={view.methodCandidates.value.rejected} />
          </>
        ) : (
          <GapNote gap={view.methodCandidates.gap} />
        )}
      </p>

      {/* LAST NIGHTLY WINDOW (RULING 242) */}
      <h2>
        Last nightly window{" "}
        <span
          className={
            windowView.verdict === "COMPLETED"
              ? "state-green"
              : windowView.verdict === "FAILED_STAGE"
                ? "state-red"
                : "state-unknown"
          }
        >
          {windowView.verdict}
        </span>
      </h2>
      {windowView.reasons.length > 0 && (
        <ul>
          {windowView.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {windowView.time.held ? (
        <p className="note">
          Window <code>{windowView.time.value.windowId}</code> for {windowView.time.value.localDate} (
          {windowView.time.value.zone}), {windowView.time.value.trigger}, mode {windowView.time.value.mode};
          scheduled {windowView.time.value.scheduledFor}; ran {windowView.time.value.startedAt} →{" "}
          {windowView.time.value.finishedAt}; host {windowView.time.value.host}; SHA{" "}
          {windowView.time.value.testedSha ?? "unrecorded"}
          {windowView.time.value.caughtUp.length > 0
            ? `; caught up ${windowView.time.value.caughtUp.join(", ")}`
            : ""}
          .
        </p>
      ) : (
        <p>
          <GapNote gap={windowView.time.gap} />
        </p>
      )}
      {windowView.gate.held && <p className="note">Gate: {windowView.gate.value.reason}</p>}
      {windowView.stages.held && (
        <ul>
          {windowView.stages.value.map((s) => (
            <li key={s.stage}>
              <strong>{s.stage}</strong> {s.outcome}
              {s.reason ? ` — ${s.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p>
        Promoted: <Stat h={windowView.promoted} /> · Would promote: <Stat h={windowView.wouldPromote} /> ·
        Refused: <Stat h={windowView.refused} /> · Deferred: <Stat h={windowView.deferred} />
      </p>
      {windowView.byRecordClass.held ? (
        <ul>
          {windowView.byRecordClass.value.map((row) => (
            <li key={row.recordClass}>
              <code>{row.recordClass}</code>: would promote <Count m={row.promoteWould} />; refused{" "}
              <Count m={row.refuseWould} />; deferred <Count m={row.deferred} />
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <GapNote gap={windowView.byRecordClass.gap} />
        </p>
      )}
      <p>
        Legacy refresh:{" "}
        {windowView.legacy.held ? (
          <>
            ran <Count m={windowView.legacy.value.ran} /> ({windowView.legacy.value.source})
          </>
        ) : (
          <GapNote gap={windowView.legacy.gap} />
        )}
      </p>
      <p>
        Controls:{" "}
        {windowView.controls.held ? (
          <>
            recall <Count m={windowView.controls.value.recall} />; false absences{" "}
            <Count m={windowView.controls.value.falseAbsences} />; false presences{" "}
            <Count m={windowView.controls.value.falsePresences} />
          </>
        ) : (
          <GapNote gap={windowView.controls.gap} />
        )}
      </p>
      <p>
        Served-surface check:{" "}
        {windowView.verification.held ? (
          `${windowView.verification.value.instrument}: ${windowView.verification.value.verdict}`
        ) : (
          <GapNote gap={windowView.verification.gap} />
        )}
      </p>
      <p>
        Incidents:{" "}
        {windowView.incidents.held ? (
          <Count m={windowView.incidents.value.shown} />
        ) : (
          <GapNote gap={windowView.incidents.gap} />
        )}
      </p>
      {windowView.incidents.held && windowView.incidents.value.rows.length > 0 && (
        <ul>
          {windowView.incidents.value.rows.map((i) => (
            <li key={i.incidentId}>
              <code>{i.incidentId}</code> {i.stage} {i.code} — {i.detail}
            </li>
          ))}
        </ul>
      )}
      {windowView.proof.held && (
        <p className="note">
          Proof: record {windowView.proof.value.recordPath ?? "unwritten"}; digest{" "}
          {windowView.proof.value.digestPath ?? "unwritten"}; lease <code>{windowView.proof.value.leaseId}</code>;{" "}
          {windowView.proof.value.windowsRecorded} window(s) recorded.
        </p>
      )}

      {/* CONTROLS */}
      <h2>Controls</h2>
      <form method="post" action={INTENT_ROUTE}>
        <input type="hidden" name="action" value={view.pauseAction} />
        <button type="submit">
          {view.pauseAction === "PAUSE" ? "Pause research" : "Resume research"}
        </button>
      </form>
      <form method="post" action={INTENT_ROUTE}>
        <input type="hidden" name="action" value="RUN_CYCLE_NOW" />
        <button type="submit">Run a cycle now</button>
      </form>
      <p className="note">
        Each button appends an intent the standing runner honors on its next cycle. Nothing here
        edits the runner directly; an intent is pending until the runner records that it honored it.
      </p>

      <h3>
        Intents recorded —{" "}
        {view.intents.held ? <Count m={view.intents.value.shown} /> : <GapNote gap={view.intents.gap} />}
      </h3>
      {view.intents.held && view.intents.value.rows.length > 0 && (
        <ul>
          {view.intents.value.rows.map((intent) => (
            <li key={intent.intentId}>
              {intent.requestedAt} · <strong>{intent.action}</strong> · {intent.actor} ·{" "}
              <span className={intent.status === "HONORED" ? "state-green" : "state-unknown"}>
                {intent.status}
              </span>
              {intent.honoredAt
                ? ` · honored ${intent.honoredAt} by ${intent.honoredBy ?? ""}: ${intent.detail ?? ""}`
                : ""}
            </li>
          ))}
        </ul>
      )}

      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail} Read at {view.nowIso}.
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
