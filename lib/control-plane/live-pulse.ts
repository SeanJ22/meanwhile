import type { LaneGauge } from "./scheduler/lane-reading.ts";
import type { AdminCapabilityManifest } from "./admin-view/capabilities.ts";
import type { AdminV6CapabilityManifest } from "./admin-view/v6-capabilities.ts";

export interface LivePulse {
  /** Changes exactly when something the console renders has moved. */
  readonly revision: string;
  readonly at: string;
  /** Optional for compatibility with an older deployed /api/admin/live. */
  readonly capabilities?: AdminCapabilityManifest;
  /** Optional v6 section/action announcement; missing means recoverably unavailable. */
  readonly v6?: AdminV6CapabilityManifest;
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
  /** Each lane's running and waiting work, from the research state the pulse already reads. Null when unread. */
  readonly lanes: { readonly at: string; readonly final: boolean; readonly gauges: readonly LaneGauge[] } | null;
  /** A read we could not make, named. Never rendered as a zero. */
  readonly unread: readonly string[];
}

/** Deliberately coarse: it must not change on every clock tick, or every poll re-renders. */
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

export const PULSE_INTERVAL_MS = 45_000;

/** Three missed polls. */
export const PULSE_STALE_MS = PULSE_INTERVAL_MS * 3;

export const PULSE_ACTIVE_INTERVAL_MS = 8_000;
