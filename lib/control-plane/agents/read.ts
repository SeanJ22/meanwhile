/**
 * **THE ONE PLACE THE AGENT BRIDGE ASKS THE STORE ANYTHING.**
 * (ADM-C8; the admin read model in `lib/control-plane/admin-data.ts` is the
 * pattern this follows and does not fork.)
 *
 * Three answers, never two — HELD, NOT_RECORDED, STORE_UNREACHABLE — because
 * "the bridge has never run a job" and "we could not reach the database" are
 * different facts about different things, and collapsing them is the defect
 * `admin-data.ts` exists to prevent. Here they are converted into the `Held<T>`
 * the page renders, with the distinction preserved where it belongs: in the
 * gap's OWNER. A store we could not ask is `UNKNOWABLE_NOW`; a log that is
 * genuinely empty is answered, and answers zero.
 *
 * ## Nothing here shrinks a population quietly
 *
 * `agentJobs` is a general log: the gateway declares it, and this bridge is one
 * writer of it. A row whose `extra` bag this bridge does not recognise is NOT a
 * job that did not happen — it is a job this page cannot read, and it is
 * counted separately and reported as such. Dropping it would make the console's
 * denominator quietly smaller than the truth, which is the exact failure
 * `liveJobCount`'s own `unreadable` counter exists to prevent.
 *
 * Server-side only. This module opens no connection of its own: it takes the
 * repositories `openControlPlane()` already returned.
 */

import { DECISION_LOG_KEY } from "../admin-data.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { AGENT_JOB_LOG_KEY } from "../gateway/agent-job.ts";
import { ADMIN_CONFIG_ID, isAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { gap, held, type Held } from "../owner-surface.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

import { fromAgentJobRecord, type DelegatedAgentJob } from "./job.ts";
import { REVIEW_DECISION_SUBJECT_PREFIX, type AgentBridgeInput } from "./view.ts";

/** What the job log holds, and how much of it this page could make sense of. */
export interface AgentJobReading {
  readonly jobs: readonly DelegatedAgentJob[];
  /** Rows in the log that were written by something other than this bridge. */
  readonly unreadable: number;
}

/**
 * Every delegated job, oldest first as the log holds them.
 *
 * An empty log is HELD-and-empty, not a gap: the store answered, and "no job
 * has been delegated yet" is a real, sayable fact. Only an unreachable store is
 * a gap.
 */
export async function readAgentJobs(repos: ControlPlaneRepositories): Promise<Held<AgentJobReading>> {
  try {
    const rows = await repos.agentJobs.read(AGENT_JOB_LOG_KEY);
    const jobs: DelegatedAgentJob[] = [];
    let unreadable = 0;
    for (const row of rows) {
      const job = fromAgentJobRecord(row);
      if (job === null) unreadable += 1;
      else jobs.push(job);
    }
    return held({ jobs, unreadable });
  } catch (error) {
    return gap(
      "UNKNOWABLE_NOW",
      `Reading the delegated-job log failed (${(error as Error)?.name ?? "error"}). We could not ask, so nothing here is a reading of what the agents did.`,
    );
  }
}

/**
 * The owner's operational policy, for the one field this page reads: whether
 * paid API spending is allowed.
 *
 * `null` means "no setting recorded", which `apiFallbackPolicy` treats as OFF —
 * and so does an unreachable store, and so does a stored value that is not a
 * config at all. Failing closed on every path is the point: there is no reading
 * of the world in which the absence of an answer turns paid spending on.
 */
export async function readAdminConfig(repos: ControlPlaneRepositories): Promise<AdminConfig | null> {
  try {
    const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    return row !== null && isAdminConfig(row.value) ? row.value : null;
  } catch {
    return null;
  }
}

/**
 * The owner decisions recorded against a review.
 *
 * Folded through `collapseDecisionLog` first, so a decision that was later
 * resolved reads at its latest state rather than twice, and then narrowed to
 * the subjects this page mints.
 */
export async function readReviewDecisions(repos: ControlPlaneRepositories): Promise<AgentBridgeInput["decisions"]> {
  try {
    const rows = await repos.ownerDecisions.read(DECISION_LOG_KEY);
    return held(
      collapseDecisionLog([...rows].reverse())
        .filter((d) => d.subjectId.startsWith(REVIEW_DECISION_SUBJECT_PREFIX))
        .map((d) => ({ subjectId: d.subjectId, chosenOption: d.chosenOption, ownerAnswer: d.ownerAnswer ?? null, decidedAt: d.decidedAt })),
    );
  } catch (error) {
    // A decision log we could not read is NOT a review the owner stayed silent
    // about. Returning an empty list here would make every review card say "you
    // have not recorded a decision", which is an assertion about him built out
    // of a database error.
    return gap(
      "UNKNOWABLE_NOW",
      `Reading your decisions failed (${(error as Error)?.name ?? "error"}). We could not ask, so this page is not saying whether you decided anything about these reviews.`,
    );
  }
}
