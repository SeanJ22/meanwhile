/**
 * ROUTE TASKS — one route, walked for one obligation, disposed of atomically.
 *
 * The RouteTask is the join between two things this repository already has and
 * one thing it did not:
 *
 *   - `lib/method` knows WHICH routes exist and which are applicable. That is
 *     the inherited floor, and it is not re-derived here.
 *   - `lib/workstate/types.ts` knows what a disposition MEANS — the eleven-value
 *     `Disposition` vocabulary that RULING 184 argued into existence, where
 *     `BLOCKED_CURRENTLY` and `RECORDS_REQUEST_PENDING` are open states wearing
 *     a finished face. That vocabulary is authority and is imported, never
 *     re-declared.
 *   - What did not exist: a durable, leasable, retryable unit of ROUTE WORK
 *     that outlives the worker walking it. That is this file.
 *
 * The target architecture names five dispositions (YIELDED, ZERO, FAILED,
 * ROUTE_BLOCKED, NOT_APPLICABLE). The repository's vocabulary is strictly
 * richer and already governed, so the design document's names are treated as a
 * READING of the repo vocabulary rather than a replacement for it. The mapping
 * is written down in `DESIGN_DOC_DISPOSITION_READING` below so that nobody
 * later "reconciles" the two by inventing a second enum.
 */

import {
  DISPOSITIONS,
  OPEN_DISPOSITIONS,
  TERMINAL_DISPOSITIONS,
  type Disposition,
  type PermissionState,
  type TransportState,
} from "../workstate/types.ts";
import { mayWriteDisposition, type Attempt } from "./attempt.ts";
import { routeTaskId } from "./ids.ts";

/**
 * How the target architecture's five names read against the governed
 * vocabulary. Documentation, not a type — there is exactly one enum.
 */
export const DESIGN_DOC_DISPOSITION_READING: Readonly<Record<string, Disposition>> = {
  YIELDED: "INGESTED",
  ZERO: "WALKED_NO_YIELD",
  ROUTE_BLOCKED: "BLOCKED_CURRENTLY",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  // "FAILED" deliberately has no single mapping. A failure is either a
  // transport fact (the Attempt aborted — not a disposition at all), a
  // capability gap (REQUIRES_NEW_ADAPTER), or a wall (BLOCKED_CURRENTLY).
  // Collapsing all three into one word is how a wall became an emptiness.
};

export const ROUTE_TASK_STATES = [
  /** Created from an applicable inherited route. No Attempt yet. */
  "PENDING",
  /** Leased and being walked. */
  "CLAIMED",
  /** A prior Attempt ended without reaching a boundary. Free to re-claim. */
  "RECLAIMABLE",
  /** A completed Attempt wrote a disposition. */
  "DISPOSED",
] as const;
export type RouteTaskState = (typeof ROUTE_TASK_STATES)[number];

/** What a completed walk actually observed. Counts, not adjectives. */
export interface RouteObservation {
  /** Raw rows/instances the route returned before normalisation. */
  readonly rawCount: number;
  /** Unique subjects after normalisation. */
  readonly normalizedCount: number;
  /**
   * Subjects THIS route returned that no other disposed route for the same
   * WorkItem returned. The number that makes denominator disagreement visible
   * instead of averaging it away.
   */
  readonly routeOnlyCount: number | null;
  readonly earliest: string | null;
  readonly latest: string | null;
}

export interface RouteDisposition {
  readonly disposition: Disposition;
  /** The Attempt that earned it. A disposition with no Attempt is not evidence. */
  readonly attemptId: string;
  readonly at: string;
  /** Vault artifact ids. A YIELDED route with no artifact cannot be replayed. */
  readonly artifactIds: readonly string[];
  readonly observation: RouteObservation | null;
  /** Orthogonal to each other and to the disposition (RULING 182). */
  readonly permission: PermissionState;
  readonly transport: TransportState;
  /** Why, in one sentence a later session can act on. */
  readonly note: string;
}

export interface RouteTask {
  readonly id: string;
  readonly workItemId: string;
  /** The route id in the method store. The inherited floor references these. */
  readonly routeId: string;
  /** Human-readable route label, e.g. "Legistar /EventDates". */
  readonly routeLabel: string;
  /** What this route is being walked FOR — usually a host or endpoint family. */
  readonly target: string;
  /**
   * True when the route came from the inherited method floor rather than being
   * discovered mid-walk. An inherited route with no disposition is the single
   * most important completion refusal in the system.
   */
  readonly inherited: boolean;
  readonly state: RouteTaskState;
  readonly disposition: RouteDisposition | null;
  readonly attemptIds: readonly string[];
  readonly createdAt: string;
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
  };
}

export class DispositionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispositionRefused";
  }
}

/**
 * Write the atomic terminal disposition for a completed route walk.
 *
 * Every refusal in this function is a failure mode the architecture named:
 *
 *   - An Attempt that did not reach a completion boundary cannot dispose of a
 *     route. This is partial-disposition poisoning, and it is the reason the
 *     control plane reads the Attempt rather than accepting a worker's word.
 *   - A route cannot be disposed of twice. The first disposition is the record;
 *     a second one is either a duplicate worker or a rewrite of history.
 *   - `INGESTED` with no artifact is refused. A yield we cannot replay is a
 *     claim about a government resting on nothing.
 *   - `WALKED_NO_YIELD` — the route ran and returned nothing — is the most
 *     dangerous value in the vocabulary, because it is one careless read away
 *     from "this is not published". It is admitted only with a reachable
 *     transport. A route that never actually got a response is not a zero; it
 *     is a transport failure, and it belongs to the Attempt.
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
 * Return the RouteTask to the pool after an Attempt died.
 *
 * The Attempt and its partial artifacts are kept. Only the CONCLUSION is
 * withheld, because there was never one to keep.
 */
export function reclaim(task: RouteTask, attempt: Attempt): RouteTask {
  if (task.disposition !== null) {
    throw new DispositionRefused(
      `RouteTask ${task.id} is disposed; a dead Attempt cannot reopen a settled route. ` +
        "Reopening is the reopening engine's job and requires a new method.",
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

/** A RouteTask still owed work: never disposed, or disposed into an OPEN state. */
export function isOutstanding(task: RouteTask): boolean {
  if (task.disposition === null) return true;
  return OPEN_DISPOSITIONS.includes(task.disposition.disposition);
}

/** A RouteTask whose disposition genuinely terminates it. */
export function isTerminal(task: RouteTask): boolean {
  return (
    task.disposition !== null && TERMINAL_DISPOSITIONS.includes(task.disposition.disposition)
  );
}
