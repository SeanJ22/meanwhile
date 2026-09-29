/**
 * **THE CHEAP QUESTION: HAS ANYTHING CHANGED SINCE THE PAGE RENDERED?**
 * (ADM-34 and §9A.17 — *"do I have to manually refresh the site to get more
 * information? Is it going to auto-update if I just simply leave it open?"*)
 *
 * The console must not make the owner wonder whether he is reading something
 * stale. It also must not answer that by re-reading the whole control plane
 * every thirty seconds — §16 of the brief is explicit that repeated broad
 * control-plane reads are the scaling concern this pass may not make worse.
 *
 * So the loop is two-step:
 *
 * ```
 *   every ~45s   ask /api/admin/live for a PULSE — a handful of aggregate
 *                reads, no list() of anything, one small JSON body
 *   only if the  pulse's revision differs from the one the page rendered with,
 *                ask the router for a fresh render
 * ```
 *
 * A quiet console therefore costs one small query a minute and re-renders
 * nothing; a console watching a live cycle re-renders exactly when the cycle
 * moves. The freshness indicator updates from the pulse either way, so
 * "Updated 20 seconds ago" is a fact about a real successful read, never about
 * when the tab happened to be opened.
 *
 * PURE. The revision is derived here so the page and the endpoint cannot
 * disagree about what "changed" means.
 */

import type { LaneGauge } from "./scheduler/lane-reading.ts";
import type { AdminCapabilityManifest } from "./admin-view/capabilities.ts";
import type { AdminV6CapabilityManifest } from "./admin-view/v6-capabilities.ts";

/** The small body the live endpoint returns. */
export interface LivePulse {
  /** Changes exactly when something the console renders has moved. */
  readonly revision: string;
  /** When the pulse was taken, ISO. */
  readonly at: string;
  /** Optional for compatibility with an older deployed /api/admin/live. */
  readonly capabilities?: AdminCapabilityManifest;
  /** Optional v6 section/action announcement; missing means recoverably unavailable. */
  readonly v6?: AdminV6CapabilityManifest;
  /** Runner heartbeat, for the one-line strip. */
  readonly runner: {
    readonly beatAt: string | null;
    readonly lastCycleFinishedAt: string | null;
    readonly nextCycleDueAt: string | null;
    readonly state: string | null;
  };
  /** Counts the owner watches. Each is a plain integer or null when unread. */
  readonly counts: {
    readonly decisionsWaiting: number | null;
    readonly freshnessDebtRows: number | null;
    readonly incidents: number | null;
    readonly obligations: number | null;
    readonly agentJobsRunning: number | null;
  };
  /**
   * MW-029 / MW-071: each lane's running and waiting work and its own blocking
   * reason, taken from the research state the pulse already reads — never a
   * second read. Null when that state was not read or records no lanes.
   */
  readonly lanes: { readonly at: string; readonly final: boolean; readonly gauges: readonly LaneGauge[] } | null;
  /** A read we could not make, named. Never rendered as a zero. */
  readonly unread: readonly string[];
}

/**
 * The revision string: every field that, when it moves, means the rendered page
 * is out of date. Deliberately coarse — a revision that changes on every clock
 * tick would re-render the page every poll and defeat the whole design.
 */
export function pulseRevision(input: {
  readonly beatAt: string | null;
  readonly heartbeatRevision?: number | null;
  readonly snapshotRevision: number | null;
  readonly decisionCount: number | null;
  readonly researchRevision: number | null;
  readonly receiptCount: number | null;
  readonly researchIntentCount: number | null;
  readonly sourceProgressId: string | null;
  readonly capabilityRevision?: string | null;
}): string {
  return [
    input.beatAt ?? "-",
    input.heartbeatRevision ?? "-",
    input.snapshotRevision ?? "-",
    input.decisionCount ?? "-",
    input.researchRevision ?? "-",
    input.receiptCount ?? "-",
    input.researchIntentCount ?? "-",
    input.sourceProgressId ?? "-",
    input.capabilityRevision ?? "-",
  ].join("|");
}

/** How often the console asks. Slow enough to be free, fast enough to feel live. */
export const PULSE_INTERVAL_MS = 45_000;

/**
 * How long after the last successful pulse the indicator calls itself stale.
 * Three missed polls: one miss is a hiccup, three is a broken loop and the
 * owner should be told rather than shown a confident old number.
 */
export const PULSE_STALE_MS = PULSE_INTERVAL_MS * 3;

/** While an owner-triggered job is visibly running, ask more often (§9A.17). */
export const PULSE_ACTIVE_INTERVAL_MS = 8_000;
