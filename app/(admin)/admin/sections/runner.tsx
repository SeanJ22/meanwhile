/**
 * **THE RUNNER, IN FOUR LINES.** (ADM-24, ADM-26, ADM-27; §9A.3.)
 *
 * Everything the old card led with — host, SHA, credential state, request and
 * payload ceilings, the sixty-word supervisor paragraph, the two-thousand-item
 * deferral list — is still here. It is one disclosure down, which is where the
 * owner said it belongs: *"Those belong behind Technical details."*
 *
 * The face answers his four questions and stops.
 */
import { codeIdentityLine } from "@/lib/control-plane/code-identity.ts";
import { bytesText, durationText, spendWindowRows } from "@/lib/control-plane/cost-panel.ts";
import type { FleetSafetySnapshot } from "@/lib/control-plane/fleet-safety.ts";
import type { RunnerHeartbeat } from "@/lib/control-plane/owner-surface.ts";
import { count, plainCode, usdCents } from "@/lib/control-plane/plain-words.ts";
import { runnerFace, stopMomentIn } from "@/lib/control-plane/runner-plain.ts";
import { RESEARCH_BOUNDS } from "@/lib/control-plane/scheduler/research-policy.ts";
import type { RunnerStanding } from "@/lib/control-plane/runner-standing.ts";

import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import { Band, Said, When } from "../../console-ui.tsx";
import { Bar, NeedsYouLine } from "../../status-ui.tsx";

export interface RunnerSectionProps {
  readonly standing: RunnerStanding;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly safety: FleetSafetySnapshot | null;
  /** One plain sentence about what the newest cycle did, from the digest. */
  readonly didThisCycle: string | null;
  /** The read that could not be made, named, when one could not. */
  readonly heartbeatNote: string | null;
  readonly safetyNote: string | null;
  /** Where a control returns to. */
  readonly returnTo: string;
  /** The research-intent route the pause/resume control posts to. */
  readonly intentRoute: string;
  readonly noteMaxChars: number;
}

export function RunnerSection(props: RunnerSectionProps) {
  const { standing, heartbeat, safety } = props;
  const face = runnerFace({
    standing,
    heartbeat,
    safety,
    resumesAtWords: heartbeat?.nextCycleDueAt ? formatEastern(heartbeat.nextCycleDueAt) : null,
    stoppedAtWords: stoppedAt(safety),
    didThisCycle: props.didThisCycle,
  });
  /*
   * ONE implementation of the three spend windows (RULING 103): the cost panel
   * owns it and the cost section renders the same rows, so the runner card and
   * the Cost section can never disagree about what a cycle has spent.
   */
  const windows = safety
    ? spendWindowRows({
        cycleUsd: safety.cycle.modelUsd,
        operationalNightUsd: safety.operationalNight.modelUsd,
        rolling24HourUsd: safety.rolling24Hours.modelUsd,
        ceilings: {
          cycleModelUsd: safety.bounds.cycleModelUsd,
          operationalNightModelUsd: safety.bounds.operationalNightModelUsd,
          rolling24HourModelUsd: safety.bounds.rolling24HourModelUsd,
        },
      })
    : [];

  return (
    <>
      <h2 id="runner">Runner</h2>
      <div className={`runner-card card l-${standing.level}`}>
        {/* 1 — what this is, and what state it is in */}
        <p className="runner-head">
          <Band level={standing.level}>{face.state}</Band>
          <span className="runner-what">{face.what}</span>
        </p>

        {/* 2 — when it last ran and when it runs next */}
        <p className="runner-when">
          {heartbeat ? (
            <>
              Last run <When iso={heartbeat.lastCycleStartedAt} /> → <When iso={heartbeat.lastCycleFinishedAt} /> · next run{" "}
              {heartbeat.nextCycleDueAt ? (
                <When iso={heartbeat.nextCycleDueAt} />
              ) : (
                <span className="gap">the runner did not write down when the next cycle is due</span>
              )}
              {standing.state === "ACTIVE" || standing.state === "ALIVE" ? " · on schedule" : ""}
            </>
          ) : (
            <span className="gap">No cycle has been recorded yet.</span>
          )}
        </p>

        {/* 3 — what it did */}
        <p className="runner-did">{face.did}</p>

        {/*
          ADM-66 — THE ANSWER TO "WHY IS NOTHING HAPPENING", WHERE HE IS LOOKING.

          The owner, of the Hunters: *"these are good explanations, a really
          solid breakdown — but why are they not doing anything, especially if
          we have 2,300 of them?"*

          The Hunters panel on Research detail already held the answer. He was
          on the runner block, which said only that a limit was reached. So the
          two facts that make sense of each other — nothing started, and a great
          deal is waiting — are put in one sentence here, with the cap that
          explains the gap between them.

          It fires only when BOTH are true. An idle cycle with nothing owed is a
          finished cycle, not a stalled one, and saying "idle" about it would be
          the kind of false alarm that teaches an owner to ignore the line.
        */}
        {safety !== null && safety.cycle.dispatches === 0 && (face.deferred?.total ?? 0) > 0 && (
          <p className="runner-idle">
            <strong>Nothing ran, and {count(face.deferred?.total ?? 0)} item(s) are waiting.</strong> At most{" "}
            {RESEARCH_BOUNDS.maxScoutDispatchesPerCycle} paid-model hunt(s) start in a cycle and{" "}
            {RESEARCH_BOUNDS.maxConcurrentScouts} run at once, so a backlog this size cannot clear in one
            cycle however many are owed. That is a cap on how fast work runs — never a statement that the work
            is not owed.
          </p>
        )}

        {/* 4 — why work stopped, and when it resumes */}
        {face.stopped && (
          <p className="runner-stopped">
            <strong>Why work stopped:</strong> {face.stopped}
          </p>
        )}

        {/*
          ADM-51 and ADM-66 — THE LIMITS, WITH THEIR CURRENT VALUES.

          The owner: *"We need to figure out where budget is coming from or just
          simply raise the budgets. I'm not sure. Either way I need some
          clarification."* And, of the Hunters: *"why are they not doing
          anything, especially if we have 2,300 of them?"*

          The answer to both was on a different page. The Hunters panel on
          Research detail already showed "Started this cycle 0 of 3 · Held back
          by the per-cycle job limit 2,333 of 2,333" — the runner block, where
          he was actually looking, showed only the word "budget". So the caps
          that decide how much can run are stated here, beside the spend they
          are constantly mistaken for.

          The two research caps are the ones that bind a hunt. They are NOT
          dollars, and the four dollar ceilings are in the table below this —
          keeping them apart is the whole of ADM-51.
        */}
        <table className="spend-table">
          <caption>The limits it runs under</caption>
          <thead>
            <tr>
              <th scope="col">Limit</th>
              <th scope="col" className="n">Value</th>
              <th scope="col">What it caps</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Hunts started per cycle</th>
              <td className="n">{RESEARCH_BOUNDS.maxScoutDispatchesPerCycle}</td>
              <td className="note">
                How many paid-model hunts a single cycle may START. A job count, never a dollar — this is the
                one most often mistaken for a budget.
              </td>
            </tr>
            <tr>
              <th scope="row">Hunts running at once</th>
              <td className="n">{RESEARCH_BOUNDS.maxConcurrentScouts}</td>
              <td className="note">How many may be out on a job at the same moment.</td>
            </tr>
            {safety && (
              <>
                <tr>
                  <th scope="row">Jobs started per cycle, whole fleet</th>
                  <td className="n">{safety.bounds.maxDispatchesPerCycle}</td>
                  <td className="note">Every lane together, not just the paid-model hunts.</td>
                </tr>
                <tr>
                  <th scope="row">Cycle length</th>
                  <td className="n">{durationText(safety.bounds.maxWallMsPerCycle)}</td>
                  <td className="note">
                    A cycle stops starting new work before this, so it can finish what it began.
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        <p className="note">
          Changing any of these is a code change on the machine that runs the fleet, and it does not take
          effect until that runner is restarted. Nothing on this page can raise them.
        </p>

        <NeedsYouLine needs={{ needed: face.needs.needed, action: face.needs.action ?? undefined }} />

        {/* The spend table — three rows, to the cent (ADM-26) */}
        {safety && (
          <table className="spend-table">
            <caption>What it is spending on paid models</caption>
            <thead>
              <tr>
                <th scope="col">Window</th>
                <th scope="col">Spend</th>
                <th scope="col" className="spend-bar-col">
                  <span className="visually-hidden">Share of the limit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {windows.map((row) => (
                <tr key={row.window}>
                  <th scope="row">
                    {row.window}
                    {row.defines && <span className="spend-means">{row.defines}</span>}
                  </th>
                  <td className="spend-figure">{row.shown}</td>
                  <td>
                    {row.spentUsd === null ? (
                      <span className="gap-inline">not measured</span>
                    ) : (
                      <Bar
                        value={row.spentUsd}
                        of={row.ceilingUsd}
                        tone={row.spentUsd / row.ceilingUsd > 0.8 ? "warn" : "ok"}
                        title={`${usdCents(row.spentUsd)} of ${usdCents(row.ceilingUsd)}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Circuit breakers, always a sentence (ADM-27) */}
        <p className="runner-circuits">{face.circuits}</p>

        {/* Deferred work: a count and a sentence, groups on demand (ADM-27) */}
        {face.deferred && (
          <details className="runner-deferred">
            <summary>{face.deferred.says}</summary>
            <ul>
              {face.deferred.groups.map((g) => (
                <li key={g.code}>
                  <strong>
                    {count(g.items)} because: {g.words}
                  </strong>
                  {g.means && <span className="note"> {g.means}</span>}
                  <span className="note"> For example: {g.examples.join(", ")}.</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Everything the owner asked to stop leading with */}
        <details className="status-detail">
          <summary>Technical details</summary>
          {props.heartbeatNote && <p className="note">{props.heartbeatNote}</p>}
          {props.safetyNote && <p className="note">{props.safetyNote}</p>}
          <p className="note">
            <Said text={standing.detail} />
          </p>
          {heartbeat && (
            <p className="note">
              Runner host {heartbeat.host}; executed commit{" "}
              <code title={heartbeat.testedSha ?? undefined}>{heartbeat.testedSha ? heartbeat.testedSha.slice(0, 8) : "not recorded"}</code>; heartbeat{" "}
              <When iso={heartbeat.beatAt} />.
            </p>
          )}
          {heartbeat?.codeIdentity && (
            <p className="note">
              Code identity:{" "}
              <span
                className={
                  heartbeat.codeIdentity.verdict === "CONSISTENT"
                    ? "state-green"
                    : heartbeat.codeIdentity.verdict === "CANNOT_TELL"
                      ? "state-amber"
                      : "state-red"
                }
                title={heartbeat.codeIdentity.verdict}
              >
                {plainCode(heartbeat.codeIdentity.verdict)}
              </span>
              {" — "}
              {codeIdentityLine(heartbeat.codeIdentity)}. <Said text={heartbeat.codeIdentity.detail} />
            </p>
          )}
          {safety && (
            <>
              <p className="note">
                Cycle ceilings — requests {safety.cycle.requests} of {safety.bounds.maxProviderRequestsPerCycle}; downloaded{" "}
                <span title={`${safety.cycle.payloadBytes} of ${safety.bounds.maxPayloadBytesPerCycle} bytes`}>
                  {bytesText(safety.cycle.payloadBytes)} of {bytesText(safety.bounds.maxPayloadBytesPerCycle)}
                </span>
                ; jobs started {safety.cycle.dispatches} of {safety.bounds.maxDispatchesPerCycle}; running time{" "}
                <span title={`${safety.cycle.elapsedMs} of ${safety.bounds.maxWallMsPerCycle} ms`}>
                  {durationText(safety.cycle.elapsedMs)} of {durationText(safety.bounds.maxWallMsPerCycle)}
                </span>
                .
              </p>
              {face.stopReasons.length > 0 && (
                <ul className="note">
                  {face.stopReasons.map((r) => (
                    <li key={r.words}>
                      <strong>{r.words}</strong>
                      {r.means ? ` — ${r.means}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="note">
                The instrument&rsquo;s own words: <Said text={safety.stoppedBecause.join("; ") || "no stop reason recorded for this cycle"} />
              </p>
              <p className="note">
                Last successful research activity:{" "}
                {safety.lastSuccessfulActivity === null ? "not recorded yet" : <Said text={safety.lastSuccessfulActivity} />}.
              </p>
            </>
          )}
          <p className="note">Promotion to readers is OFF. Nothing this runner finds reaches a reader without a separate, governed step.</p>
        </details>

        {/* The control the owner already has and likes (POS-11) */}
        {standing.control === "PAUSE_RUNNER" ? (
          <form method="post" action={props.intentRoute} className="runner-control">
            <input type="hidden" name="action" value="PAUSE_RUNNER" />
            <input type="hidden" name="returnTo" value={props.returnTo} />
            <input
              type="text"
              name="note"
              maxLength={props.noteMaxChars}
              placeholder="Why it is paused (optional)"
              aria-label="Why the runner is paused"
            />
            <button type="submit" className="primary">
              Record that I paused the runner
            </button>
          </form>
        ) : (
          <form method="post" action={props.intentRoute} className="runner-control">
            <input type="hidden" name="action" value="RESUME_RUNNER" />
            <input type="hidden" name="returnTo" value={props.returnTo} />
            <button type="submit" className="primary">
              Resume the runner
            </button>
            <span className="note">
              If the scheduled task on the runner machine is switched off, it also has to be started there.
            </span>
          </form>
        )}
      </div>
    </>
  );
}

/** The Eastern rendering of the moment the instrument named inside its own prose. */
function stoppedAt(safety: FleetSafetySnapshot | null): string | null {
  const iso = safety ? stopMomentIn(safety.stoppedBecause) : null;
  return iso === null ? null : formatEastern(iso);
}
