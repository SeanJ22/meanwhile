import type { DebtCause, FreshnessDebt } from "../scheduler/debt.ts";
import type { AcquirerResult } from "./research-types.ts";
import { needsSourceInvestigation, plainRereadSlot } from "./detective.ts";

/**
 * CH-23 part 3 (DP-02 in the coordinator): what a failed read of a known door stands for, in the round's own debt
 * causes, so the coordinator applies the same passing-outage rule the round does. A rate limit, a 5xx or a timeout
 * is a passing outage; a host refusing us, or a page that no longer serves the record, is the site changing.
 */
export function acquirerFailureCause(result: AcquirerResult): DebtCause {
  const codes = new Set(result.blockers.map(blocker => blocker.code));
  if (codes.has("RATE_LIMITED")) return "RATE_LIMITED";
  if (codes.has("PUBLISHER_AUTHENTICATION")) return "REFUSED_BY_HOST";
  if (codes.has("DOCUMENT_INACCESSIBLE") || result.verdict === "EMPTY") return "EXTRACTION_FAILED";
  const read = [...result.walk].reverse().find(step => step.rung !== "permission" && step.transport !== "NOT_ATTEMPTED");
  if (read?.transport === "CHALLENGED") return "REFUSED_BY_HOST";
  if (read?.transport === "FAILED_AT_RUNG") return /\b(404|410)\b/.test(read.observed) ? "EXTRACTION_FAILED" : "UPSTREAM_ERROR";
  return "TRANSPORT_FAILED";
}

export type KnownDoorRetry =
  /** Read the door again now with plain code. */
  | { readonly kind: "PLAIN_RETRY" }
  /** A passing outage that is not yet due: it waits for its free retry and owes no paid walk. */
  | { readonly kind: "OUTAGE_WAIT"; readonly retryAt: string }
  /** The door is shut (or the old rule applies): the investigation gets the turn. */
  | { readonly kind: "INVESTIGATE" };

/**
 * The next step for a known door whose latest read failed. With the one hunter path on, a passing outage keeps its
 * plain backoff retry and never waits on a paid walk, and a shut door alternates its detective with a plain re-read by
 * hourly slot (`plainRereadSlot`), so a door that recovers is read again even while paid research is paused. With the
 * switch off, the old rule stands: a retry only once a Scout has tried since the failure.
 */
export function knownDoorRetry(input: { readonly debt: FreshnessDebt | null; readonly now: string; readonly scoutTriedAfterFailure: boolean;
  readonly shutThreshold: number; readonly oneHunterPath: boolean }): KnownDoorRetry {
  const { debt, now } = input;
  if (!debt) return { kind: "INVESTIGATE" };
  const due = Date.parse(debt.retryAt) <= Date.parse(now);
  if (!input.oneHunterPath) return due && input.scoutTriedAfterFailure ? { kind: "PLAIN_RETRY" } : { kind: "INVESTIGATE" };
  if (!needsSourceInvestigation(debt, input.shutThreshold)) return due ? { kind: "PLAIN_RETRY" } : { kind: "OUTAGE_WAIT", retryAt: debt.retryAt };
  return due && (input.scoutTriedAfterFailure || plainRereadSlot(debt, Date.parse(now), input.shutThreshold))
    ? { kind: "PLAIN_RETRY" } : { kind: "INVESTIGATE" };
}
