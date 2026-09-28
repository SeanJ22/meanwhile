/**
 * **THE CHEAP READ BEHIND THE PULSE.** (Admin Pass C, ADM-34 / §9A.17, §16.)
 *
 * `lib/control-plane/live-pulse.ts` defines the SHAPE and derives the revision.
 * This is the only thing that fills it in, and it lives here because two routes
 * need the same answer: `/api/admin/live` returns the whole pulse, and
 * `/api/admin/action` needs the current revision so the gateway can tell a
 * control drawn against a moving world from one drawn against this one. Two
 * implementations of "what is the current revision" would be two answers to the
 * question that decides whether a click is stale (RULING 103).
 *
 * ## What "cheap" means here, precisely
 *
 * §16 names repeated broad control-plane reads as the scaling concern this pass
 * may not make worse, so the rule is not "few reads" but "no read whose cost
 * grows with the fleet":
 *
 * ```
 *   ALLOWED   read one aggregate by id          O(1)
 *   ALLOWED   read one append-only log by key   O(rows under that key)
 *   REFUSED   list() an aggregate kind          O(every work item in the world)
 *   REFUSED   readAll() a log                   O(every key in the log)
 * ```
 *
 * So the counts the owner watches are taken from the PUBLISHED SNAPSHOT — one
 * aggregate the runner already computed them into — rather than by counting
 * obligations, debts and incidents out of the store on every poll. That is not
 * only cheaper, it is more correct: the snapshot's numbers were computed at one
 * instant against one another, and four independently-timed counts assembled
 * into one strip would imply a coherence they do not have.
 *
 * ## Six reads, each alone, and a failure is named rather than zeroed
 *
 * Every read is its own try/catch. One store hiccup must not blank the strip,
 * and — the rule that matters — a read that did not happen must never render as
 * `0`. CLAUDE.md: absence is argued, never asserted. A failed read puts its own
 * plain name in `unread[]`; so does a successful read of something nobody has
 * published yet, because "we have not been told" is also not "there are none".
 *
 * An EMPTY LOG is different from both and is reported as the number it is:
 * reading the agent-job log and finding nothing means no job is running, which
 * is a fact, not a gap.
 *
 * SERVER-SIDE. The repositories arrive as an argument; nothing here opens a
 * connection or reads the environment.
 */

import { DECISION_LOG_KEY, RUNNER_ID, SNAPSHOT_ID } from "../admin-data.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { splitDecided } from "../decision-receipt.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, livenessOf, type OwnerSnapshot } from "../owner-surface.ts";
import { pulseRevision, type LivePulse } from "../live-pulse.ts";
import { ADMIN_CAPABILITIES } from "../admin-view/capabilities.ts";
import { ADMIN_V6_CAPABILITIES, ADMIN_V6_CAPABILITY_REVISION } from "../admin-view/v6-capabilities.ts";
import { ADMIN_RECEIPT_LOG_KEY } from "./contract.ts";
import { AGENT_JOB_LOG_KEY, liveJobCount } from "./agent-job.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import { RESEARCH_INTENT_LOG_KEY } from "../scheduler/research-policy.ts";
import { pulseLanesOf } from "../scheduler/lane-reading.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";

/**
 * One read's answer.
 *
 * Three states, never two — the same discipline `admin-data.ts` exists for.
 * `failed` separates "we could not ask" from "we asked and there is nothing
 * there", because only the first one means the reading itself is unavailable:
 * a runner that has never beaten is a fact about the runner, and a store we
 * could not reach is a fact about us.
 */
type Reading<T> = { readonly value: T | null; readonly unread: string | null; readonly failed: boolean };

async function reading<T>(name: string, read: () => Promise<T | null>): Promise<Reading<T>> {
  try {
    const value = await read();
    return value === null
      ? { value: null, unread: `${name} (nothing published yet)`, failed: false }
      : { value, unread: null, failed: false };
  } catch {
    // The error is deliberately not carried into the pulse: a driver message
    // can contain the connection string, and this body reaches a browser.
    return { value: null, unread: `${name} (could not be read just now)`, failed: true };
  }
}

/**
 * The four fields of the published snapshot the pulse reads, and the one field
 * of the research state. Postgres narrows each row before it leaves the store
 * (`readNarrowed`): measured 2026-09-25, the snapshot is 449 KB and these four
 * fields about 92 KB of it, and the research state is 1.16 MB of which the lane
 * gauges read the 782-byte `queue`. The revisions come with the narrowed rows,
 * so the pulse is the same pulse, byte for byte: every field it reads is kept.
 */
export const PULSE_SNAPSHOT_FIELDS = {
  decisionCards: true,
  freshnessDebtRows: true,
  incidents: true,
  obligationsByState: true,
} as const satisfies RecordProjection & Partial<Record<keyof OwnerSnapshot, true>>;
export const PULSE_RESEARCH_FIELDS = { queue: true } as const satisfies RecordProjection;

type PulseSnapshot = Pick<OwnerSnapshot, keyof typeof PULSE_SNAPSHOT_FIELDS>;

/** The counts a published snapshot already carries, with the ones it cannot answer left null. */
function countsFrom(snapshot: PulseSnapshot | null): {
  readonly freshnessDebtRows: number | null;
  readonly incidents: number | null;
  readonly obligations: number | null;
  readonly unread: readonly string[];
} {
  if (snapshot === null) return { freshnessDebtRows: null, incidents: null, obligations: null, unread: [] };
  const unread: string[] = [];
  const debt = snapshot.freshnessDebtRows.held ? snapshot.freshnessDebtRows.value.value : null;
  if (debt === null) unread.push("how much freshness debt is outstanding (the last publish could not measure it)");
  return {
    freshnessDebtRows: debt,
    incidents: snapshot.incidents.length,
    obligations: snapshot.obligationsByState.reduce((sum, row) => sum + row.count.value, 0),
    unread,
  };
}

/**
 * Take the pulse.
 *
 * `nowIso` is passed in rather than read, so the liveness the strip shows is
 * derived against the same instant the rest of the response was assembled at.
 */
export async function readPulse(
  repos: ControlPlaneRepositories,
  nowIso: string,
): Promise<LivePulse> {
  const [heartbeat, snapshot, research, decisions, receipts, jobs, intents, sourceProgress] = await Promise.all([
    reading("the runner's heartbeat", async () => (await repos.runnerHeartbeat.read(RUNNER_ID)) ?? null),
    reading("the control centre snapshot", async () => (await repos.ownerSnapshots.readNarrowed(SNAPSHOT_ID, PULSE_SNAPSHOT_FIELDS)) ?? null),
    reading("the research lane's state", async () => (await repos.researchState.readNarrowed(RESEARCH_STATE_ID, PULSE_RESEARCH_FIELDS)) ?? null),
    reading("the decisions you have recorded", async () => repos.ownerDecisions.read(DECISION_LOG_KEY)),
    reading("what this console has already done", async () => repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY)),
    reading("the jobs running for you", async () => repos.agentJobs.read(AGENT_JOB_LOG_KEY)),
    reading("your research requests", async () => repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)),
    reading("shared source activity", async () => repos.ownerDigests.readRecent(HUNT_SOURCE_PROGRESS_LOG_KEY, 1)),
  ]);

  const snapshotValue = (snapshot.value?.value ?? null) as PulseSnapshot | null;
  const counts = countsFrom(snapshotValue);

  /*
   * A delegated-job row whose status this module cannot read is not a finished
   * job; it is a job whose state we cannot report. An empty log is zero, an
   * unreadable row makes the whole count unknown, and both say so.
   */
  const jobCount = jobs.value === null ? null : liveJobCount(jobs.value);

  /*
   * "Waiting on you" is the published cards MINUS the ones already decided, and
   * the split is the one `splitDecided` already does for the control centre. A
   * second definition of "waiting" would let the strip and the page below it
   * disagree about the number the owner is looking straight at.
   */
  let decisionsWaiting: number | null = null;
  if (snapshotValue !== null && decisions.value !== null) {
    decisionsWaiting = splitDecided(snapshotValue.decisionCards, collapseDecisionLog(decisions.value)).waiting.length;
  }

  const unread = [
    heartbeat.unread,
    snapshot.unread,
    research.unread,
    decisions.unread,
    receipts.unread,
    jobs.unread,
    intents.unread,
    sourceProgress.unread,
    jobCount !== null && jobCount.unreadable > 0
      ? "how many jobs are running for you (the log holds rows this strip cannot read)"
      : null,
    ...counts.unread,
    decisionsWaiting === null && snapshot.unread === null && decisions.unread === null
      ? "how many decisions are waiting on you"
      : null,
  ].filter((name): name is string => name !== null);

  const beat = heartbeat.value?.value ?? null;
  return {
    revision: pulseRevision({
      beatAt: beat?.beatAt ?? null,
      heartbeatRevision: heartbeat.value?.revision ?? null,
      snapshotRevision: snapshot.value?.revision ?? null,
      decisionCount: decisions.value?.length ?? null,
      researchRevision: research.value?.revision ?? null,
      receiptCount: receipts.value?.length ?? null,
      researchIntentCount: intents.value?.length ?? null,
      sourceProgressId: sourceProgress.value?.[0]?.digestId ?? null,
      capabilityRevision: `${ADMIN_CAPABILITIES.revision}|${ADMIN_V6_CAPABILITY_REVISION}`,
    }),
    at: nowIso,
    capabilities: ADMIN_CAPABILITIES,
    v6: ADMIN_V6_CAPABILITIES,
    runner: {
      beatAt: beat?.beatAt ?? null,
      lastCycleFinishedAt: beat?.lastCycleFinishedAt ?? null,
      nextCycleDueAt: beat?.nextCycleDueAt ?? null,
      /*
       * ALIVE / LATE / SILENT / NEVER_BEAT, DERIVED from the beat and this
       * instant — never a stored flag, because a stored `alive: true` stops
       * being true without anything rewriting it. It is a machine token in a
       * data body: the surface renders it through `plainCode` in
       * `lib/control-plane/plain-words.ts`, which is where a constant becomes
       * words. Null when the heartbeat could not be read at all, which is a
       * different fact from a runner that has never beaten.
       */
      state: heartbeat.failed ? null : livenessOf(beat, nowIso).state,
    },
    counts: {
      decisionsWaiting,
      freshnessDebtRows: counts.freshnessDebtRows,
      incidents: counts.incidents,
      obligations: counts.obligations,
      // An empty log is a real answer: nothing is running. A log we could not
      // read, or one holding a row whose state this strip cannot read, is not —
      // both land in `unread` above with the count left null.
      agentJobsRunning: jobCount === null || jobCount.unreadable > 0 ? null : jobCount.running,
    },
    /* The lane strip rides on the research state already read above: one read serves both. */
    lanes: pulseLanesOf(research.value?.value ?? null),
    unread,
  };
}
