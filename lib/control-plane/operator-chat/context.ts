import type { ReadOutcome } from "../admin-data.ts";
import { gap, held, type Held } from "../owner-surface.ts";
import type { OwnerDecisionIntent, OwnerDigestRecord, OwnerSnapshot, RunnerHeartbeat } from "../owner-surface.ts";
import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { FlowWeek } from "../admin-view/flow-read.ts";
import type { ChatTopic } from "./contract.ts";

/** As the environment itself reported it; one that did not answer carries `detail`, never a null read as "no code". */
export interface EnvironmentIdentity {
  readonly name: string;
  readonly sha: string | null;
  readonly deployId: string | null;
  readonly branch: string | null;
  readonly context: string | null;
  readonly observedAt: string;
  readonly source: string;
  readonly detail: string | null;
  /** Staging only: the review state its manifest reported for that build. */
  readonly reviewState: string | null;
  /** Staging only: the review-readiness status its manifest reported. */
  readonly reviewStatus: string | null;
}

export interface EnvironmentIdentities {
  readonly production: EnvironmentIdentity;
  readonly staging: EnvironmentIdentity;
}

export interface FleetInputs {
  readonly attempts: readonly Attempt[];
  readonly workItems: readonly WorkItem[];
  readonly routeTasks: readonly RouteTask[];
}

export const CONTEXT_READS = [
  "snapshot",
  "heartbeat",
  "digests",
  "decisions",
  "intents",
  "fleet",
  "research",
  "environments",
  "flow",
  "pulse",
] as const;
export type ContextRead = (typeof CONTEXT_READS)[number];

export interface OperatorContext {
  readonly nowIso: string;
  readonly from: string;
  readonly stateVersion: string | null;
  readonly snapshot?: ReadOutcome<OwnerSnapshot>;
  readonly heartbeat?: ReadOutcome<RunnerHeartbeat>;
  readonly digests?: ReadOutcome<readonly OwnerDigestRecord[]>;
  readonly decisions?: ReadOutcome<readonly OwnerDecisionIntent[]>;
  readonly intents?: ReadOutcome<readonly ResearchIntent[]>;
  readonly fleet?: ReadOutcome<FleetInputs>;
  readonly research?: ReadOutcome<ResearchState>;
  readonly environments?: ReadOutcome<EnvironmentIdentities>;
  readonly flow?: ReadOutcome<FlowWeek>;
}

export function requiredReads(topic: ChatTopic): readonly ContextRead[] {
  switch (topic) {
    case "FLEET_BLOCKERS":
      return ["heartbeat", "intents", "research", "fleet", "snapshot"];
    case "SINCE_LAST_CYCLE":
      return ["heartbeat", "digests", "fleet"];
    case "OVERDUE_SOURCES":
      return ["snapshot"];
    case "LATEST_FAILED_ACQUISITION":
      return ["fleet"];
    case "WAITING_ON_YOU":
      return ["snapshot", "decisions", "intents", "heartbeat"];
    case "COMPARE_ENVIRONMENTS":
      return ["heartbeat", "environments"];
    case "INTEGRATION_STATUS":
      return ["heartbeat", "environments"];
    case "SPEND_AND_FACTS":
      return ["flow"];
    default:
      return [];
  }
}

/** Must be the same pulse revision the gateway compares against, never a second idea of "current". */
export const ACTION_READS: readonly ContextRead[] = ["pulse"];

/** A store miss is ours to publish; an unreachable store is UNKNOWABLE_NOW; an unasked reading says so. */
export function holding<T>(reading: ReadOutcome<T> | undefined, what: string): Held<T> {
  if (reading === undefined) {
    return gap<T>("OURS", `The console did not read ${what} to answer this question.`);
  }
  if (reading.kind === "HELD") return held(reading.value);
  if (reading.kind === "NOT_RECORDED") return gap<T>("OURS", reading.detail);
  return gap<T>("UNKNOWABLE_NOW", reading.detail);
}
