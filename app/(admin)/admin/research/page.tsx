import { readWorkerFleet } from "@/lib/control-plane/workers/readback.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import { WorkerFleetPanel } from "./worker-fleet-panel";
/**
 * **RESEARCH — WHAT THE FLEET IS DOING RIGHT NOW, IN ENGLISH.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241, RULING 268;
 * rewritten for the 9.6.26 owner review, ADM-42 through ADM-48 and §9A.11.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session, both enforced upstream
 * in `middleware.ts`. Reads the durable control plane and nothing else. The
 * verdict is DERIVED at render time by `buildResearchView`; nothing here reads
 * a stored one. Two audits run against what is about to be rendered, and a
 * failure replaces the numbers with a refusal — as the control centre does.
 *
 * ## What the owner asked this page to stop doing
 *
 * - The heading printed an activation level number where a STATE belongs, and
 *   named a level without saying what the levels are (*"out of how many
 *   levels? What does that mean?"*). The heading is the state now; the levels
 *   are secondary detail, quoted from governance rather than invented
 *   (RULING 268, RULING 215).
 * - A back-link to Pilot health duplicated the View dropdown: *"I don't need a
 *   back section to go back to Pilot Health. I have the dropdown."*
 * - `COMPLETED` sat beside a document that was never fetched. Every result row
 *   now says what happened, what happens next and whether it needs him, and
 *   **a public record is never presented as permanently unobtainable** — the
 *   transparency mandate, RULING 248, enforced in `plain-work.ts`.
 * - The Scout `reason` column printed the executor's own sentence about why a
 *   model was spent. It is disclosure detail now; the face says what the
 *   system was trying to obtain.
 * - Identifiers wrapped into vertical strips. A name leads, the exact id is
 *   one disclosure and one copy button away (`identity.tsx`).
 *
 * The worker credential appears as a configured/not-configured fact and
 * NOTHING else. Its variable NAME is never rendered — not on the face, not in
 * a hover, not in a disclosure — and nothing in this file reads the
 * environment.
 *
 * Every read the page needs is issued in ONE round (ADM-14): the ten reads
 * used to run as a group of six, then the fleet, then the window, then its
 * incidents — four sequential trips to Neon on every view switch.
 */

import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, readHeartbeat, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { displayNameOf } from "@/lib/control-plane/display-name.ts";
import { readMethodCandidateAuthorityStatus } from "@/lib/control-plane/method-candidate-authority.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered } from "@/lib/control-plane/owner-surface.ts";
import { plainWindow } from "@/lib/control-plane/plain-window.ts";
import { modelName, plainCode, plainMeaning, plainText, usdCents } from "@/lib/control-plane/plain-words.ts";
import { scoutStory } from "@/lib/control-plane/plain-work.ts";
import { METRIC_GROUP_MEANING, metricGroupLead, type DigestRow } from "@/lib/control-plane/research-digest.ts";
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
import { GapNote, HeldNum, Name, Num, QueueForm, Said, When } from "../../console-ui.tsx";
import { NeedsYouLine, Plain, StatusBlock, type NeedsYou } from "../../status-ui.tsx";
import { Identity } from "./identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTENT_ROUTE = "/api/admin/research";
const HERE = "/admin/research";
const NEEDS_NOTHING: NeedsYou = { needed: false };

/* ------------------------------------------------------------------ *
 * SMALL RENDER HELPERS
 * ------------------------------------------------------------------ */

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The digest's UNMEASURED / NOT MEASURED sentinels read as words; the code stays on hover. */
function metricValue(value: string): { readonly shown: string; readonly title: string | undefined } {
  if (value === "UNMEASURED" || value === "NOT MEASURED") return { shown: "not measured", title: value };
  if (value === "NOT ORDERED") return { shown: "nothing to sort", title: value };
  return { shown: value, title: undefined };
}

function Refusal({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <main className="admin">
      <h1>Research</h1>
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

/**
 * One metric group: what it is for, what it currently says, then its rows —
 * each with a meaning on the face and the instrument's own denominator behind
 * a disclosure (ADM-11, ADM-46).
 */
function MetricGroup({
  title,
  meaning,
  lead,
  rows,
  children,
}: {
  title: string;
  meaning: string;
  lead?: string | null;
  rows: readonly DigestRow[];
  children?: React.ReactNode;
}) {
  const technical = rows.filter((row) => (row.technical ?? "").trim() !== "");
  return (
    <section className="metric-group card">
      <h3>{title}</h3>
      {/* Every card says whether it needs him, at the top (POS-14). A measurement never does. */}
      <NeedsYouLine needs={NEEDS_NOTHING} />
      {lead && <p className="plain">{lead}</p>}
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
            {rows.map((row) => {
              const shown = metricValue(row.value);
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="n">
                    <strong title={shown.title}>{shown.shown}</strong>
                  </td>
                  <td>
                    {row.meaning}
                    <div className="note">{row.denominator}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {technical.length > 0 && (
        <details className="raw-ids">
          <summary>Where these numbers come from, in the instrument&rsquo;s own words</summary>
          <ul>
            {technical.map((row) => (
              <li key={row.label} className="note">
                <strong>{row.label}</strong> — {row.technical}
              </li>
            ))}
          </ul>
        </details>
      )}
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
  const [heartbeat, state, intents, results, spend, evidence, fleet, lastWindow, snapshotOut, methodAuthority] = await Promise.all([
    readHeartbeat(opened.repos),
    readResearchState(opened.repos),
    readResearchIntents(opened.repos),
    readScoutResults(opened.repos),
    readScoutSpend(opened.repos, nowIso),
    readScoutEvidenceCount(opened.repos),
    readWorkerFleet(opened.repos, nowIso),
    readLastWindow(opened.repos),
    readSnapshot(opened.repos),
    readMethodCandidateAuthorityStatus(opened.repos),
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
  const leads = metrics ? metricGroupLead(metrics.record) : null;

  // The runner card's four lines (ADM-24's shape, applied here by ADM-42).
  const standing = view.runner.standing;
  const runnerNeedsYou: NeedsYou =
    standing.level === "RED"
      ? { needed: true, action: "start the runner again on the research machine, or record a pause so this reads as deliberate" }
      : standing.state === "PAUSED"
        ? { needed: true, action: "resume it when you want the research to carry on — it is paused because you paused it" }
        : NEEDS_NOTHING;
  const safety = view.safety.held ? view.safety.value : null;
  const stopped = safety ? safety.stoppedBecause : [];

  return (
    <main className="admin console-page">
      {/* The one console header (9.4.26): this is the instrument-detail view of the same console. */}
      <ConsoleNav view="research" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />
      <h1>
        Research — <span className={verdictClass}>{plainCode(view.verdict)}</span>
      </h1>
      <p className="plain">{verdictPlain}</p>
      <NeedsYouLine needs={view.verdict === "ACTIVE" ? NEEDS_NOTHING : runnerNeedsYou} />
      <details className="ph-evidence">
        <summary>What &ldquo;research&rdquo; is allowed to do here, and what the levels are</summary>
        <p className="note">
          Research is activation <strong>Level 1</strong>. At Level 1 the standing system may go looking for public
          sources on its own, fetch them, read them, investigate what it cannot read, and learn reusable methods — all
          inside a daily spending limit, and all without asking you first. What it may never do at Level 1 is publish:
          reader-facing truth changes through the nightly window and nothing else (RULING 268).
        </p>
        <p className="note">
          The levels above it are not a ladder this system is climbing. <strong>Level 4</strong> — publishing to readers
          without a person in the loop — is deliberately deferred past the November 2026 election.{" "}
          <strong>Level 5</strong> — agents filing records requests and writing to outside parties — was removed from
          the architecture entirely (RULING 215). Nothing between Level 1 and Level 4 is defined in current governance,
          so this page does not name one.
        </p>
      </details>
      {view.verdict !== "ACTIVE" && (
        <details className="ph-evidence" open>
          <summary>Why, in the instrument&rsquo;s words — {view.reasons.length}</summary>
          <ul>
            {view.reasons.map((reason) => (
              <li key={reason}>
                <Said text={plainText(reason)} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <WorkerFleetPanel view={fleet} candidateNames={candidateNames} />

      {/* RUNNER — what it is, what it did, why it stopped, when it runs again (ADM-24 shape) */}
      <h2>The runner</h2>
      <section className={`card runner-card l-${standing.level}`}>
        <StatusBlock
          what={
            <>
              <strong>The runner</strong> is the always-on program on the research machine. It wakes on a clock, runs one
              cycle of hunting and refreshing, writes down what it did, and sleeps until the next one. Right now it is{" "}
              <span className={standing.level === "GREEN" ? "state-green" : standing.level === "RED" ? "state-red" : "state-unknown"}>
                {plainCode(standing.headline)}
              </span>
              .
            </>
          }
          happened={
            <>
              <Said text={plainText(standing.detail)} />{" "}
              {view.runner.lastCycleStartedAt === null ? (
                "No cycle start is on record in this heartbeat."
              ) : (
                <>
                  The last cycle started <When iso={view.runner.lastCycleStartedAt} />
                  {view.runner.lastCycleFinishedAt === null ? " and has not reported finishing" : <> and finished <When iso={view.runner.lastCycleFinishedAt} /></>}.
                </>
              )}
            </>
          }
          next={
            view.runner.nextCycleDueAt === null ? (
              <GapNote
                gap={{
                  whose: "OURS",
                  says: "the runner did not write a next-cycle time in this heartbeat, which is what it does when it was started without an interval; it is not a claim that no cycle is scheduled",
                }}
                where="Runner · next cycle"
                returnTo={HERE}
              />
            ) : (
              <>
                It runs again <When iso={view.runner.nextCycleDueAt} />.
              </>
            )
          }
          needsYou={runnerNeedsYou}
          detailLabel="Technical details"
          detail={
            <>
              {view.cycle.held ? (
                <p className="note">
                  Research state written <When iso={view.cycle.value.beatAt} />; machine {view.cycle.value.host}; code
                  version {view.cycle.value.testedSha === null ? "not recorded" : view.cycle.value.testedSha}; model{" "}
                  {modelName(view.cycle.value.model)}; model lane{" "}
                  {view.cycle.value.modelLaneEnabled ? (
                    "enabled"
                  ) : (
                    <>
                      off — <Plain text={view.cycle.value.modelLaneDisabledReason} />
                    </>
                  )}
                  .
                </p>
              ) : (
                <p>
                  <GapNote gap={view.cycle.gap} where="Research · runner cycle" returnTo={HERE} />
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
              {view.workerCredential.held && (
                <p className="note">
                  {`Model credential provenance: provider ${view.workerCredential.value.provider}; read in ${view.workerCredential.value.context}. The variable's name is deliberately absent from this page.`}
                </p>
              )}
              {stopped.length > 0 && (
                <ul>
                  {stopped.map((reason) => (
                    <li key={reason} className="note" title={reason}>
                      <Plain text={reason} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          }
        >
          <p className="note">
            {/*
              The credential is a yes/no fact and nothing more. Its variable NAME is never rendered, and the
              provider/context strings stay out of the face too: the recorded context carries a hostname and a
              command flag, neither of which the owner should ever have to read (§3 safety law).
            */}
            {view.workerCredential.held ? (
              view.workerCredential.value.configured
                ? "The model credential the workers use is set up on the runner. Its value and its name stay on the server."
                : "The model credential the workers use is NOT set up on the runner, so no paid model work can run until it is."
            ) : (
              <GapNote gap={view.workerCredential.gap} where="Research · worker credential" returnTo={HERE} />
            )}
          </p>
          {!view.safety.held ? (
            <p className="note">
              <GapNote gap={view.safety.gap} where="Runner · why work stopped" returnTo={HERE} />
            </p>
          ) : stopped.length === 0 ? (
            <p className="note">Nothing cut this cycle short: it did the work it had budget and time for.</p>
          ) : (
            <p className="note">
              {`Work stopped early for ${stopped.length} named reason${stopped.length === 1 ? "" : "s"} — the first is `}
              <strong>{plainCode(stopped[0].split(":")[0])}</strong>
              {plainMeaning(stopped[0].split(":")[0]) === null ? ". " : `. ${plainMeaning(stopped[0].split(":")[0])} `}
              Every deferred item keeps its place in line; none of it was dropped, and the rest are under Technical
              details.
            </p>
          )}
          {safety !== null && safety.providerCircuits.length === 0 && (
            <p className="note">No data source is currently being throttled.</p>
          )}
          {safety !== null &&
            safety.providerCircuits.map((circuit) => (
              <p className="note" key={circuit.provider}>
                <strong>{circuit.provider}</strong> is paused until <When iso={circuit.eligibleAt} /> and retries by
                itself after that. <Said text={plainText(circuit.condition)} />
              </p>
            ))}
        </StatusBlock>
      </section>

      {/* HOST SUPERVISION (RULING 246) */}
      <h2>If the runner is killed, does it come back?</h2>
      {view.supervision.held ? (
        <section className="card">
          <StatusBlock
            what={
              <>
                The research machine is supposed to restart the runner by itself if the process dies. This is whether
                that has actually been proved, rather than assumed:{" "}
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
                    ? "never tested"
                    : view.supervision.value.condition.ok
                      ? "proved"
                      : "not proved"}
                </span>
                .
              </>
            }
            happened={
              view.supervision.value.condition ? (
                <Said text={plainText(view.supervision.value.condition.reason)} />
              ) : (
                <GapNote
                  gap={{
                    whose: "OURS",
                    says: "the derived verdict carried no host-supervision condition; the cycle that wrote this state predates the rule that requires one",
                  }}
                  where="Research · host supervision"
                  returnTo={HERE}
                />
              )
            }
            next={
              view.supervision.value.proof === null
                ? "Next: the restart test is run again on the machine and its result travels here with the next cycle."
                : view.supervision.value.proof.verdict === "RELAUNCHED"
                  ? "Next: the test is re-run monthly, because it proves a property of a scheduled task that only changes when someone changes it."
                  : "Next: the restart trigger is repaired on the machine and the test is run again."
            }
            needsYou={
              view.supervision.value.condition === null || view.supervision.value.condition.ok
                ? NEEDS_NOTHING
                : { needed: true, action: "re-run the restart proof on the research machine — until it passes, a killed runner may stay dead" }
            }
            detailLabel="Technical details"
            detail={
              <p className="note">
                Read on {view.supervision.value.host} <When iso={view.supervision.value.checkedAt} />.{" "}
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
                      : `not measurable on this host: ${view.supervision.value.notMeasurableReason === null ? "" : view.supervision.value.notMeasurableReason}`
                  }
                />
                {view.supervision.value.proof ? (
                  <>
                    {" "}
                    Proof {plainCode(view.supervision.value.proof.verdict)} measured{" "}
                    <When iso={view.supervision.value.proof.measuredAt} />: killed process{" "}
                    {view.supervision.value.proof.killedPid}, relaunched process{" "}
                    {view.supervision.value.proof.relaunchedPid} after {view.supervision.value.proof.secondsToRelaunch} s.
                  </>
                ) : (
                  <> No relaunch proof is on the runner&rsquo;s checkout at {view.supervision.value.proofPath}.</>
                )}
              </p>
            }
          />
        </section>
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
          <MetricGroup title="Capacity" meaning={METRIC_GROUP_MEANING.capacity} lead={leads?.capacity} rows={metrics.rows.capacity} />
          <MetricGroup title="What is waiting, in order" meaning={METRIC_GROUP_MEANING.queueBands} lead={leads?.queueBands} rows={metrics.rows.queueBands}>
            {metrics.record.ordering && (
              <BarChart
                caption="Work waiting that needs a model, by how soon a reader feels it"
                rows={([1, 2, 3] as const).map((b) => ({
                  label: `Band ${b}`,
                  value: metrics.record.ordering?.bands[b] ?? 0,
                  shown: String(metrics.record.ordering?.bands[b] ?? 0),
                  hint: b === 1 ? "a reader is waiting on it" : b === 2 ? "finishes a whole class of source" : "the long tail",
                }))}
              />
            )}
          </MetricGroup>
          <MetricGroup title="Graduation funnel" meaning={METRIC_GROUP_MEANING.funnel} lead={leads?.funnel} rows={metrics.rows.funnel}>
            <Funnel
              caption="From found to trusted"
              stages={metrics.record.funnel.stages.map((s, index) => ({
                label: metrics.rows.funnel[index]?.label ?? s.stage.toLowerCase().replaceAll("_", " "),
                count: s.count,
                hint: metrics.rows.funnel[index]?.denominator ?? s.source,
              }))}
            />
          </MetricGroup>
          <MetricGroup title="Paid model versus plain code" meaning={METRIC_GROUP_MEANING.share} lead={leads?.share} rows={metrics.rows.share}>
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
          <MetricGroup title="How much of the reading was already paid for" meaning={METRIC_GROUP_MEANING.cache} lead={leads?.cache} rows={metrics.rows.cache}>
            <div className="chart-row">
              {metrics.record.cacheByRole.map((r) => {
                const total = r.cacheRead + r.cacheWrite + r.uncachedInput;
                return (
                  <Ring
                    key={r.role}
                    value={r.cacheRead}
                    total={total}
                    label={`${plainCode(r.role)} cache hits`}
                    shown={total === 0 ? "—" : `${Math.round((r.cacheRead / total) * 100)}%`}
                  />
                );
              })}
            </div>
          </MetricGroup>
          <MetricGroup title="What each useful result cost" meaning={METRIC_GROUP_MEANING.costPerOutcome} lead={leads?.costPerOutcome} rows={metrics.rows.costPerOutcome}>
            <BarChart
              caption="Measured spend per useful result"
              rows={metrics.record.costPerOutcome
                .filter((o) => o.usdPerOutcome !== null)
                .map((o) => ({
                  label: o.outcome.toLowerCase().replaceAll("_", " "),
                  value: o.usdPerOutcome ?? 0,
                  shown: `${usdCents(o.usdPerOutcome ?? 0)} × ${o.count}`,
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

      {/* HUNTERS */}
      <h2>Hunters — the paid model workers</h2>
      <NeedsYouLine
        needs={
          view.workerCredential.held && !view.workerCredential.value.configured
            ? { needed: true, action: "set the model credential up on the runner — until it is, no hunter can run at all" }
            : NEEDS_NOTHING
        }
      />
      <p className="note">
        A hunter is the one worker allowed to spend money on a model, and only when there is genuinely no known way in.
        These are its limits and what it is doing inside them.
      </p>
      <p>
        Running right now: <HeldNum h={view.concurrency} where="Scouts · concurrency" returnTo={HERE} />
      </p>
      <p>
        Spent in the last {view.spend.windowHours} hours:{" "}
        <HeldNum h={view.spend.windowUsd} format={usdCents} where="Scouts · spend in window" returnTo={HERE} />
      </p>
      {view.spend.capDeferredNote && (
        <p className="note">
          The daily limit is reached, so eligible work is waiting for the window to roll rather than being dropped:{" "}
          <Said text={plainText(view.spend.capDeferredNote)} />
        </p>
      )}
      <p>
        Attempts that reported what they cost:{" "}
        <HeldNum h={view.spend.measuredAttempts} where="Scouts · measured attempts" returnTo={HERE} />
      </p>
      <p>
        Attempts that reported nothing (never counted as free):{" "}
        <HeldNum h={view.spend.unmeasuredAttempts} where="Scouts · unmeasured attempts" returnTo={HERE} />
      </p>

      <h3>What is queued for them</h3>
      {view.queue.held ? (
        <ul>
          <li>
            Due now: <HeldNum h={view.queue.value.due} where="Scouts · queue due" returnTo={HERE} />
          </li>
          <li>
            Registered as needing a model:{" "}
            <HeldNum h={view.queue.value.queued} where="Scouts · queue registered" returnTo={HERE} />
          </li>
          <li>
            Started this cycle:{" "}
            <HeldNum h={view.queue.value.dispatchedThisCycle} where="Scouts · dispatched this cycle" returnTo={HERE} />
          </li>
          <li>
            Held back by the daily spending limit — owed, with their next-due:{" "}
            <HeldNum h={view.queue.value.deferredForCeiling} where="Scouts · deferred for the ceiling" returnTo={HERE} />
          </li>
          <li>
            Held back by the per-cycle job limit — owed, with their next-due:{" "}
            <HeldNum h={view.queue.value.deferredForCycleMax} where="Scouts · deferred for the cycle maximum" returnTo={HERE} />
          </li>
          <li>
            Held back because the model lane is off — owed, with their next-due:{" "}
            <HeldNum h={view.queue.value.deferredForLane} where="Scouts · deferred for the lane" returnTo={HERE} />
          </li>
          <li>
            Walked by plain code this cycle, no model spent:{" "}
            <HeldNum h={view.queue.value.deterministicDispatched} where="Scouts · deterministic dispatched" returnTo={HERE} />
          </li>
        </ul>
      ) : (
        <p>
          <GapNote gap={view.queue.gap} where="Scouts · queue" returnTo={HERE} />
        </p>
      )}

      <h3>Out on a job right now</h3>
      {view.running.held ? (
        view.running.value.length === 0 ? (
          <p className="note">No hunter was out when the research state was last written.</p>
        ) : (
          <ul>
            {view.running.value.map((scout) => (
              <li key={scout.attemptId}>
                <Name raw={scout.obligationId} candidateNames={candidateNames} /> · started <When iso={scout.startedAt} />
                <div className="note">
                  <Identity id={scout.attemptId} what="attempt id" />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p>
          <GapNote gap={view.running.gap} where="Scouts · running" returnTo={HERE} />
        </p>
      )}

      {/* SCOUT ATTEMPTS — every row says what it wanted, what happened, what happens next (ADM-48) */}
      <h2>
        Hunter attempts —{" "}
        {view.results.held ? (
          <Num m={view.results.value.shown} />
        ) : (
          <GapNote gap={view.results.gap} where="Scout attempts" returnTo={HERE} />
        )}
      </h2>
      {view.results.held && view.results.value.rows.length === 0 && (
        <p className="note">No hunter result is on record in this control plane, so there is no row to list.</p>
      )}
      {view.results.held && view.results.value.rows.length > 0 && (
        <div className="scroll-x">
          <table className="scout-attempts">
            <thead>
              <tr>
                <th>Subject</th>
                <th>What is happening</th>
                <th>Needs you</th>
                <th>Cost and time</th>
                <th>Attempt</th>
              </tr>
            </thead>
            <tbody>
              {view.results.value.rows.map((row) => {
                /* The next-due of the obligation does not travel on a Scout result, so the sentence says "a later cycle" rather than a time nobody measured. */
                const story = scoutStory(
                  {
                    recordClass: row.recordClass,
                    routeId: row.routeId,
                    outcome: row.outcome,
                    stoppedBy: row.stoppedBy,
                    refusalCodes: row.refusalCodes,
                    candidateCount: row.candidateCount,
                    artifactCount: row.artifactCount,
                    evidenceRungs: row.evidenceRungs,
                    nextRungs: row.nextRungs,
                  },
                  { name: displayNameOf(row.subject, { candidateNames }).name, retryPhrase: null },
                );
                return (
                  <tr key={`${row.attemptId}:${row.recordedAt}`}>
                    <td>
                      <Name raw={row.subject} candidateNames={candidateNames} />
                      <div className="note">
                        <Name raw={row.obligationId} candidateNames={candidateNames} />
                      </div>
                    </td>
                    <td>
                      <div className="scout-trying">{story.trying}</div>
                      <div>{story.happened}</div>
                      <div className="note">{story.next}</div>
                      <details className="raw-ids">
                        <summary>the instrument&rsquo;s own words</summary>
                        <small className="note">
                          Why a model was spent on it: <Said text={row.reason} />
                          <br />
                          Outcome <code>{row.outcome}</code>; the walk was ended by <code>{row.stoppedBy}</code>;{" "}
                          {row.evidenceRungs} evidence-backed route(s); {row.artifactCount} artifact(s);{" "}
                          {row.candidateCount} candidate(s); route{" "}
                          {row.routeId === null ? "none named on the obligation" : <code>{row.routeId}</code>}; record
                          class <code>{row.recordClass}</code>; recorded <When iso={row.recordedAt} />.
                          {row.refusalCodes.length > 0 && (
                            <>
                              <br />
                              Refused: {row.refusalCodes.map((code) => <code key={code}>{code} </code>)}
                            </>
                          )}
                          {row.nextRungs.length > 0 && (
                            <>
                              <br />
                              Next rungs owed: {row.nextRungs.join(", ")}
                            </>
                          )}
                        </small>
                      </details>
                    </td>
                    <td className={story.needsYou.needed ? "needs-yes" : "needs-no"}>
                      {story.needsYou.needed ? `Yes — ${story.needsYou.action}` : "No"}
                    </td>
                    <td>
                      {/* A run that never called a model cost $0; only a MODEL run with no figure is unmeasured (§9A.4). */}
                      {row.usd !== null ? (
                        <span title={`$${row.usd}`}>{usdCents(row.usd)}</span>
                      ) : row.model === "DETERMINISTIC_NO_MODEL" ? (
                        <span className="free" title="No model request was made on this attempt, so there is nothing to bill.">
                          {usdCents(0)} this run
                        </span>
                      ) : (
                        <span className="gap">cost not measured</span>
                      )}
                      <div className="note">
                        {seconds(row.elapsedMs)} ·{" "}
                        {row.model === "DETERMINISTIC_NO_MODEL" ? (
                          <span title={row.model}>plain code, no model</span>
                        ) : (
                          modelName(row.model)
                        )}
                      </div>
                    </td>
                    <td>
                      <Identity id={row.attemptId} what="attempt id" />
                      <div className="note">
                        <Identity id={row.workItemId} what="work item id" candidateNames={candidateNames} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* EVIDENCE AND METHOD CANDIDATES */}
      <h2>Evidence and the methods learned from it</h2>
      <p>
        Evidence the hunters filed:{" "}
        {view.evidence.held ? (
          <>
            separate documents <Num m={view.evidence.value.distinctArtifacts} />; attempts that filed at least one{" "}
            <Num m={view.evidence.value.attemptsWithEvidence} />
          </>
        ) : (
          <GapNote gap={view.evidence.gap} where="Scout evidence" returnTo={HERE} />
        )}
      </p>
      <p>
        Methods proposed from that evidence:{" "}
        {view.methodCandidates.held ? (
          <>
            passed validation{" "}
            <HeldNum h={view.methodCandidates.value.validated} where="Method candidates · validated" returnTo={HERE} />;
            admitted to the toolbox{" "}
            <HeldNum h={view.methodCandidates.value.admitted} where="Method candidates · admitted" returnTo={HERE} />;
            refused{" "}
            <HeldNum h={view.methodCandidates.value.rejected} where="Method candidates · rejected" returnTo={HERE} />
          </>
        ) : (
          <GapNote gap={view.methodCandidates.gap} where="Method candidates" returnTo={HERE} />
        )}
      </p>
      <section className="card">
        <h3>
          Method-candidate authority —{" "}
          <span
            className={
              methodAuthority.state === "ADOPTED"
                ? "state-green"
                : methodAuthority.state === "REFUSED" || methodAuthority.state === "STORE_UNREACHABLE"
                  ? "state-red"
                  : "state-unknown"
            }
          >
            {plainCode(methodAuthority.state)}
          </span>
        </h3>
        <NeedsYouLine
          needs={
            methodAuthority.state === "ADOPTED"
              ? NEEDS_NOTHING
              : {
                  needed: true,
                  action: "leave method-candidate writes held while engineering restores or verifies the named control-plane authority",
                }
          }
        />
        <p className="plain">
          {methodAuthority.state === "ADOPTED"
            ? "The live method-learning queue is owned by the production control plane. Its historical Git seed is evidence only."
            : methodAuthority.detail}
        </p>
        <details className="raw-ids">
          <summary>Authority and adoption evidence</summary>
          <p className="note">
            Canonical aggregate <code>cp_method_candidates/live</code>; current revision{" "}
            {methodAuthority.aggregateRevision ?? "not readable"}; status code <code>{methodAuthority.code}</code>.
            {methodAuthority.aggregateUpdatedAt !== null && (
              <> The aggregate was last written <When iso={methodAuthority.aggregateUpdatedAt} />.</>
            )}
            {methodAuthority.verifierCodeSha !== null && (
              <>
                {" "}The adoption receipt binds clean, detached verifier <code>{methodAuthority.verifierCodeSha}</code>
                {methodAuthority.verifiedAt === null ? "." : <> and was recorded <When iso={methodAuthority.verifiedAt} />.</>}
              </>
            )}
          </p>
          <p className="note">{methodAuthority.detail}</p>
        </details>
      </section>

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
          {plainCode(windowView.verdict)}
        </span>
      </h2>
      <p className="plain">{windowPlain.headline}</p>
      {windowPlain.stages.length > 0 && (
        <ol className="stage-strip" aria-label="The window's stages">
          {windowPlain.stages.map((s) => (
            <li
              key={s.stage}
              className={`stage stage-${s.ok === true ? "ok" : s.ok === false ? "failed" : "unknown"}`}
              title={`${s.stage}: ${s.outcome}${s.reason ? ` — ${s.reason}` : ""}`}
            >
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
        <summary>Window detail — definitions, the gate, controls, proof</summary>
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
            {windowView.time.value.testedSha === null ? "unrecorded" : windowView.time.value.testedSha}
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
                <strong>{plainCode(s.stage)}</strong> {plainCode(s.outcome)}
                {s.reason ? ` — ${s.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
        <p>
          Promoted: <HeldNum h={windowView.promoted} where="Nightly window · promoted" returnTo={HERE} /> · Would promote:{" "}
          <HeldNum h={windowView.wouldPromote} where="Nightly window · would promote" returnTo={HERE} /> · Refused:{" "}
          <HeldNum h={windowView.refused} where="Nightly window · refused" returnTo={HERE} /> · Deferred:{" "}
          <HeldNum h={windowView.deferred} where="Nightly window · deferred" returnTo={HERE} />
        </p>
        {windowView.byRecordClass.held ? (
          <ul>
            {windowView.byRecordClass.value.map((row) => (
              <li key={row.recordClass}>
                <code>{row.recordClass}</code>: would promote <Num m={row.promoteWould} />; refused{" "}
                <Num m={row.refuseWould} />; deferred <Num m={row.deferred} />
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <GapNote gap={windowView.byRecordClass.gap} where="Nightly window · by record class" returnTo={HERE} />
          </p>
        )}
        <p>
          Controls:{" "}
          {windowView.controls.held ? (
            <>
              recall <Num m={windowView.controls.value.recall} />; false absences{" "}
              <Num m={windowView.controls.value.falseAbsences} />; false presences{" "}
              <Num m={windowView.controls.value.falsePresences} />
            </>
          ) : (
            <GapNote gap={windowView.controls.gap} where="Nightly window · controls" returnTo={HERE} />
          )}
        </p>
        <p>
          Incidents:{" "}
          {windowView.incidents.held ? (
            <Num m={windowView.incidents.value.shown} />
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
            Proof: record {windowView.proof.value.recordPath === null ? "unwritten" : windowView.proof.value.recordPath};
            digest {windowView.proof.value.digestPath === null ? "unwritten" : windowView.proof.value.digestPath}; lease{" "}
            <code>{windowView.proof.value.leaseId}</code>; {windowView.proof.value.windowsRecorded} window(s) recorded.
          </p>
        )}
      </details>

      {/* CONTROLS */}
      <h2>Controls</h2>
      <NeedsYouLine needs={NEEDS_NOTHING} />
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
        Each button writes down what you want; the runner reads it on its next cycle and records that it did. Nothing
        here reaches into the runner directly, so a button is a request until the runner says otherwise.
      </p>

      <h3>
        What you have asked for —{" "}
        {view.intents.held ? (
          <Num m={view.intents.value.shown} />
        ) : (
          <GapNote gap={view.intents.gap} where="Intents recorded" returnTo={HERE} />
        )}
      </h3>
      {view.intents.held && view.intents.value.rows.length === 0 && (
        <p className="note">You have not asked for anything yet; the first thing you do here shows up in this list.</p>
      )}
      {view.intents.held && view.intents.value.rows.length > 0 && (
        <ul>
          {view.intents.value.rows.map((intent) => (
            <li key={intent.intentId}>
              <When iso={intent.requestedAt} /> · <strong>{plainCode(intent.action)}</strong> · {intent.actor} ·{" "}
              <span className={intent.status === "HONORED" ? "state-green" : "state-unknown"}>
                {intent.status === "HONORED" ? "done" : "not picked up yet"}
              </span>
              {intent.honoredAt ? (
                <>
                  {" "}
                  · done <When iso={intent.honoredAt} />: <Said text={plainText(intent.detail)} />
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
