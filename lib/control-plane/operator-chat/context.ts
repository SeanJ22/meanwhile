/**
 * **WHAT THE CHAT IS LOOKING AT WHEN IT ANSWERS.** (ADM-C7.)
 *
 * The brief calls this a *contextual* operator chat, and the context is not a
 * mood: it is the exact set of records the console read to answer one message,
 * each carrying which of the three answers the store gave — HELD, NOT_RECORDED,
 * STORE_UNREACHABLE. That distinction is the whole reason a chat answer can be
 * trusted. *"The runner has not beaten"* and *"the store that would say whether
 * the runner has beaten could not be reached"* are different facts about
 * different machines, and a chat that flattened them would send the owner to
 * look in the wrong place.
 *
 * ## Why the readings are optional, and why that is not a fourth answer
 *
 * Every field is optional, and an absent field means exactly one thing: **this
 * question did not need that record, so it was not read.** {@link requiredReads}
 * is the declaration of what each question needs, the route reads only those,
 * and {@link holding} turns an absent field into a NAMED GAP with the same
 * shape as every other gap on the console. An absent field is therefore never
 * an absence finding, and the store's three answers stay three.
 *
 * This matters for cost as much as for honesty: comparing environments reaches
 * out to production and to staging over the network, and *"what is waiting on
 * me?"* has no business paying for that.
 *
 * PURE. The impure builder that actually opens the control plane lives in
 * `read-context.ts`; this module is types and total functions so the read
 * models can be unit tested without a store.
 */

import type { ReadOutcome } from "../admin-data.ts";
import { gap, held, type Held } from "../owner-surface.ts";
import type { OwnerDecisionIntent, OwnerDigestRecord, OwnerSnapshot, RunnerHeartbeat } from "../owner-surface.ts";
import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { FlowWeek } from "../admin-view/flow-read.ts";
import type { ChatTopic } from "./contract.ts";

/* --------------------------------------------------------- environments */

/**
 * One deployed environment's identity, as that environment itself reported it.
 *
 * Never inferred from a branch name or a build time: production answers with
 * its own build endpoint and staging answers with its own release manifest, and
 * an environment that did not answer carries `detail` saying so rather than a
 * null that reads as "no code deployed".
 */
export interface EnvironmentIdentity {
  readonly name: string;
  readonly sha: string | null;
  readonly deployId: string | null;
  readonly branch: string | null;
  readonly context: string | null;
  readonly observedAt: string;
  /** Plain English: where this identity came from. */
  readonly source: string;
  /** Why there is no identity, when there is none. */
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

/** The three canonical records the fleet view is projected from. */
export interface FleetInputs {
  readonly attempts: readonly Attempt[];
  readonly workItems: readonly WorkItem[];
  readonly routeTasks: readonly RouteTask[];
}

/* ------------------------------------------------------------- the context */

/** The readings a question can require. Names are the context's field names. */
export const CONTEXT_READS = [
  "config",
  "placeStuck",
  "snapshot",
  "heartbeat",
  "digests",
  "decisions",
  "intents",
  "fleet",
  "research",
  "environments",
  /** The last seven days of hourly flow counts, from findings to live, with settled spend (BR-31). */
  "flow",
  /**
   * Not a record but a reading: the console's current revision, which is what a
   * proposed action quotes so the gateway can tell it apart from one drawn
   * against a world that has since moved. It fills `stateVersion` rather than a
   * field of its own.
   */
  "pulse",
] as const;
export type ContextRead = (typeof CONTEXT_READS)[number];

/**
 * Everything one chat turn may look at.
 *
 * `stateVersion` is what a control rendered from this context quotes to the
 * Action Gateway, so a proposal made against one instant of the console is
 * refused as stale if the world has moved by the time it is confirmed. The
 * route supplies it; the console's published instant is the natural value and
 * the one the pages already treat as "when this was true".
 */
export interface OperatorContext {
  readonly nowIso: string;
  /** The console path the owner asked from. */
  readonly from: string;
  readonly stateVersion: string | null;
  readonly adminConfig?: import("../gateway/admin-config.ts").AdminConfig | null;
  readonly placeStuck?: ReadOutcome<import("./place-stuck.ts").PlaceStuckReading>;
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

/**
 * What each question needs read. The route reads exactly this and no more.
 *
 * Declared per topic rather than "read everything" because two of these
 * readings are expensive — the fleet inputs list three whole tables, and the
 * environments reach two other origins over the network — and a console that
 * paid for both to answer *"which sources are overdue?"* would be slower and
 * more failure-prone for no gain.
 */
export function requiredReads(topic: ChatTopic): readonly ContextRead[] {
  switch (topic) {
    case "PLACE_STUCK": return ["placeStuck"];
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

/**
 * An action proposal quotes the console's state version and needs nothing else.
 *
 * It must be the SAME value the gateway compares against — the console's pulse
 * revision — and not a second idea of "current" derived here. Two definitions of
 * what the world is now would make every proposal stale or nothing ever stale,
 * and neither would be a check.
 */
export const ACTION_READS: readonly ContextRead[] = ["pulse"];

/* ------------------------------------------------------------ the holding */

/**
 * One reading as a value or as the named gap where it would have been.
 *
 * The three store answers map to gap OWNERS, which is the whole point: a
 * record the store does not hold is OURS to publish, a store that could not be
 * reached is UNKNOWABLE_NOW, and a reading this question never asked for is
 * OURS as well — but says which of the two it is, in words, so the owner is
 * never left to guess whether the console looked.
 */
export function holding<T>(reading: ReadOutcome<T> | undefined, what: string): Held<T> {
  if (reading === undefined) {
    return gap<T>("OURS", `The console did not read ${what} to answer this question.`);
  }
  if (reading.kind === "HELD") return held(reading.value);
  if (reading.kind === "NOT_RECORDED") return gap<T>("OURS", reading.detail);
  return gap<T>("UNKNOWABLE_NOW", reading.detail);
}
