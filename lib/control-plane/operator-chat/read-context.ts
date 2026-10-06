/**
 * **BUILDING THE CONTEXT — server side, one connection, only what was asked
 * for.** (ADM-C7.)
 *
 * The impure half of `context.ts`. It opens the control plane exactly once per
 * turn through the console's single seam (`openControlPlane`), issues the
 * readings {@link requiredReads} declared for the question in ONE `Promise.all`
 * so every panel of the answer agrees about one instant, and hands back a
 * context whose absent fields mean "this question did not need that record".
 *
 * It deliberately does NOT read the other environments. Production's build
 * identity is fetched by the route (`operator-chat/environments.ts`), so this
 * module stays a read of the control plane and nothing else.
 *
 * ## The state version an action quotes
 *
 * A proposal made against this console has to say what the console was looking
 * at, so the gateway can refuse it as stale if the world moved before the owner
 * confirmed. That value is the console's PULSE REVISION, read here through the
 * gateway's own `readPulse` — the same function `/api/admin/action` calls to
 * work out what "current" is. Deriving a second answer to that question here
 * would not be a check: two definitions of what the world is now make every
 * proposal stale, or nothing ever stale, depending on which drifted.
 *
 * When the pulse was not read the version is null, and an action that requires
 * one is refused rather than submitted blind.
 */

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
import { readResearchIntents } from "../research-view.ts";
import { readPulse } from "../gateway/pulse-read.ts";
import { neon } from "@neondatabase/serverless";
import { readFlowWeek, type FlowWeek } from "../admin-view/flow-read.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import type { ContextRead, OperatorContext } from "./context.ts";

export interface ContextRequest {
  readonly reads: readonly ContextRead[];
  readonly nowIso: string;
  /** The console path the owner asked from. */
  readonly from: string;
}

/**
 * What the control plane could tell us, plus why not when it could not.
 *
 * A store that will not open is reported once, as a sentence, rather than
 * seven times as seven identical failures — and the context that comes back
 * carries no readings at all, so every answer built from it is gaps.
 */
export interface ContextReading {
  readonly context: OperatorContext;
  /** Null when the control plane opened. A sentence for the owner when it did not. */
  readonly storeRefusedBecause: string | null;
}

/**
 * What the owner is told when the store will not open.
 *
 * Deliberately NOT `openControlPlane`'s own detail. That sentence names the
 * environment variable, which is the right thing in a server log and the wrong
 * thing in a browser — the console never renders a variable's name, let alone a
 * value. The owner gets the part he can act on: nothing was read, and the
 * console is not saying anything it cannot see.
 */
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
  const [snapshot, heartbeat, digests, decisions, intents, fleet, research, pulse, flow] = await Promise.all([
    wanted.has("snapshot") ? readSnapshot(repos) : Promise.resolve(undefined),
    wanted.has("heartbeat") ? readHeartbeat(repos) : Promise.resolve(undefined),
    wanted.has("digests") ? readDigests(repos) : Promise.resolve(undefined),
    wanted.has("decisions") ? readDecisions(repos) : Promise.resolve(undefined),
    wanted.has("intents") ? readResearchIntents(repos) : Promise.resolve(undefined),
    wanted.has("fleet") ? readFleetInputs(repos) : Promise.resolve(undefined),
    wanted.has("research") ? readFleetSafety(repos) : Promise.resolve(undefined),
    wanted.has("pulse") ? readPulse(repos, request.nowIso) : Promise.resolve(undefined),
    wanted.has("flow") ? readFlow(request.nowIso) : Promise.resolve(undefined),
  ]);

  /*
   * The pulse revision, or nothing. There is deliberately no fallback to some
   * other timestamp: an action that requires a state version and cannot get the
   * one the gateway compares against is refused, and a substitute value would
   * make every such action stale forever while looking like it worked.
   */
  const stateVersion = pulse === undefined ? null : pulse.revision;

  return {
    context: {
      nowIso: request.nowIso,
      from: request.from,
      stateVersion,
      snapshot,
      heartbeat,
      digests,
      decisions,
      intents,
      fleet,
      research,
      flow,
    },
    storeRefusedBecause: null,
  };
}

/** The week of flow counts; a store that cannot be asked, or no record yet, is a named outcome and never a zero. */
async function readFlow(nowIso: string): Promise<ReadOutcome<FlowWeek>> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return { kind: "STORE_UNREACHABLE", detail: "The place that keeps the hourly flow record could not be reached." };
  try {
    const week = await readFlowWeek({ control: neon(url), through: nowIso });
    return week === null ? { kind: "NOT_RECORDED", detail: "No fact has been recorded going live yet, so there is nothing to count." } : { kind: "HELD", value: week };
  } catch (error) {
    return unreachable("the hourly flow record", error);
  }
}
