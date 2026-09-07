/**
 * **WHAT A DELEGATED AGENT JOB LOOKS LIKE AT REST.**
 * (Admin Pass C, ADM-C6 storage. The bridge that writes these is ADM-C9.)
 *
 * ## Why this shape exists before the bridge does
 *
 * A control-plane log is a SCHEMA MOVE: an entry in `APPEND_ONLY_LOGS`, a field
 * on `ControlPlaneRepositories`, an implementation in all three providers, and a
 * `BOOTSTRAP_VERSION` bump. Landing the storage with the feature would mean two
 * schema moves in one pass — one for the gateway's receipts and a second for the
 * agent bridge — and the second would arrive on a deployed control plane whose
 * bootstrap had already run. So the log is declared once, at version 9, with the
 * narrowest record the bridge can be built on.
 *
 * ## The record is deliberately minimal, and the bag is deliberately named
 *
 * Eleven fields, and every one of them answers a question the owner asks out
 * loud: what is running, who is running it, what is it working on, when did it
 * start, is it finished, what came out, and where is the proof. Anything the
 * bridge needs that is NOT one of those goes in `extra`, which is an opaque bag
 * this module never reads. That is not laziness — it is the boundary. A field
 * promoted out of `extra` into the record is a deliberate act with a version
 * behind it; a field invented inside `extra` costs nobody a migration and can
 * never be mistaken for something the gateway understands.
 *
 * ## Append-only means a job is a SEQUENCE of records, not a row that moves
 *
 * The store has no update. A job that is requested, then starts, then finishes
 * is three appends under three record ids and one `jobId`, exactly the way the
 * research intent/HONORED pair works. Nothing ever edits a record, so a job that
 * died mid-flight still visibly reached the state it reached. `latestByJob`
 * folds the sequence back into one row per job for anyone who needs the current
 * picture.
 *
 * PURE. No store, no clock, no environment.
 */

export const AGENT_JOB_FORMAT_VERSION = 1;

/**
 * The one log key every agent-job record is appended under.
 *
 * One key rather than one per job: the console's question is "what is running
 * right now", which over a per-job partition would be a `keys()` call followed
 * by N reads. The bridge partitions by `jobId` INSIDE the record id instead.
 */
export const AGENT_JOB_LOG_KEY = "agent-job";

/**
 * The states a job can be in. Closed, because an unrecognised status is a job
 * whose state the console would have to guess at, and it would guess "fine".
 */
export const AGENT_JOB_STATUSES = [
  /** Recorded, not yet picked up. */
  "REQUESTED",
  /** Picked up and working. */
  "RUNNING",
  /** Finished, and produced what it said it would. */
  "DONE",
  /** The provider or the policy said no. Not a failure — an answer. */
  "REFUSED",
  /** It broke. Different from REFUSED, and the difference is the whole point. */
  "FAILED",
] as const;
export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];

/** The statuses that mean the job is still consuming something. */
export const AGENT_JOB_LIVE_STATUSES: readonly AgentJobStatus[] = ["REQUESTED", "RUNNING"];

export interface AgentJobRecord {
  readonly formatVersion: number;
  /** Stable across every record this job writes. The join key of the sequence. */
  readonly jobId: string;
  /** Which delegated agent this is — a provider name, never a credential. */
  readonly provider: string;
  /** How it was asked to work: the bridge's own mode vocabulary. */
  readonly mode: string;
  readonly status: AgentJobStatus;
  /** What it is working on: a work item id, a jurisdiction, a tracker row. */
  readonly subject: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /**
   * A digest of what came out, so the record is auditable without storing the
   * output. Null while the job has produced nothing.
   */
  readonly resultDigest: string | null;
  /** The gateway receipt that authorised this job. Null only for a job nothing asked for. */
  readonly receiptId: string | null;
  /**
   * Everything the bridge needs that this record does not name. Opaque here on
   * purpose: nothing in the gateway reads it, so nothing in the gateway can
   * come to depend on a field that was never designed.
   */
  readonly extra: Readonly<Record<string, unknown>>;
}

export function isAgentJobStatus(value: unknown): value is AgentJobStatus {
  return typeof value === "string" && (AGENT_JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * The current picture: one record per job, the latest one it wrote.
 *
 * "Latest" is by append order, which for this log is the order the bridge
 * actually wrote them — not by a timestamp, because two records written in one
 * millisecond are two records and a clock would call them one.
 */
export function latestByJob<T>(rows: readonly T[]): readonly T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const id = (row as { jobId?: unknown })?.jobId;
    // A row with no usable job id is still a row. Giving it a unique synthetic
    // key keeps it in the fold rather than letting several of them collapse
    // into one and quietly shrink the population.
    latest.set(typeof id === "string" && id !== "" ? id : `unkeyed:${latest.size}`, row);
  }
  return [...latest.values()];
}

/**
 * How many jobs are still live, and how many rows this module could not read.
 *
 * Counted from the folded view, so a job that wrote REQUESTED and then DONE
 * counts once and counts as finished. A log with no rows genuinely means no job
 * is running — a read that succeeded, and the caller must not report it as an
 * unread measurement.
 *
 * `unreadable` is the field that stops this from lying. The log is written by
 * the delegated-agent bridge, and a bridge record whose status this module does
 * not recognise is NOT a finished job — it is a job whose state we cannot read.
 * Counting it as zero would be exactly the "absence asserted" failure CLAUDE.md
 * forbids: the strip would report nothing running while something ran. So the
 * unreadable rows are counted separately and the caller reports the count as
 * unknown rather than as a number.
 */
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
