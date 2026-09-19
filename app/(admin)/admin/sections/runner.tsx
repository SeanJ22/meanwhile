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
import { FLEET_SPEND_CEILING_MAX_USD, type FleetSafetySnapshot } from "@/lib/control-plane/fleet-safety.ts";
import type { RunnerHeartbeat } from "@/lib/control-plane/owner-surface.ts";
import { count, plainCode, usdCents } from "@/lib/control-plane/plain-words.ts";
import { runnerFace, stopMomentIn } from "@/lib/control-plane/runner-plain.ts";
import type { RunnerStanding } from "@/lib/control-plane/runner-standing.ts";

import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import { Band, Said, When } from "../../console-ui.tsx";
import { Bar, NeedsYouLine } from "../../status-ui.tsx";
import { FleetSpendCeilingControl } from "../fleet-spend-ceiling.tsx";

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
  /** The gateway route the spend-ceiling control posts to (`/api/admin/action`). */
  readonly actionRoute: string;
  /**
   * The spend ceiling in force per the owner's SETTING (an override, or the
   * fallback), with its source and provenance. Read live from the policy row, so
   * it shows a change at once; the runner card compares it to what the snapshot
   * says the runner is ENFORCING to show whether the controller has picked it up.
   */
  readonly spendCeiling: {
    readonly settingUsd: number;
    readonly source: "OVERRIDE" | "FALLBACK";
    readonly fallbackUsd: number;
    readonly setAt: string | null;
    readonly setBy: string | null;
    readonly previousUsd: number | null;
    /** False when the policy row could not be read; the card then does not assert a source. */
    readonly readable: boolean;
  };
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
        ceilings: { rolling24HourModelUsd: safety.bounds.rolling24HourModelUsd },
      })
    : [];

  /*
   * The ceiling SET (the owner's override or the fallback) vs the ceiling the
   * runner is ENFORCING (the value on the last published snapshot). When they
   * agree, the controller has read the setting — which is the proof a read-back
   * of the row alone cannot give. `enforcedUsd` is null when no snapshot exists.
   */
  const sc = props.spendCeiling;
  const enforcedUsd = safety ? safety.bounds.rolling24HourModelUsd : null;
  const ceilingPending = sc.readable && enforcedUsd !== null && Math.abs(enforcedUsd - sc.settingUsd) > 0.005;

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

        {/* 4 — why work stopped, and when it resumes */}
        {face.stopped && (
          <p className="runner-stopped">
            <strong>Why work stopped:</strong> {face.stopped}
          </p>
        )}

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

        {/*
          The spend ceiling, and the dial for it — right beside the rows it caps.
          It shows the value IN FORCE and its source (a live override apart from
          the fallback), who set it and when, and — when the runner has not yet
          picked up a fresh change — what it is still enforcing until its next
          cycle. Posts to the one gateway door, which records it durably; the
          runner reads it at the start of its next cycle, with no deploy or restart.
        */}
        <div className="spend-ceiling">
          <p className="spend-ceiling-now">
            <strong>Spend ceiling: {usdCents(sc.settingUsd)}</strong>{" "}
            {!sc.readable ? (
              <span className="gap-inline">
                its setting could not be read just now — the runner enforces whatever was last written
              </span>
            ) : sc.source === "OVERRIDE" ? (
              <span className="note">
                — you set this{sc.setAt ? <> <When iso={sc.setAt} /></> : null}
                {sc.previousUsd !== null ? ` (was ${usdCents(sc.previousUsd)})` : ""}. The built-in fallback is {usdCents(sc.fallbackUsd)}.
              </span>
            ) : (
              <span className="note">— the built-in fallback; no override is set.</span>
            )}
          </p>
          {ceilingPending && enforcedUsd !== null && (
            <p className="note spend-ceiling-pending">
              The runner is still enforcing {usdCents(enforcedUsd)} from before this change; it applies{" "}
              {usdCents(sc.settingUsd)} at the start of its next cycle.
            </p>
          )}
          <FleetSpendCeilingControl
            actionRoute={props.actionRoute}
            returnTo={props.returnTo}
            currentUsd={sc.settingUsd}
            maxUsd={FLEET_SPEND_CEILING_MAX_USD}
          />
        </div>

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
                This cycle — requests {safety.cycle.requests}; downloaded{" "}
                <span title={`${safety.cycle.payloadBytes} bytes`}>{bytesText(safety.cycle.payloadBytes)}</span>
                ; jobs started {safety.cycle.dispatches}; running time{" "}
                <span title={`${safety.cycle.elapsedMs} of ${safety.bounds.maxWallMsPerCycle} ms`}>
                  {durationText(safety.cycle.elapsedMs)} of {durationText(safety.bounds.maxWallMsPerCycle)}
                </span>{" "}
                (the cycle wall — the one per-cycle limit; per download,{" "}
                <span title={`${safety.bounds.maxDownloadBytes} bytes`}>{bytesText(safety.bounds.maxDownloadBytes)}</span>).
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
