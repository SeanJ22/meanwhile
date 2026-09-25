/**
 * **THE RUNNER, ON THE WORK SCREEN.** (Admin redesign, 2026-09-23.)
 *
 * The runner card the old Pilot health page carried, moved to Fleet · Work —
 * the runner is what does the work — and drawn in the design's language. Its
 * reading is the one `runnerStanding` and `runnerFace` already compute, so
 * this card and every other reading of the runner agree; its one control is
 * the one the owner already had, pause with an optional reason or resume,
 * posted to the same route with the same fields.
 */
import { easternize, formatEastern } from "@/lib/control-plane/eastern-time.ts";
import type { FleetSafetySnapshot } from "@/lib/control-plane/fleet-safety.ts";
import { ownerDigestAttention, type HealthLevel, type OwnerDigestRecord, type RunnerHeartbeat } from "@/lib/control-plane/owner-surface.ts";
import { plainText } from "@/lib/control-plane/plain-words.ts";
import { runnerFace, stopMomentIn } from "@/lib/control-plane/runner-plain.ts";
import type { RunnerStanding } from "@/lib/control-plane/runner-standing.ts";
import type { QueueLanes, SkippedWork } from "@/lib/control-plane/scheduler/lane-reading.ts";
import { INTENT_NOTE_MAX_CHARS } from "@/lib/control-plane/scheduler/research-policy.ts";

import { IntentButton } from "./intent-control.tsx";
import { Pill, mw as s } from "./ui.tsx";

const LEVEL_TONE: Readonly<Record<HealthLevel, "teal" | "amber" | "gold" | "slate">> = { GREEN: "teal", AMBER: "amber", RED: "gold", UNKNOWN: "slate" };

export function RunnerCard(props: {
  readonly standing: RunnerStanding;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly safety: FleetSafetySnapshot | null;
  /** The runner's newest canonical report, or why it was not read. */
  readonly digest: OwnerDigestRecord | null;
  readonly digestNote: string | null;
  readonly returnTo: string;
  /** The research state's lane accounting (MW-014); null when the state carries none. */
  readonly lanes: QueueLanes | null;
}) {
  const { standing, heartbeat, safety } = props;
  const stopIso = safety ? stopMomentIn(safety.stoppedBecause) : null;
  const face = runnerFace({
    standing,
    heartbeat,
    safety,
    resumesAtWords: heartbeat?.nextCycleDueAt ? formatEastern(heartbeat.nextCycleDueAt) : null,
    stoppedAtWords: stopIso === null ? null : formatEastern(stopIso),
    didThisCycle: null,
    lanes: props.lanes,
  });
  return (
    <section className={`${s.card} ${s.cardList} ${s.gap24}`} aria-labelledby="runner">
      <div className={s.stack10}>
        <div className={s.row10}>
          <h2 id="runner" className={s.titleStrong16}>
            The runner
          </h2>
          <Pill tone={LEVEL_TONE[standing.level]}>{standing.headline.toUpperCase()}</Pill>
          <span className={s.note}>{face.what}</span>
        </div>
        <p className={s.body}>{easternize(standing.detail)}</p>
        <p className={s.text14}>
          {heartbeat ? (
            <>
              Last run {formatEastern(heartbeat.lastCycleStartedAt)} → {heartbeat.lastCycleFinishedAt ? formatEastern(heartbeat.lastCycleFinishedAt) : "still running"} · next run{" "}
              {heartbeat.nextCycleDueAt ? formatEastern(heartbeat.nextCycleDueAt) : "not written down by the runner"}
            </>
          ) : (
            "No cycle has been recorded yet."
          )}
        </p>
        <p className={s.text14}>{easternize(face.did)}</p>
        {face.stopped && (
          <p className={s.text14}>
            <span className={s.strong}>Why work stopped: </span>
            {easternize(face.stopped)}
          </p>
        )}
        <Skipped skipped={face.skipped} />
        <LatestReport digest={props.digest} note={props.digestNote} />
        <div className={s.row10}>
          {standing.control === "PAUSE_RUNNER" ? (
            <IntentButton
              action="PAUSE_RUNNER"
              label="Record that I paused the runner"
              returnTo={props.returnTo}
              buttonClass={s.btnSecondary}
              okClass={s.cTeal}
              refusalClass={s.refusal}
              noteClass={s.inputText}
              note={{ placeholder: "Why it is paused (optional)", maxChars: INTENT_NOTE_MAX_CHARS, label: "Why the runner is paused" }}
            />
          ) : (
            <IntentButton action="RESUME_RUNNER" label="Resume the runner" returnTo={props.returnTo} buttonClass={s.btnPrimary} okClass={s.cTeal} refusalClass={s.refusal} />
          )}
        </div>
        <span className={s.note}>
          {standing.control === "PAUSE_RUNNER"
            ? "The runner reads a pause at its next cycle and records that it did."
            : "If the scheduled task on the runner machine is switched off, it also has to be started there."}{" "}
          Paid research has its own pause on the research page.
        </span>
      </div>
    </section>
  );
}

/**
 * What the cycle did not start, by lane and reason (MW-014). The reasons add
 * up to each lane's skipped count, or a MISMATCH line names the lane where
 * they do not; a state written before the lanes were accounted says so.
 */
function Skipped({ skipped }: { readonly skipped: SkippedWork | null }) {
  if (skipped === null) {
    return <p className={s.note}>The runner&rsquo;s last state does not record why due work was skipped (it predates that accounting), so no reasons are shown.</p>;
  }
  return (
    <div className={`${s.insetBox} ${s.stack8}`}>
      <div className={s.row10}>
        <span className={s.label}>Skipped work</span>
        {skipped.mismatches.length > 0 && <Pill tone="gold">MISMATCH</Pill>}
        <span className={s.note}>{skipped.final ? "counted at the cycle's end" : "cycle still running"}, {formatEastern(skipped.at)}</span>
      </div>
      <p className={s.text14}>{skipped.says}</p>
      {skipped.lanes.map((l) => (
        <div key={l.lane} className={s.stack2}>
          <span className={s.text14}>
            <span className={s.strong}>{l.name}: </span>
            {l.skipped.toLocaleString("en-US")} of {l.due.toLocaleString("en-US")} due not started
            {l.reasons === null ? " — reasons are counted when the cycle ends." : l.reasons.length === 0 ? "." : " — "}
            {l.reasons !== null &&
              l.reasons.map((r, i) => (
                <span key={r.code} title={r.code}>
                  {i > 0 ? "; " : ""}
                  {r.count.toLocaleString("en-US")} because {r.words}
                </span>
              ))}
          </span>
          {l.mismatch !== null && <span className={s.goldNote}>{l.mismatch}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The runner's newest canonical report, classified by the one rule every
 * reading of it uses (`ownerDigestAttention`): a red routine civic-data
 * supervisor failure shows here, on the page Sean opens to see the runner,
 * with the report itself one disclosure down.
 */
function LatestReport({ digest, note }: { readonly digest: OwnerDigestRecord | null; readonly note: string | null }) {
  if (digest === null) {
    return <p className={s.goldNote}>{note !== null ? note : "The runner's latest report was not read, so whether its last cycle succeeded is not shown."}</p>;
  }
  const attention = ownerDigestAttention(digest);
  return (
    <div className={`${s.insetBox} ${s.stack8}`}>
      <div className={s.row10}>
        <span className={s.label}>Latest report</span>
        <Pill tone={LEVEL_TONE[attention.level]}>{attention.headline.toUpperCase()}</Pill>
        <span className={s.note}>recorded {formatEastern(digest.writtenAt)}</span>
      </div>
      <p className={s.text14}>{easternize(attention.happened)}</p>
      {attention.needsYou && attention.action && (
        <p className={s.text14}>
          <span className={s.strong}>Needs you: </span>
          {attention.action}.
        </p>
      )}
      <details>
        <summary className={s.btnLink}>The report the runner wrote</summary>
        <pre className={s.monoSmall} style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {digest.lines.map((line) => easternize(plainText(line))).join(String.fromCharCode(10))}
        </pre>
      </details>
    </div>
  );
}
