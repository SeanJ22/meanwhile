/**
 * **ASK COUNTS THE GAPS IT TOLD A READER — BY BODY, GAP AND DAY — AND NOTHING
 * ABOUT THE READER.** (2026-09-25.)
 *
 * The owner's decision (Sean, 2026-09-25): "Recording the government body
 * behind an unanswered Ask question is approved. Record the body identifier
 * and necessary work metadata so the system can create targeted work to fill
 * the information gap. This does not approve new storage of personal
 * information, raw question histories, or tracking individual readers."
 *
 * So after an answer, each coded gap it STATED (`gap-codes.ts`: an agenda not
 * held, an outcome not read, a stale calendar, an unreadable outcome store, a
 * body we hold no meeting of) adds one to that body's count for that gap and
 * that UTC day. The row is `lib/control-plane/ask-gap-observations.ts`'s: the
 * body id, the code, its record class, the day, the count. This module is the
 * only way Ask reaches it, and it is handed only the gaps — never the request,
 * the question, the reader's place, a key or a clock finer than the day.
 *
 * ## When nothing is written, by name
 *
 * ```
 *   NO_CODED_GAP        the answer stated no coded gap about a body
 *   NOT_A_READER        a declared synthetic run (the reader proofs, walks,
 *                       keep-warm): only a reader's ask raises work
 *   EDGE_ONLY_CONTEXT   a reader-edge context that refuses the database
 *                       (lib/registry/runtime-edge.ts) — decided in the
 *                       handler, where that context is visible
 *   NO_STORE            not the production runtime, or no control plane is
 *                       configured: a local server never counts into
 *                       production's work
 *   REFUSED             a value that is not exactly an observation (a caller
 *                       bug, named rather than laundered)
 *   FAILED              the store refused or did not answer within its bound
 * ```
 *
 * The write runs after the response (`lib/log/after-response.ts`), bounded.
 * A failure, a refusal, and a production runtime with no control plane are
 * logged by name (error name and code only — a driver message can carry its
 * connection string). None of it reaches the reader.
 */
import type { RunMarker } from "../db/run-marker.ts";
import { ReaderEdgeOnlyRefusal, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import {
  askGapObservation,
  MAX_ASK_GAP_OBSERVATIONS_PER_ANSWER,
  pgAskGapObservationSink,
  type AskGapObservation,
  type AskGapObservationSink,
} from "../control-plane/ask-gap-observations.ts";
import type { EvidenceGap } from "./evidence.ts";
import type { AskGapCode } from "./gap-codes.ts";
import type { HeldAskGap } from "./held-gaps.ts";

/** One coded gap an answer stated about one body. */
export interface StatedAskGap {
  readonly bodyId: string;
  readonly code: AskGapCode;
}

/** What of a topic timeline says a gap: its entries' statuses, and the coded gaps it holds. */
export interface StatingTimeline {
  readonly entries: readonly { readonly status: string }[];
  readonly heldGaps: readonly Pick<HeldAskGap, "code" | "bodyId">[];
}

/**
 * Every (body, code) the delivered answer told the reader, once each. A gap
 * sentence carries its code; a topic timeline states "outcome not read" in
 * the sentence of each concluded entry instead, so it counts when an entry
 * says so and the timeline holds that coded gap.
 */
export function statedAskGaps(input: { readonly gaps: readonly EvidenceGap[]; readonly timelines: readonly StatingTimeline[] }): StatedAskGap[] {
  const out = new Map<string, StatedAskGap>();
  const add = (bodyId: string, code: AskGapCode): void => {
    const key = `${bodyId}#${code}`;
    if (!out.has(key)) out.set(key, { bodyId, code });
  };
  for (const gap of input.gaps) if (gap.code && gap.bodyId) add(gap.bodyId, gap.code);
  for (const timeline of input.timelines) {
    if (!timeline.entries.some((entry) => entry.status === "OUTCOME_NOT_READ")) continue;
    for (const held of timeline.heldGaps) if (held.code === "OUTCOME_NOT_READ") add(held.bodyId, held.code);
  }
  return [...out.values()];
}

export type AskGapObservationSkip = "NO_CODED_GAP" | "NOT_A_READER" | "EDGE_ONLY_CONTEXT" | "NO_STORE" | "REFUSED";

export type AskGapObservationPlan =
  | { readonly kind: "RECORD"; readonly observations: readonly AskGapObservation[] }
  | { readonly kind: "SKIPPED"; readonly why: AskGapObservationSkip; readonly detail: string };

export type AskGapObservationOutcome =
  | { readonly kind: "RECORDED"; readonly count: number }
  | { readonly kind: "SKIPPED"; readonly why: AskGapObservationSkip; readonly detail: string }
  | { readonly kind: "FAILED"; readonly detail: string };

/**
 * Decide what one answer records. Call it IN the route handler: the
 * edge-only context is read from where the handler entered it. Never throws.
 */
export function planAskGapObservations(input: {
  readonly stated: readonly StatedAskGap[];
  readonly runClass: RunMarker["runClass"];
  /** The server's clock; only its UTC day is kept. Defaults to this process's clock. */
  readonly nowIso?: string;
}): AskGapObservationPlan {
  if (input.stated.length === 0) return { kind: "SKIPPED", why: "NO_CODED_GAP", detail: "the answer stated no coded gap about a body" };
  if (input.runClass !== "ORGANIC") {
    return { kind: "SKIPPED", why: "NOT_A_READER", detail: `a ${input.runClass} run is not a reader, so its answer raises no work` };
  }
  try {
    refuseDatabaseInEdgeOnlyContext("Ask-gap observations");
  } catch (error) {
    if (error instanceof ReaderEdgeOnlyRefusal) return { kind: "SKIPPED", why: "EDGE_ONLY_CONTEXT", detail: error.message };
    throw error;
  }
  try {
    const nowIso = input.nowIso ?? (override?.now ?? (() => new Date().toISOString()))();
    return {
      kind: "RECORD",
      observations: input.stated.slice(0, MAX_ASK_GAP_OBSERVATIONS_PER_ANSWER).map((stated) => askGapObservation(stated, nowIso)),
    };
  } catch (error) {
    return { kind: "SKIPPED", why: "REFUSED", detail: error instanceof Error ? error.message : String(error) };
  }
}

/* A test installs its own sink (and may pin the clock); production resolves the control plane's. */
let override: { readonly sink: AskGapObservationSink | null; readonly now?: () => string } | null = null;

/** Test seam: route this process's observations into `sink` (null: record nowhere), optionally on a pinned clock. `restore` returns to the default. */
export function installAskGapObservationSinkForTests(sink: AskGapObservationSink | null | "restore", options: { readonly now?: () => string } = {}): void {
  override = sink === "restore" ? null : { sink, ...(options.now ? { now: options.now } : {}) };
}

/**
 * The production sink: the control plane's table, from the production runtime
 * only (`NODE_ENV`, the signal `lib/db/write-guard.ts` uses for the same
 * reason — a local `next dev` must not count into production's work).
 */
function defaultSink(): { readonly sink: AskGapObservationSink } | { readonly none: string; readonly misconfigured: boolean } {
  if (process.env.NODE_ENV !== "production") {
    return { none: "this is not the production runtime, so no reader's ask is counted here", misconfigured: false };
  }
  const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL?.trim();
  if (!url) return { none: "WTP_CONTROL_PLANE_DATABASE_URL is not set in the production runtime", misconfigured: true };
  return { sink: pgAskGapObservationSink(url) };
}

/** Error name and code only: a driver message can carry its connection string. */
function failureWords(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const ours = error instanceof Error && /^(?:CONTROL_PLANE_REQUEST_TIMEOUT|ASK_GAP_OBSERVATION_)/.test(error.message) ? `: ${error.message}` : "";
  return `${name}${typeof code === "string" ? ` (${code})` : ""}${ours}`;
}

/**
 * Write a plan. Never throws: the answer has already gone, and a count that
 * could not be taken is logged by name, never shown to the reader.
 */
export async function recordAskGapObservations(plan: AskGapObservationPlan): Promise<AskGapObservationOutcome> {
  let outcome: AskGapObservationOutcome;
  let loud = false;
  if (plan.kind === "SKIPPED") {
    outcome = plan;
    loud = plan.why === "REFUSED";
  } else {
    try {
      const resolved = override ?? defaultSink();
      if ("none" in resolved) {
        outcome = { kind: "SKIPPED", why: "NO_STORE", detail: resolved.none };
        loud = resolved.misconfigured;
      } else if (resolved.sink === null) {
        outcome = { kind: "SKIPPED", why: "NO_STORE", detail: "this process records Ask-gap observations nowhere" };
      } else {
        outcome = { kind: "RECORDED", count: await resolved.sink.record(plan.observations) };
      }
    } catch (error) {
      outcome = { kind: "FAILED", detail: failureWords(error) };
      loud = true;
    }
  }
  if (loud) console.warn(`ask-gap observation ${outcome.kind === "SKIPPED" ? outcome.why : outcome.kind}: ${"detail" in outcome ? outcome.detail : ""}`);
  return outcome;
}
