import { readWorkerFleet } from "@/lib/control-plane/workers/readback.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import { WorkerFleetPanel } from "./worker-fleet-panel";
/**
 * **RESEARCH — LEVEL 1.** (Level 1 activation, 2026-09-01. RULING 240, RULING 241;
 * plain leads, meanings, charts and the one-line window for the 9.4.26 evening
 * feedback, ADM-10/11/12/13/19/20/22.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session, both enforced upstream
 * in `middleware.ts`. Reads the durable control plane and nothing else. The
 * verdict is DERIVED at render time by `buildResearchView`; nothing here reads
 * a stored one. Two audits run against what is about to be rendered, and a
 * failure replaces the numbers with a refusal — as the control centre does.
 *
 * The worker credential appears as a NAME and a configured flag. No value is
 * read here, and nothing in this file reads the environment.
 *
 * Every read the page needs is issued in ONE round (ADM-14): the nine reads
 * used to run as a group of six, then the fleet, then the window, then its
 * incidents — four sequential trips to Neon on every view switch.
 */

import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, readHeartbeat, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type Held,
  type Measured,
} from "@/lib/control-plane/owner-surface.ts";
import { plainWindow } from "@/lib/control-plane/plain-window.ts";
import { METRIC_GROUP_MEANING, type DigestRow } from "@/lib/control-plane/research-digest.ts";
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

import { BarChart, Funnel, Ring, StackedBar } from "../../charts.tsx";
import { GapNote, Name, QueueForm, Said, When } from "../../console-ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTENT_ROUTE = "/api/admin/research";
const HERE = "/admin/research";

/* ------------------------------------------------------------------ *
 * SMALL RENDER HELPERS
 * ------------------------------------------------------------------ */

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

function Stat({ h, format, where }: { h: Held<Measured>; format?: (value: number) => string; where: string }) {
  return h.held ? <Count m={h.value} format={format} /> : <GapNote gap={h.gap} where={where} returnTo={HERE} />;
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

/** One metric group: its meaning, then its rows with a meaning each (ADM-11). */
function MetricGroup({ title, meaning, rows, children }: { title: string; meaning: string; rows: readonly DigestRow[]; children?: React.ReactNode }) {
  return (
    <section className="metric-group card">
      <h3>{title}</h3>
      <p className="fleet-what">{meaning}</p>
      {children}
      <div className="scroll-x">
      <table className="metrics">
        <thead>
          <tr>
            <th>Measure</th>
            <th className="n">Value</th>
            <th>What it means · how it is counted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="n">
                {/* The digest's UNMEASURED sentinel reads as words; the code stays on hover (Admin Pass A). */}
                <strong title={row.value === "UNMEASURED" ? row.value : undefined}>{row.value === "UNMEASURED" ? "not measured" : row.value}</strong>
              </td>
              <td>
                {row.meaning}
                <div className="note">{row.denominator}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
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
  const [heartbeat, state, intents, results, spend, evidence, fleet, lastWindow, snapshotOut] = await Promise.all([
    readHeartbeat(opened.repos),
    readResearchState(opened.repos),
    readResearchIntents(opened.repos),
    readScoutResults(opened.repos),
    readScoutSpend(opened.repos, nowIso),
    readScoutEvidenceCount(opened.repos),
    readWorkerFleet(opened.repos, nowIso),
    readLastWindow(opened.repos),
    readSnapshot(opened.repos),
  ]);
  const view = buildResearchView({ nowIso, heartbeat, state, intents, results, spend, evidence });
  const candidateNames = snapshotOut.kind === "HELD" ? snapshotOut.value.candidateNames : undefined;

  // THE LAST NIGHTLY WINDOW (RULING 242). Read from the same control plane; a
  // window the runner never ran renders as its named gap, never as zero.
  const windowIncidents =
    lastWindow.kind === "HELD"
      ? await readWindowIncidents(opened.repos, lastWindow.value.last.windowId)
      : { kind: "HELD" as const, value: [] };
  const windowView = buildWindowView({ nowIso, lastWindow, incidents: windowIncidents });
  const windowPlain = plainWindow(windowView);

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
  const verdictPlain =
    view.verdict === "ACTIVE"
      ? "The research lane is running within its bounds."
      : view.verdict === "DEGRADED"
        ? "The research lane is running, but not every condition holds."
        : "The research lane is not running right now. Nothing needs a decision from you unless a line below says so.";
  const metrics = view.metrics.held ? view.metrics.value : null;
  const metricsGap = view.metrics.held ? null : view.metrics.gap;

  return (
    <main className="admin console-page">
      {/* The one console header (9.4.26): this is the instrument-detail view of the same console. */}
      <ConsoleNav view="research" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />
      <p className="note">
        <a href="/admin">← Pilot health</a> — this page is the instrument detail behind the fleet view:
        every Attempt, every intent, every number with its denominator.
      </p>
      <h1>
        Research — Level 1 <span className={verdictClass}>{view.verdict}</span>
      </h1>
      <p className="plain">{verdictPlain}</p>
      {view.verdict !== "ACTIVE" && (
        <details className="ph-evidence" open>
          <summary>Why, in the instrument&rsquo;s words — {view.reasons.length}</summary>
          <ul>
            {view.reasons.map((reason) => (
              <li key={reason}>
                <Said text={reason} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <WorkerFleetPanel view={fleet} candidateNames={candidateNames} />

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
          Research state written <When iso={view.cycle.value.beatAt} />; cycle started <When iso={view.cycle.value.cycleStartedAt} />
          {view.cycle.value.cycleFinishedAt ? (
            <>
              , finished <When iso={view.cycle.value.cycleFinishedAt} />
            </>
          ) : (
            ", not finished in this state"
          )}
          ; host {view.cycle.value.host}; SHA {view.cycle.value.testedSha ?? "unrecorded"}; model{" "}
          {view.cycle.value.model}; model lane{" "}
          {view.cycle.value.modelLaneEnabled
            ? "enabled"
            : `off: ${view.cycle.value.modelLaneDisabledReason ?? ""}`}
          .
        </p>
      ) : (
        <p>
          <GapNote gap={view.cycle.gap} where="Research · runner cycle" returnTo={HERE} />
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
          <GapNote gap={view.workerCredential.gap} where="Research · worker credential" returnTo={HERE} />
        </p>
      )}
      {view.cycle.held && view.cycle.value.runtimeConditions.length > 0 && (
        <ul>
          {view.cycle.value.runtimeConditions.map((condition) => (
            <li key={condition}>
              <Said text={condition} />
            </li>
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
              <Said text={view.supervision.value.condition.reason} />
            ) : (
              <GapNote
                gap={{
                  whose: "OURS",
                  says: "the derived verdict carried no host-supervision condition; the cycle that wrote this state predates RULING 246",
                }}
                where="Research · host supervision"
                returnTo={HERE}
              />
            )}
          </p>
          <p className="note">
            Read on {view.supervision.value.host} <When iso={view.supervision.value.checkedAt} />;{" "}
            <Said
              text={
                view.supervision.value.measurable
                  ? `relaunch trigger present: ${
                      view.supervision.value.relaunchTrigger.present === null
                        ? "could not ask"
                        : view.supervision.value.relaunchTrigger.present
                          ? "true"
                          : "false"
                    } (${view.supervision.value.relaunchTrigger.detail})`
                  : `not measurable on this host: ${view.supervision.value.notMeasurableReason ?? ""}`
              }
            />
            .{" "}
            {view.supervision.value.proof ? (
              <>
                Proof {view.supervision.value.proof.verdict} measured <When iso={view.supervision.value.proof.measuredAt} />: killed pid{" "}
                {view.supervision.value.proof.killedPid}, relaunched pid {view.supervision.value.proof.relaunchedPid} after{" "}
                {view.supervision.value.proof.secondsToRelaunch} s.
              </>
            ) : (
              `No relaunch proof at ${view.supervision.value.proofPath} on the runner's checkout.`
            )}
          </p>
        </>
      ) : (
        <p>
          <GapNote gap={view.supervision.gap} where="Research · host supervision" returnTo={HERE} />
        </p>
      )}

      {/* RESEARCH METRICS (RULING 244), each with its meaning and a picture (ADM-11) */}
      <h2>Research metrics</h2>
      {metrics ? (
        <>
          <p className="note">
            Computed by the last cycle <When iso={metrics.record.computedAt} />. Every number carries how it was
            counted; the sentence beside it says what it means.
          </p>
          <MetricGroup title="Capacity" meaning={METRIC_GROUP_MEANING.capacity} rows={metrics.rows.capacity} />
          <MetricGroup title="Queue by band" meaning={METRIC_GROUP_MEANING.queueBands} rows={metrics.rows.queueBands}>
            {metrics.record.ordering && (
              <BarChart
                caption="Due model-class work waiting, by band"
                rows={([1, 2, 3] as const).map((b) => ({
                  label: `Band ${b}`,
                  value: metrics.record.ordering?.bands[b] ?? 0,
                  shown: String(metrics.record.ordering?.bands[b] ?? 0),
                  hint: b === 1 ? "feeds a reader now" : b === 2 ? "completes a universe" : "long tail",
                }))}
              />
            )}
          </MetricGroup>
          <MetricGroup title="Graduation funnel" meaning={METRIC_GROUP_MEANING.funnel} rows={metrics.rows.funnel}>
            <Funnel
              caption="From found to trusted"
              stages={metrics.record.funnel.stages.map((s) => ({ label: s.stage.toLowerCase().replaceAll("_", " "), count: s.count, hint: s.source }))}
            />
          </MetricGroup>
          <MetricGroup title="Model vs deterministic share" meaning={METRIC_GROUP_MEANING.share} rows={metrics.rows.share}>
            <div className="chart-row">
              <StackedBar
                caption={`This cycle: ${metrics.record.share.thisCycle.model + metrics.record.share.thisCycle.deterministic} dispatched`}
                total={metrics.record.share.thisCycle.model + metrics.record.share.thisCycle.deterministic}
                parts={[
                  { label: "paid model", value: metrics.record.share.thisCycle.model, className: "part-model" },
                  { label: "plain code", value: metrics.record.share.thisCycle.deterministic, className: "part-deterministic" },
                ]}
              />
              <StackedBar
                caption={`Trailing ${metrics.record.share.window.cycles} cycle(s): ${metrics.record.share.window.model + metrics.record.share.window.deterministic} dispatched`}
                total={metrics.record.share.window.model + metrics.record.share.window.deterministic}
                parts={[
                  { label: "paid model", value: metrics.record.share.window.model, className: "part-model" },
                  { label: "plain code", value: metrics.record.share.window.deterministic, className: "part-deterministic" },
                ]}
              />
            </div>
          </MetricGroup>
          <MetricGroup title="Cache hit rate by role" meaning={METRIC_GROUP_MEANING.cache} rows={metrics.rows.cache}>
            <div className="chart-row">
              {metrics.record.cacheByRole.map((r) => {
                const total = r.cacheRead + r.cacheWrite + r.uncachedInput;
                return (
                  <Ring
                    key={r.role}
                    value={r.cacheRead}
                    total={total}
                    label={`${r.role} cache hits`}
                    shown={total === 0 ? "—" : `${Math.round((r.cacheRead / total) * 100)}%`}
                  />
                );
              })}
            </div>
          </MetricGroup>
          <MetricGroup title="Cost per useful outcome" meaning={METRIC_GROUP_MEANING.costPerOutcome} rows={metrics.rows.costPerOutcome}>
            <BarChart
              caption="Measured spend per outcome, by kind"
              rows={metrics.record.costPerOutcome
                .filter((o) => o.usdPerOutcome !== null)
                .map((o) => ({
                  label: o.outcome.toLowerCase().replaceAll("_", " "),
                  value: o.usdPerOutcome ?? 0,
                  shown: `${usd(o.usdPerOutcome ?? 0)} × ${o.count}`,
                }))}
            />
          </MetricGroup>
        </>
      ) : (
        metricsGap && (
          <p>
            <GapNote gap={metricsGap} where="Research metrics" returnTo={HERE} />
          </p>
        )
      )}

      {/* SCOUTS */}
      <h2>Scouts</h2>
      <p>
        Concurrency: <Stat h={view.concurrency} where="Scouts · concurrency" />
      </p>
      <p>
        Spend in the rolling window: <Stat h={view.spend.windowUsd} format={usd} where="Scouts · spend in window" />
      </p>
      {view.spend.capDeferredNote && <p className="note">Cap-deferred: {view.spend.capDeferredNote}</p>}
      <p>
        Measured Attempts: <Stat h={view.spend.measuredAttempts} where="Scouts · measured attempts" />
      </p>
      <p>
        Unmeasured Attempts: <Stat h={view.spend.unmeasuredAttempts} where="Scouts · unmeasured attempts" />
      </p>

      <h3>Queue — bounded model workers</h3>
      {view.queue.held ? (
        <ul>
          <li>
            Due: <Stat h={view.queue.value.due} where="Scouts · queue due" />
          </li>
          <li>
            Registered to the model lane: <Stat h={view.queue.value.queued} where="Scouts · queue registered" />
          </li>
          <li>
            Dispatched this cycle: <Stat h={view.queue.value.dispatchedThisCycle} where="Scouts · dispatched this cycle" />
          </li>
          <li>
            Deferred for the ceiling: <Stat h={view.queue.value.deferredForCeiling} where="Scouts · deferred for the ceiling" />
          </li>
          <li>
            Deferred for the cycle maximum: <Stat h={view.queue.value.deferredForCycleMax} where="Scouts · deferred for the cycle maximum" />
          </li>
          <li>
            Deferred for the lane: <Stat h={view.queue.value.deferredForLane} where="Scouts · deferred for the lane" />
          </li>
          <li>
            Deterministic units dispatched this cycle:{" "}
            <Stat h={view.queue.value.deterministicDispatched} where="Scouts · deterministic dispatched" />
          </li>
        </ul>
      ) : (
        <p>
          <GapNote gap={view.queue.gap} where="Scouts · queue" returnTo={HERE} />
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
                <Name raw={scout.obligationId} candidateNames={candidateNames} /> · <Name raw={scout.attemptId} /> · started <When iso={scout.startedAt} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <p>
          <GapNote gap={view.running.gap} where="Scouts · running" returnTo={HERE} />
        </p>
      )}

      {/* SCOUT ATTEMPTS */}
      <h2>
        Scout Attempts —{" "}
        {view.results.held ? <Count m={view.results.value.shown} /> : <GapNote gap={view.results.gap} where="Scout attempts" returnTo={HERE} />}
      </h2>
      {view.results.held && view.results.value.rows.length === 0 && (
        <p className="note">No typed Scout result is on record in this control plane, so there is no row to list.</p>
      )}
      {view.results.held && view.results.value.rows.length > 0 && (
        <div className="scroll-x">
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
                  <Name raw={row.subject} candidateNames={candidateNames} />
                  <div className="note">
                    <Name raw={row.obligationId} candidateNames={candidateNames} />
                  </div>
                </td>
                <td>{row.reason}</td>
                <td>{row.model === "DETERMINISTIC_NO_MODEL" ? <span title={row.model}>plain code, no model</span> : row.model}</td>
                <td>{seconds(row.elapsedMs)}</td>
                <td>{row.usd === null ? <span className="gap">unmeasured</span> : usd(row.usd)}</td>
                <td>
                  {row.outcome.toLowerCase().replaceAll("_", " ")}
                  <div className="note">
                    stopped by {row.stoppedBy.toLowerCase().replaceAll("_", " ")}; {row.artifactCount} artifact(s); {row.candidateCount}{" "}
                    candidate(s); recorded <When iso={row.recordedAt} />
                  </div>
                </td>
                <td>
                  <Name raw={row.workItemId} />
                  <br />
                  <Name raw={row.attemptId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
          <GapNote gap={view.evidence.gap} where="Scout evidence" returnTo={HERE} />
        )}
      </p>
      <p>
        Method candidates:{" "}
        {view.methodCandidates.held ? (
          <>
            validated <Stat h={view.methodCandidates.value.validated} where="Method candidates · validated" />; admitted{" "}
            <Stat h={view.methodCandidates.value.admitted} where="Method candidates · admitted" />; rejected{" "}
            <Stat h={view.methodCandidates.value.rejected} where="Method candidates · rejected" />
          </>
        ) : (
          <GapNote gap={view.methodCandidates.gap} where="Method candidates" returnTo={HERE} />
        )}
      </p>

      {/* LAST NIGHTLY WINDOW (RULING 242) — one line, one picture, the rest behind a disclosure (ADM-13) */}
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
      <p className="plain">{windowPlain.headline}</p>
      {windowPlain.stages.length > 0 && (
        <ol className="stage-strip" aria-label="The window's stages">
          {windowPlain.stages.map((s) => (
            <li key={s.stage} className={`stage stage-${s.ok === true ? "ok" : s.ok === false ? "failed" : "unknown"}`} title={`${s.stage}: ${s.outcome}${s.reason ? ` — ${s.reason}` : ""}`}>
              <i className="stage-mark" aria-hidden="true" /> {s.label}
            </li>
          ))}
        </ol>
      )}
      {windowPlain.split && (
        <StackedBar
          caption={`${windowPlain.split.items} items in the pipeline`}
          total={windowPlain.split.items}
          parts={[
            { label: "promoted", value: windowPlain.split.promoted, className: "part-promoted" },
            { label: "would promote", value: windowPlain.split.wouldPromote, className: "part-would" },
            { label: "refused", value: windowPlain.split.refused, className: "part-refused" },
            { label: "deferred", value: windowPlain.split.deferred, className: "part-deferred" },
          ]}
        />
      )}
      {windowPlain.classes.length > 0 && (
        <div className="scroll-x">
        <table className="window-classes">
          <thead>
            <tr>
              <th>Record class</th>
              <th className="n">Items</th>
              <th className="n">Would promote</th>
              <th className="n">Refused</th>
              <th className="n">Deferred</th>
            </tr>
          </thead>
          <tbody>
            {windowPlain.classes.map((c) => (
              <tr key={c.recordClass}>
                <td>{c.label}</td>
                <td className="n">{c.items}</td>
                <td className="n">{c.wouldPromote}</td>
                <td className="n">{c.refused}</td>
                <td className="n">{c.deferred}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <details className="ph-evidence">
        <summary>Window detail — definitions, the gate, the legacy refresh, controls, proof</summary>
        {windowView.reasons.length > 0 && (
          <ul>
            {windowView.reasons.map((r) => (
              <li key={r}>
                <Said text={r} />
              </li>
            ))}
          </ul>
        )}
        {windowView.time.held ? (
          <p className="note">
            Window <code>{windowView.time.value.windowId}</code> for {windowView.time.value.localDate} (
            {windowView.time.value.zone}), {windowView.time.value.trigger}, mode {windowView.time.value.mode};
            scheduled <When iso={windowView.time.value.scheduledFor} />; ran <When iso={windowView.time.value.startedAt} /> →{" "}
            <When iso={windowView.time.value.finishedAt} />; host {windowView.time.value.host}; SHA{" "}
            {windowView.time.value.testedSha ?? "unrecorded"}
            {windowView.time.value.caughtUp.length > 0
              ? `; caught up ${windowView.time.value.caughtUp.join(", ")}`
              : ""}
            .
          </p>
        ) : (
          <p>
            <GapNote gap={windowView.time.gap} where="Nightly window" returnTo={HERE} />
          </p>
        )}
        {windowView.gate.held && (
          <p className="note">
            Gate: <Said text={windowView.gate.value.reason} />
          </p>
        )}
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
          Promoted: <Stat h={windowView.promoted} where="Nightly window · promoted" /> · Would promote: <Stat h={windowView.wouldPromote} where="Nightly window · would promote" /> ·
          Refused: <Stat h={windowView.refused} where="Nightly window · refused" /> · Deferred: <Stat h={windowView.deferred} where="Nightly window · deferred" />
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
            <GapNote gap={windowView.byRecordClass.gap} where="Nightly window · by record class" returnTo={HERE} />
          </p>
        )}
        <p>
          Legacy refresh:{" "}
          {windowView.legacy.held ? (
            <>
              ran <Count m={windowView.legacy.value.ran} /> ({windowView.legacy.value.source})
            </>
          ) : (
            <GapNote gap={windowView.legacy.gap} where="Nightly window · legacy refresh" returnTo={HERE} />
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
            <GapNote gap={windowView.controls.gap} where="Nightly window · controls" returnTo={HERE} />
          )}
        </p>
        <p>
          Served-surface check:{" "}
          {windowView.verification.held ? (
            `${windowView.verification.value.instrument}: ${windowView.verification.value.verdict}`
          ) : (
            <GapNote gap={windowView.verification.gap} where="Nightly window · served-surface check" returnTo={HERE} />
          )}
        </p>
        <p>
          Incidents:{" "}
          {windowView.incidents.held ? (
            <Count m={windowView.incidents.value.shown} />
          ) : (
            <GapNote gap={windowView.incidents.gap} where="Nightly window · incidents" returnTo={HERE} />
          )}
        </p>
        {windowView.incidents.held && windowView.incidents.value.rows.length > 0 && (
          <ul>
            {windowView.incidents.value.rows.map((i) => (
              <li key={i.incidentId}>
                <code>{i.incidentId}</code> {i.stage} {i.code} — <Said text={i.detail} />
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
      </details>

      {/* CONTROLS */}
      <h2>Controls</h2>
      <div className="controls-row">
        <form method="post" action={INTENT_ROUTE}>
          <input type="hidden" name="action" value={view.pauseAction} />
          <input type="hidden" name="returnTo" value={HERE} />
          <button type="submit" className="primary">
            {view.pauseAction === "PAUSE" ? "Pause research" : "Resume research"}
          </button>
        </form>
        <form method="post" action={INTENT_ROUTE}>
          <input type="hidden" name="action" value="RUN_CYCLE_NOW" />
          <input type="hidden" name="returnTo" value={HERE} />
          <button type="submit" className="primary">Run a cycle now</button>
        </form>
      </div>
      <p className="note">
        Each button appends an intent the standing runner honors on its next cycle. Nothing here
        edits the runner directly; an intent is pending until the runner records that it honored it.
      </p>

      <h3>
        Intents recorded —{" "}
        {view.intents.held ? <Count m={view.intents.value.shown} /> : <GapNote gap={view.intents.gap} where="Intents recorded" returnTo={HERE} />}
      </h3>
      {view.intents.held && view.intents.value.rows.length === 0 && (
        <p className="note">No owner intent has been recorded in this control plane yet; the first one you send appears here.</p>
      )}
      {view.intents.held && view.intents.value.rows.length > 0 && (
        <ul>
          {view.intents.value.rows.map((intent) => (
            <li key={intent.intentId}>
              <When iso={intent.requestedAt} /> · <strong>{intent.action.replaceAll("_", " ").toLowerCase()}</strong> · {intent.actor} ·{" "}
              <span className={intent.status === "HONORED" ? "state-green" : "state-unknown"}>
                {intent.status === "HONORED" ? "honored" : "pending"}
              </span>
              {intent.honoredAt ? (
                <>
                  {" "}
                  · honored <When iso={intent.honoredAt} /> by {intent.honoredBy ?? ""}: <Said text={intent.detail} />
                </>
              ) : (
                ""
              )}
            </li>
          ))}
        </ul>
      )}

      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail} Read at <When iso={view.nowIso} />.
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
