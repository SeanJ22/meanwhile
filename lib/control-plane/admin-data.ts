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
import type { Attempt } from "./attempt.ts";
import type { RouteTask } from "./route-task.ts";
import type { WorkItem } from "./work-item.ts";
import { RESEARCH_STATE_ID, type ResearchState } from "./scheduler/research-policy.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "./gateway/admin-config.ts";
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
    // The page only reads (and appends intents); it never owns the schema, so
    // it skips the per-request bootstrap replay (ADM-2). The runner and the
    // publishers bootstrap.
    const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
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
    /* The digest HISTORY view: the newest bounded window, newest first. A tail
       read (ORDER BY position DESC LIMIT) rather than the whole 60+ MB log. */
    const rows = await repos.ownerDigests.readRecent(DIGEST_LOG_KEY, DIGEST_HISTORY_LIMIT);
    if (rows.length === 0) {
      return {
        kind: "NOT_RECORDED",
        detail: "The control plane is reachable and holds no digest yet.",
      };
    }
    return { kind: "HELD", value: rows };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the digest log failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/**
 * The newest digest alone: one row read from the tail of the log. A surface
 * that shows only the latest digest (the runner card) reads this rather than
 * the twenty-row history — 4.4 MB on 2026-09-25, of which it used 2.4 KB.
 */
export async function readLatestDigest(repos: ControlPlaneRepositories): Promise<ReadOutcome<OwnerDigestRecord>> {
  try {
    const [latest] = await repos.ownerDigests.readRecent(DIGEST_LOG_KEY, 1);
    return latest === undefined
      ? { kind: "NOT_RECORDED", detail: "The control plane is reachable and holds no digest yet." }
      : { kind: "HELD", value: latest };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the digest log failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/**
 * Every append-only MapTiler collection receipt, newest first.
 *
 * This deliberately does not reuse the bounded general digest view above. A
 * busy civic-data runner can write more than {@link DIGEST_HISTORY_LIMIT}
 * unrelated outcomes between two map-provider attempts; taking the newest
 * twenty and filtering afterward would silently erase the map-provider's 7d
 * and 30d history from Admin while the canonical rows still existed.
 */
export async function readMapTilerUsageDigests(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly OwnerDigestRecord[]>> {
  try {
    /* Every map-provider receipt, found by kind — a targeted content query, not
       the whole log — so the 7d/30d history is complete no matter how many
       unrelated outcomes a busy runner wrote between two map attempts. */
    const maptiler = await repos.ownerDigests.readWhere(
      DIGEST_LOG_KEY,
      ["runtimeOutcome", "kind"],
      "MAPTILER_USAGE_COLLECTION",
    );
    if (maptiler.length === 0) {
      return {
        kind: "NOT_RECORDED",
        detail: "The control plane is reachable and holds no append-only map-provider attempt yet.",
      };
    }
    return { kind: "HELD", value: [...maptiler].reverse() };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the map-provider outcome history failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/** Newest append-only intake observation, independent of the bounded digest-history view. */
export async function readLatestIntakeRuntimeDigest(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<OwnerDigestRecord>> {
  try {
    /* All intake observations by kind, newest last in append order. */
    const observations = await repos.ownerDigests.readWhere(
      DIGEST_LOG_KEY,
      ["runtimeOutcome", "kind"],
      "INTAKE_RUNTIME_OBSERVATION",
    );
    const latest = observations.at(-1);
    return latest
      ? { kind: "HELD", value: latest }
      : {
          kind: "NOT_RECORDED",
          detail: "The control plane is reachable and holds no append-only intake-runtime observation yet.",
        };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `Reading the intake-runtime outcome history failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/**
 * The canonical records the fleet view is projected from (ADM-7, 9.4.26):
 * every Attempt, WorkItem and RouteTask. Read together so the three agree
 * about one instant; a failed read is STORE_UNREACHABLE, never a zero fleet.
 */
export async function readFleetInputs(repos: ControlPlaneRepositories): Promise<
  ReadOutcome<{
    readonly attempts: readonly Attempt[];
    readonly workItems: readonly WorkItem[];
    readonly routeTasks: readonly RouteTask[];
  }>
> {
  try {
    const [attempts, workItems, routeTasks] = await Promise.all([
      repos.attempts.list(),
      repos.workItems.list(),
      repos.routeTasks.list(),
    ]);
    return {
      kind: "HELD",
      value: {
        attempts: attempts.map((r) => r.value),
        workItems: workItems.map((r) => r.value),
        routeTasks: routeTasks.map((r) => r.value),
      },
    };
  } catch (error) {
    return unreachable("the fleet's Attempts, WorkItems and RouteTasks", error);
  }
}

/** One targeted aggregate read for the runner's current safety projection. */
export async function readFleetSafety(repos: ControlPlaneRepositories): Promise<ReadOutcome<ResearchState>> {
  return readAggregate(repos, "the Fleet safety state", () => repos.researchState.read(RESEARCH_STATE_ID));
}

/**
 * The owner's operational policy — the API-fallback toggle and the Fleet
 * spend-ceiling override. `NOT_RECORDED` is the ordinary state (a console that
 * has never had a policy written reads as the defaults), and the caller resolves
 * a missing override to the built-in ceiling fallback.
 */
export async function readAdminConfig(repos: ControlPlaneRepositories): Promise<ReadOutcome<AdminConfig>> {
  return readAggregate(repos, "the owner operational policy", () => repos.adminConfig.read(ADMIN_CONFIG_ID));
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
