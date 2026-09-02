/**
 * **WHAT THE ADMIN PAGE READS, AND THE THREE ANSWERS IT MAY GIVE.**
 * (Session C final, ITEM H, 2026-09-01.)
 *
 * Server-side only. Every function here opens the control-plane connection, and
 * that connection string may never reach a browser.
 *
 * ## Three answers, never two
 *
 * ```
 *   HELD              the record exists and this is it
 *   NOT_RECORDED      the store is reachable and holds no such record
 *   STORE_UNREACHABLE we could not ask
 * ```
 *
 * Collapsing the last two is the defect this module exists to prevent. "The
 * runner has not beaten" and "we could not reach the store that would tell us
 * whether the runner has beaten" are different facts, and only one of them is
 * about the runner. A page that rendered both as "no heartbeat" would report a
 * broken control plane as a dead runner — and would report a dead runner as a
 * broken control plane, which is worse, because the owner would go looking in
 * the wrong place while the pilot stayed down.
 *
 * CLAUDE.md: **absence is never asserted**, and a failed retrieval is reported
 * as a failed retrieval with the wall named.
 */

import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "./repository/pg-store.ts";
import { assertDurableRepositories } from "./repository/types.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import {
  assertAggregateOnly,
  type CacheObservationRecord,
  type OwnerDecisionIntent,
  type OwnerDigestRecord,
  type OwnerSnapshot,
  type RunnerHeartbeat,
} from "./owner-surface.ts";

/** The canonical ids. One snapshot, one runner, one standing cache check. */
export const SNAPSHOT_ID = "current";
export const RUNNER_ID = "pilot-runner";
export const CACHE_OBSERVATION_ID = "organic-prod-ask";
export const DIGEST_LOG_KEY = "owner-digest";
export const DECISION_LOG_KEY = "owner-decision";

/** How many digests the history list shows. */
export const DIGEST_HISTORY_LIMIT = 20;

export type ReadOutcome<T> =
  | { readonly kind: "HELD"; readonly value: T }
  | { readonly kind: "NOT_RECORDED"; readonly detail: string }
  | { readonly kind: "STORE_UNREACHABLE"; readonly detail: string };

/**
 * A read that threw, as the outcome every view reports it as. ONE
 * implementation: the research view and the window view each carried a copy
 * until the duplicate sweep caught them at the 2026-09-02 integration.
 */
export function unreachable<T>(which: string, error: unknown): ReadOutcome<T> {
  return {
    kind: "STORE_UNREACHABLE",
    detail: `Reading ${which} failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
  };
}

/**
 * Open the control plane, or say precisely why not.
 *
 * `NOT_CONFIGURED` is a legitimate state — a machine without a control plane is
 * not a broken machine — and it must not read as an outage. But on the DEPLOYED
 * admin host it is a real defect, because the page has nothing else to read, so
 * the detail says which variable is missing BY NAME. Never its value.
 */
export async function openControlPlane(): Promise<
  { readonly ok: true; readonly repos: ControlPlaneRepositories } | { readonly ok: false; readonly detail: string }
> {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    return {
      ok: false,
      detail:
        `${CONTROL_PLANE_URL_VAR} is not set in this runtime, so the control plane was never ` +
        "opened. This is a fact about our configuration, not about the pilot: nothing here has " +
        "been checked and found missing — it has not been checked.",
    };
  }
  try {
    const repos = await createPgRepositories(url);
    assertDurableRepositories(repos, "the owner control centre");
    return { ok: true, repos };
  } catch (error) {
    // The message may contain the connection string on some driver errors.
    // Naming the variable instead is both safer and more useful.
    return {
      ok: false,
      detail:
        `The control plane named by ${CONTROL_PLANE_URL_VAR} could not be opened ` +
        `(${(error as Error)?.name ?? "error"}). We could not ask, so we are not saying.`,
    };
  }
}

async function readAggregate<T>(
  repos: ControlPlaneRepositories,
  which: string,
  read: () => Promise<{ value: T } | null>,
): Promise<ReadOutcome<T>> {
  try {
    const row = await read();
    if (row === null) {
      return {
        kind: "NOT_RECORDED",
        detail: `The control plane is reachable and holds no ${which} record yet.`,
      };
    }
    return { kind: "HELD", value: row.value };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading ${which} failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

export async function readSnapshot(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<OwnerSnapshot>> {
  return readAggregate(repos, "control-centre snapshot", () =>
    repos.ownerSnapshots.read(SNAPSHOT_ID),
  );
}

export async function readHeartbeat(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<RunnerHeartbeat>> {
  return readAggregate(repos, "runner heartbeat", () => repos.runnerHeartbeat.read(RUNNER_ID));
}

export async function readCacheObservation(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<CacheObservationRecord>> {
  return readAggregate(repos, "organic prod-ask cache observation", () =>
    repos.cacheObservations.read(CACHE_OBSERVATION_ID),
  );
}

/**
 * The digest history, newest first.
 *
 * The append-only log is ordered by position, which is insertion order, so the
 * newest is last. Reversing here rather than at each call site keeps one
 * definition of "newest" — two surfaces disagreeing about which digest is
 * current is exactly the drift RULING 103 is about.
 */
export async function readDigests(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly OwnerDigestRecord[]>> {
  try {
    const rows = await repos.ownerDigests.read(DIGEST_LOG_KEY);
    if (rows.length === 0) {
      return {
        kind: "NOT_RECORDED",
        detail: "The control plane is reachable and holds no digest yet.",
      };
    }
    return { kind: "HELD", value: [...rows].reverse().slice(0, DIGEST_HISTORY_LIMIT) };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the digest log failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

export async function readDecisions(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly OwnerDecisionIntent[]>> {
  try {
    const rows = await repos.ownerDecisions.read(DECISION_LOG_KEY);
    return { kind: "HELD", value: [...rows].reverse() };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the decision log failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/**
 * Append an owner decision INTENT.
 *
 * This is the only write the admin surface makes, and it writes an intent —
 * never the canonical record. `lib/control-plane/owner-surface.ts` carries the
 * argument for why in full; the short version is that a web request cannot run
 * `pnpm governance:check`, cannot regenerate the views, and therefore cannot
 * make a governance change atomically. One that tried would be hand-editing a
 * generated artifact from a browser.
 *
 * The record is checked for reader-level fields before it is written, because
 * the cheapest place to catch an aggregate-only violation is before it is
 * durable.
 */
export async function appendDecisionIntent(
  repos: ControlPlaneRepositories,
  intent: OwnerDecisionIntent,
  nowIso: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }> {
  try {
    assertAggregateOnly(intent, "appendDecisionIntent");
    await repos.ownerDecisions.append(DECISION_LOG_KEY, intent.intentId, intent, nowIso);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message ?? "the append failed" };
  }
}
