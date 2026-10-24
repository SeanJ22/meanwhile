import {
  DISPOSITIONS,
  OPEN_DISPOSITIONS,
  TERMINAL_DISPOSITIONS,
  type Disposition,
  type PermissionState,
  type TransportState,
} from "../workstate/types.ts";
import { leavesReclaimable, mayWriteDisposition, type Attempt } from "./attempt.ts";
import { routeTaskId } from "./ids.ts";
import type { WorkerTaskSpec } from "./workers/types.ts";

export const ROUTE_TASK_STATES = [
  "RESULT_RECORDED",
  "PENDING",
  "CLAIMED",
  "RECLAIMABLE",
  /** Our own policy refused a capability. Not reclaimable (an identical retry is refused identically) and not a disposition (a fact about us, never about a government). */
  "POLICY_DENIED",
  "DISPOSED",
] as const;
export type RouteTaskState = (typeof ROUTE_TASK_STATES)[number];

/** What our policy refused, and what must change before a retry is anything but a repeat. */
export interface PolicyDenial {
  readonly attemptId: string;
  readonly at: string;
  readonly policyVersion: string;
  readonly reason: string;
  readonly requiredChange: string;
}

export interface RouteObservation {
  readonly rawCount: number;
  readonly normalizedCount: number;
  /** Subjects this route returned that no other disposed route for the same WorkItem returned. */
  readonly routeOnlyCount: number | null;
  readonly earliest: string | null;
  readonly latest: string | null;
}

export interface RouteDisposition {
  readonly disposition: Disposition;
  readonly attemptId: string;
  readonly at: string;
  /** Vault artifact ids. A YIELDED route with no artifact cannot be replayed. */
  readonly artifactIds: readonly string[];
  readonly observation: RouteObservation | null;
  /** Orthogonal to each other and to the disposition. */
  readonly permission: PermissionState;
  readonly transport: TransportState;
  readonly note: string;
}

export interface RouteTask {
  readonly policyReauthorizations?: readonly { at: string; denial: PolicyDenial; reason: string }[];
  readonly workerTask?: WorkerTaskSpec;
  readonly id: string;
  readonly workItemId: string;
  readonly routeId: string;
  readonly routeLabel: string;
  readonly target: string;
  readonly inherited: boolean;
  readonly state: RouteTaskState;
  readonly disposition: RouteDisposition | null;
  readonly attemptIds: readonly string[];
  readonly createdAt: string;
  /** Set only in `POLICY_DENIED`; absent on older rows means no denial. */
  readonly policyDenial?: PolicyDenial | null;
}

export function createRouteTask(input: {
  workItemId: string;
  routeId: string;
  routeLabel: string;
  target: string;
  inherited: boolean;
  now: string;
}): RouteTask {
  return {
    id: routeTaskId(input.workItemId, input.routeId, input.target),
    workItemId: input.workItemId,
    routeId: input.routeId,
    routeLabel: input.routeLabel,
    target: input.target,
    inherited: input.inherited,
    state: "PENDING",
    disposition: null,
    attemptIds: [],
    createdAt: input.now,
    policyDenial: null,
  };
}

export class DispositionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispositionRefused";
  }
}

/**
 * Write the atomic terminal disposition for a completed route walk. Refuses an Attempt that did not
 * complete, a second disposition, `INGESTED` with no artifact, `WALKED_NO_YIELD` without a reachable
 * transport, a disposition stamped with another Attempt's id, and artifact ids its Attempt never recorded.
 */
export function disposeRoute(
  task: RouteTask,
  attempt: Attempt,
  disposition: RouteDisposition,
): RouteTask {
  if (attempt.routeTaskId !== task.id) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} belongs to RouteTask ${attempt.routeTaskId}, not ${task.id}.`,
    );
  }
  if (disposition.attemptId !== attempt.id) {
    throw new DispositionRefused(
      `The disposition for route ${task.routeLabel} names Attempt ${disposition.attemptId || "(none)"} ` +
        `but is being presented by Attempt ${attempt.id}. A disposition is evidence FROM one ` +
        "execution; attributing it to another makes the record unreplayable and the attribution false.",
    );
  }
  const recorded = new Set(attempt.artifactIds);
  const foreign = disposition.artifactIds.filter((id) => !recorded.has(id));
  if (foreign.length > 0) {
    throw new DispositionRefused(
      `The disposition for route ${task.routeLabel} cites artifact ${foreign[0]}, which Attempt ` +
        `${attempt.id} never recorded (it holds ${attempt.artifactIds.length === 0 ? "none" : attempt.artifactIds.join(", ")}). ` +
        "A disposition may not cite evidence its own Attempt never captured.",
    );
  }
  if (!mayWriteDisposition(attempt)) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} ended as ${attempt.outcome ?? "STILL_OPEN"} and may not dispose of ` +
        `route ${task.routeLabel}. An interrupted walk is an execution fact, never a public-record ` +
        "conclusion. The RouteTask stays reclaimable.",
    );
  }
  if (task.disposition !== null) {
    throw new DispositionRefused(
      `RouteTask ${task.id} is already disposed as ${task.disposition.disposition}. ` +
        "A second disposition would overwrite the record rather than add to it.",
    );
  }
  if (!DISPOSITIONS.includes(disposition.disposition)) {
    throw new DispositionRefused(`Unknown disposition ${disposition.disposition}.`);
  }
  if (disposition.disposition === "INGESTED" && disposition.artifactIds.length === 0) {
    throw new DispositionRefused(
      `Route ${task.routeLabel} claims INGESTED with no vault artifact. ` +
        "A yield that cannot be replayed is not evidence.",
    );
  }
  if (disposition.disposition === "WALKED_NO_YIELD" && disposition.transport !== "REACHABLE") {
    throw new DispositionRefused(
      `Route ${task.routeLabel} claims WALKED_NO_YIELD with transport ${disposition.transport}. ` +
        "A route that did not answer returned nothing ABOUT US, not nothing about the government. " +
        "Record the transport failure on the Attempt and leave the route open.",
    );
  }
  return {
    ...task,
    state: "DISPOSED",
    disposition,
    attemptIds: task.attemptIds.includes(attempt.id)
      ? task.attemptIds
      : [...task.attemptIds, attempt.id],
  };
}

/**
 * Return the RouteTask to the pool after its Attempt died. The Attempt must belong to this task and have
 * ended; a COMPLETED Attempt with no disposition is a lost disposition and is refused, and
 * `DENIED_BY_POLICY` goes to `denyByPolicy`.
 */
export function reclaim(task: RouteTask, attempt: Attempt): RouteTask {
  if (task.disposition !== null) {
    throw new DispositionRefused(
      `RouteTask ${task.id} is disposed; a dead Attempt cannot reopen a settled route. ` +
        "Reopening is the reopening engine's job and requires a new method.",
    );
  }
  if (attempt.routeTaskId !== task.id) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} belongs to RouteTask ${attempt.routeTaskId} and may not reclaim ` +
        `${task.id}. A worker does not reset a route it never walked.`,
    );
  }
  if (attempt.outcome === null) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} has not ended and cannot be reclaimed against. An open Attempt is ` +
        "not a dead one; reclaiming underneath a live worker duplicates its side effect against " +
        "the publisher. End it — LEASE_EXPIRED is how a stopped heartbeat is recorded — then reclaim.",
    );
  }
  if (attempt.outcome === "COMPLETED") {
    throw new DispositionRefused(
      `Attempt ${attempt.id} ended as COMPLETED and cannot be treated as dead. A completed Attempt ` +
        `that left route ${task.routeLabel} undisposed is a LOST DISPOSITION in our writer, not a ` +
        "crash, and recycling it as debris deletes the only evidence of that bug.",
    );
  }
  if (attempt.outcome === "DENIED_BY_POLICY") {
    throw new DispositionRefused(
      `Attempt ${attempt.id} was DENIED_BY_POLICY on route ${task.routeLabel}. Our own policy ` +
        "refused a capability, so nothing about the publisher changed and an identical retry is " +
        "refused identically. Record it with denyByPolicy(), which names what must change first.",
    );
  }
  if (!leavesReclaimable(attempt)) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} ended as ${attempt.outcome}, which is not in RECLAIMABLE_OUTCOMES. ` +
        "An outcome nobody has classified is not silently treated as a crash.",
    );
  }
  return {
    ...task,
    state: "RECLAIMABLE",
    attemptIds: task.attemptIds.includes(attempt.id)
      ? task.attemptIds
      : [...task.attemptIds, attempt.id],
  };
}

/** Record that our policy refused this route and what must change. Writes no disposition; the task stays outstanding. */
export function denyByPolicy(
  task: RouteTask,
  attempt: Attempt,
  requiredChange: string,
): RouteTask {
  if (task.disposition !== null) {
    throw new DispositionRefused(
      `RouteTask ${task.id} is already disposed as ${task.disposition.disposition}; a policy ` +
        "denial cannot overwrite a walked route.",
    );
  }
  if (attempt.routeTaskId !== task.id) {
    throw new DispositionRefused(
      `Attempt ${attempt.id} belongs to RouteTask ${attempt.routeTaskId}, not ${task.id}.`,
    );
  }
  if (attempt.outcome !== "DENIED_BY_POLICY") {
    throw new DispositionRefused(
      `Attempt ${attempt.id} ended as ${attempt.outcome ?? "STILL_OPEN"}, not DENIED_BY_POLICY. ` +
        "Only an actual policy refusal may put a route into POLICY_DENIED; anything else would " +
        "let an ordinary failure claim we chose not to walk.",
    );
  }
  if (requiredChange.trim() === "") {
    throw new DispositionRefused(
      `A policy denial on route ${task.routeLabel} must name WHAT MUST CHANGE before a retry. ` +
        "A denial nobody can act on is a route quietly removed from the hunt.",
    );
  }
  return {
    ...task,
    state: "POLICY_DENIED",
    policyDenial: {
      attemptId: attempt.id,
      at: attempt.endedAt ?? attempt.startedAt,
      policyVersion: attempt.policyVersion,
      reason: attempt.abortReason ?? "(no reason recorded)",
      requiredChange,
    },
    attemptIds: task.attemptIds.includes(attempt.id)
      ? task.attemptIds
      : [...task.attemptIds, attempt.id],
  };
}

/**
 * A RouteTask still owed work: never disposed, or disposed into an OPEN state.
 *
 * `POLICY_DENIED` is outstanding, and falls out of the first line rather than
 * needing a case: it carries no disposition, because nothing was learned. A
 * route WE refused is still owed — the obligation is unchanged and only our
 * grant is in the way.
 */
export function isOutstanding(task: RouteTask): boolean {
  if (task.workerTask && task.state === "RESULT_RECORDED") return false;
  if (task.disposition === null) return true;
  return OPEN_DISPOSITIONS.includes(task.disposition.disposition);
}

export function isTerminal(task: RouteTask): boolean {
  if (task.workerTask && task.state === "RESULT_RECORDED") return true;
  return (
    task.disposition !== null && TERMINAL_DISPOSITIONS.includes(task.disposition.disposition)
  );
}
