import {
  openControlPlane,
  unreachable,
  type ReadOutcome,
  readDecisions,
  readDigests,
  readFleetInputs,
  readFleetSafety,
  readHeartbeat,
  readSnapshot,
} from "../admin-data.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { readPlaceStuck } from "./place-stuck.ts";
import { readResearchIntents } from "../research-view.ts";
import { readPulse } from "../gateway/pulse-read.ts";
import { neon } from "@neondatabase/serverless";
import { yesterdayWindow } from "../admin-view/cost-reporting-view.ts";
import { readFlowWeek, type FlowWeek } from "../admin-view/flow-read.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import type { ContextRead, OperatorContext } from "./context.ts";

export interface ContextRequest {
  readonly asked?: string;
  readonly reads: readonly ContextRead[];
  readonly nowIso: string;
  readonly from: string;
}

export interface ContextReading {
  readonly context: OperatorContext;
  readonly storeRefusedBecause: string | null;
}

/** Deliberately not `openControlPlane`'s own detail, which names an environment variable. */
export const STORE_WOULD_NOT_OPEN =
  "The console could not reach the place it keeps its records, so it read nothing and is not saying anything about " +
  "what is there. That is a fact about this console, not about the system it watches.";

export async function readOperatorContext(request: ContextRequest): Promise<ContextReading> {
  const wanted = new Set<ContextRead>(request.reads);

  const opened = await openControlPlane();
  if (!opened.ok) {
    return {
      context: { nowIso: request.nowIso, from: request.from, stateVersion: null },
      storeRefusedBecause: STORE_WOULD_NOT_OPEN,
    };
  }
  const repos = opened.repos;

  /*
   * One `Promise.all` rather than seven awaits: the readings must agree about
   * one instant, and a serial read chain lets the runner beat between the
   * heartbeat and the work it is supposed to explain.
   */
  const [snapshot, heartbeat, digests, decisions, intents, fleet, research, pulse, config, flow] = await Promise.all([
    wanted.has("snapshot") ? readSnapshot(repos) : Promise.resolve(undefined),
    wanted.has("heartbeat") ? readHeartbeat(repos) : Promise.resolve(undefined),
    wanted.has("digests") ? readDigests(repos) : Promise.resolve(undefined),
    wanted.has("decisions") ? readDecisions(repos) : Promise.resolve(undefined),
    wanted.has("intents") ? readResearchIntents(repos) : Promise.resolve(undefined),
    wanted.has("fleet") ? readFleetInputs(repos) : Promise.resolve(undefined),
    wanted.has("research") ? readFleetSafety(repos) : Promise.resolve(undefined),
    wanted.has("pulse") ? readPulse(repos, request.nowIso) : Promise.resolve(undefined),
    wanted.has("config") ? repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null) : Promise.resolve(undefined),
    wanted.has("flow") ? readFlow(request.nowIso) : Promise.resolve(undefined),
  ]);

  /* The pulse revision or nothing: a substitute timestamp would make every such action stale. */
  const stateVersion = pulse === undefined ? null : pulse.revision;
  const placeStuck = wanted.has("placeStuck") ? await readPlaceStuck(request.asked ?? "", request.from, request.nowIso).catch(() => null) : undefined;

  return {
    context: {
      nowIso: request.nowIso,
      from: request.from,
      stateVersion,
      ...(flow === undefined ? {} : { flow }),
      ...(config === undefined ? {} : { adminConfig: config && isAdminConfig(config.value) ? config.value : null }),
      ...(placeStuck === undefined ? {} : { placeStuck: placeStuck === null ? { kind: "NOT_RECORDED" as const, detail: "Choose a place, or try again when its live score and stuck work can be read." } : { kind: "HELD" as const, value: placeStuck } }),
      snapshot,
      heartbeat,
      digests,
      decisions,
      intents,
      fleet,
      research,
    },
    storeRefusedBecause: null,
  };
}

/** The week of flow counts; a store that cannot be asked, or no record yet, is a named outcome and never a zero. */
async function readFlow(nowIso: string): Promise<ReadOutcome<FlowWeek>> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return { kind: "STORE_UNREACHABLE", detail: "The place that keeps the hourly flow record could not be reached." };
  try {
    const yesterday = yesterdayWindow(nowIso);
    const week = await readFlowWeek({ control: neon(url), through: yesterday.through, lastDay:yesterday });
    return week === null ? { kind: "NOT_RECORDED", detail: "No fact has been recorded going live yet, so there is nothing to count." } : { kind: "HELD", value: week };
  } catch (error) {
    return unreachable("the hourly flow record", error);
  }
}
