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
import { leavesReclaimable, mayWriteDisposition, type Attempt } from "./attempt.ts";
import { routeTaskId } from "./ids.ts";
import type { WorkerTaskSpec } from "./workers/types.ts";

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
  /** A computational worker finished. This is never a civic route disposition. */
  "RESULT_RECORDED",
  /** Created from an applicable inherited route. No Attempt yet. */
  "PENDING",
  /** Leased and being walked. */
  "CLAIMED",
  /** A prior Attempt ended without reaching a boundary. Free to re-claim. */
  "RECLAIMABLE",
  /**
   * OUR policy engine refused a capability this route needs. The route was not
   * walked, nothing was learned about the publisher, and an identical retry
   * would be refused identically.
   *
   * This is deliberately NOT `RECLAIMABLE`, which is why it exists. A
   * reclaimable task invites the next worker to pick it up and try again, and
   * that is the right invitation after a crash or a timeout — the world may
   * have changed. After a policy denial nothing about the world has changed;
   * what must change is the POLICY or the GRANT, on our side. Sweeping this
   * into `RECLAIMABLE` builds a retry loop that burns attempts against a
   * decision we made about ourselves and never revisits.
   *
   * It is equally NOT a disposition. `DENIED_BY_POLICY` is absent from
   * `RECLAIMABLE_OUTCOMES` and from `DISPOSITION_BEARING_OUTCOMES`, and both
   * absences are correct: a refusal by our own policy is a fact about US, and
   * a fact about us may never be written into the record as a fact about a
   * government.
   */
  "POLICY_DENIED",
  /** A completed Attempt wrote a disposition. */
  "DISPOSED",
] as const;
export type RouteTaskState = (typeof ROUTE_TASK_STATES)[number];

/**
 * What our own policy refused, and what would have to change before a retry is
 * anything other than a repeat of the same refusal.
 *
 * `requiredChange` is mandatory prose because the alternative is a task that
 * sits in `POLICY_DENIED` forever with nobody able to say what would unstick
 * it. "Denied" is not actionable; "the ACQUIRER grant does not carry
 * THIRD_PARTY_CONTACT and this route needs it" is.
 */
export interface PolicyDenial {
  /** The Attempt the policy engine refused. */
  readonly attemptId: string;
  /** `attempt.endedAt`. No clock is read here; the Attempt already carries one. */
  readonly at: string;
  /** The capability-grant version in force when the refusal happened. */
  readonly policyVersion: string;
  /** The Attempt's named `abortReason`. Never "unknown" — `endAttempt` refuses that. */
  readonly reason: string;
  /** WHAT MUST CHANGE. A grant, a policy version, an author decision. */
  readonly requiredChange: string;
}

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
  /** A transient local policy condition changed; the original denied Attempt remains immutable history. */
  readonly policyReauthorizations?: readonly { at: string; denial: PolicyDenial; reason: string }[];
  readonly workerTask?: WorkerTaskSpec;
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
  /**
   * Set only in `POLICY_DENIED`. Optional so that a RouteTask persisted before
   * this state existed still loads; absent is read as "no policy denial", which
   * is what it was.
   */
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
 *
 * ## The disposition must be BOUND to the Attempt presenting it
 *
 * Three separate identity checks run before any of the value rules, because a
 * disposition is a claim about a government and the only thing entitling it to
 * be believed is the execution that earned it. Checking the RouteTask alone —
 * which is all this function used to do — left two laundering routes wide open:
 *
 *   - A COMPLETED Attempt A hands over a disposition stamped `attemptId: B`.
 *     The record then attributes the finding to an Attempt that never made it,
 *     and every later replay — which resolves the artifact set, the method
 *     version and the policy version THROUGH the named Attempt — reconstructs a
 *     walk that did not happen.
 *   - A disposition cites artifact ids its own Attempt never recorded. Evidence
 *     borrowed from a different execution is evidence for a different claim; a
 *     `INGESTED` backed by somebody else's capture is exactly the shape of an
 *     unreplayable yield that `artifactIds.length === 0` was already there to
 *     forbid.
 *
 * Both refusals name the offending id rather than reporting that something was
 * wrong, because the next session has to be able to act on it.
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
 * Return the RouteTask to the pool after an Attempt DIED.
 *
 * The Attempt and its partial artifacts are kept. Only the CONCLUSION is
 * withheld, because there was never one to keep.
 *
 * ## Reclaiming is a claim about a specific corpse, and it is checked
 *
 * This function used to check only that the task was undisposed, which meant
 * ANY Attempt could reclaim ANY task. That is a state transition on the
 * strength of an assertion, and the assertion it rests on — "the previous
 * worker is dead" — is precisely the belief `LeaseConflict` exists to distrust.
 * Four things are proven instead:
 *
 *   - The Attempt belongs to THIS RouteTask. A foreign Attempt reopening a task
 *     is one worker resetting another worker's route.
 *   - The Attempt has ENDED. A still-open Attempt is not dead; it is running,
 *     possibly against a government server right now, and reclaiming underneath
 *     it produces the duplicate side effect the lease was built to prevent.
 *     "It looks stuck" is read from the LEASE, and an expired lease is closed
 *     as `LEASE_EXPIRED` before it is reclaimed.
 *   - A `COMPLETED` Attempt is not dead either. A completed Attempt with no
 *     disposition is a LOST DISPOSITION — a bug in our writer, not a crash —
 *     and quietly recycling it as debris destroys the one signal that would
 *     have surfaced it.
 *   - `DENIED_BY_POLICY` is routed to `denyByPolicy`, not swept in here.
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

/**
 * Record that OUR policy engine refused this route, and what must change.
 *
 * Separate from `reclaim` because the two say opposite things to the next
 * worker. `RECLAIMABLE` means "pick this up and try again" — correct after a
 * crash, a timeout or an expired lease, where the world may since have moved.
 * `POLICY_DENIED` means "do not try this again until something on OUR side
 * changes", and it carries the sentence saying which thing.
 *
 * It writes no disposition, and that is not an oversight. `DENIED_BY_POLICY` is
 * absent from `DISPOSITION_BEARING_OUTCOMES`, the route was never walked, and
 * nothing whatever was learned about the publisher. The task stays OUTSTANDING
 * (`isOutstanding` is true of it) because a route we refused ourselves is not a
 * settled fact about a government, and `evaluateCompletion` refuses the
 * obligation by name while it stands.
 */
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

/** A RouteTask whose disposition genuinely terminates it. */
export function isTerminal(task: RouteTask): boolean {
  if (task.workerTask && task.state === "RESULT_RECORDED") return true;
  return (
    task.disposition !== null && TERMINAL_DISPOSITIONS.includes(task.disposition.disposition)
  );
}
