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
import { installMeetingClockFrom } from "../meetings/settings.ts";
import { assertAggregateOnly, type OwnerDecisionIntent, type OwnerDigestRecord, type OwnerSnapshot, type RunnerHeartbeat } from "./owner-surface.ts";

export const SNAPSHOT_ID = "current";
export const RUNNER_ID = "pilot-runner";
export const CACHE_OBSERVATION_ID = "organic-prod-ask";
export const DIGEST_LOG_KEY = "owner-digest";
export const DECISION_LOG_KEY = "owner-decision";

export const DIGEST_HISTORY_LIMIT = 20;

export type ReadOutcome<T> =
  | { readonly kind: "HELD"; readonly value: T }
  | { readonly kind: "NOT_RECORDED"; readonly detail: string }
  | { readonly kind: "STORE_UNREACHABLE"; readonly detail: string };

export function unreachable<T>(which: string, error: unknown): ReadOutcome<T> {
  return {
    kind: "STORE_UNREACHABLE",
    detail: `Reading ${which} failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
  };
}

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
    const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
    assertDurableRepositories(repos, "the owner control centre");
    return { ok: true, repos };
  } catch (error) {

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

export async function readDecisionCards(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<Pick<OwnerSnapshot, "decisionCards">>> {
  return readAggregate(repos, "control-centre snapshot", async () => {
    const row = await repos.ownerSnapshots.readNarrowed(SNAPSHOT_ID, { decisionCards: true });
    return row === null ? null : { value: row.value as Pick<OwnerSnapshot, "decisionCards"> };
  });
}

export async function readHeartbeat(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<RunnerHeartbeat>> {
  return readAggregate(repos, "runner heartbeat", () => repos.runnerHeartbeat.read(RUNNER_ID));
}

export async function readDigests(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly OwnerDigestRecord[]>> {
  try {
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

export async function readMapTilerUsageDigests(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly OwnerDigestRecord[]>> {
  try {
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

export async function readLatestIntakeRuntimeDigest(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<OwnerDigestRecord>> {
  try {
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

export async function readFleetSafety(repos: ControlPlaneRepositories): Promise<ReadOutcome<ResearchState>> {
  return readAggregate(repos, "the Fleet safety state", () => repos.researchState.read(RESEARCH_STATE_ID));
}

export async function readAdminConfig(repos: ControlPlaneRepositories,state?:string): Promise<ReadOutcome<AdminConfig>> {
  const read = await readAggregate(repos, "the owner operational policy", () => repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:state?{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}:true}));
  if (read.kind === "HELD") installMeetingClockFrom(read.value);
  return read;
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
