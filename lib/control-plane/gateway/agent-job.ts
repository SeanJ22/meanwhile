export const AGENT_JOB_FORMAT_VERSION = 1;

export const AGENT_JOB_LOG_KEY = "agent-job";

export const AGENT_JOB_STATUSES = [
  "REQUESTED",
  "RUNNING",
  "DONE",
  /** The provider or the policy said no; not a failure. */
  "REFUSED",
  "FAILED",
] as const;
export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];

export const AGENT_JOB_LIVE_STATUSES: readonly AgentJobStatus[] = ["REQUESTED", "RUNNING"];

export interface AgentJobRecord {
  readonly formatVersion: number;
  readonly jobId: string;
  readonly provider: string;
  readonly mode: string;
  readonly status: AgentJobStatus;
  readonly subject: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly resultDigest: string | null;
  readonly receiptId: string | null;
  readonly extra: Readonly<Record<string, unknown>>;
}

export function isAgentJobStatus(value: unknown): value is AgentJobStatus {
  return typeof value === "string" && (AGENT_JOB_STATUSES as readonly string[]).includes(value);
}

/** Latest by append order, not by timestamp. */
export function latestByJob<T>(rows: readonly T[]): readonly T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const id = (row as { jobId?: unknown })?.jobId;
    // A row without a usable job id gets a unique key so such rows never collapse into one.
    latest.set(typeof id === "string" && id !== "" ? id : `unkeyed:${latest.size}`, row);
  }
  return [...latest.values()];
}

/** An unrecognised status counts as `unreadable`, never as finished. */
export function liveJobCount(rows: readonly unknown[]): {
  readonly running: number;
  readonly unreadable: number;
} {
  let running = 0;
  let unreadable = 0;
  for (const row of latestByJob(rows)) {
    const status = (row as { status?: unknown })?.status;
    if (!isAgentJobStatus(status)) unreadable += 1;
    else if (AGENT_JOB_LIVE_STATUSES.includes(status)) running += 1;
  }
  return { running, unreadable };
}
