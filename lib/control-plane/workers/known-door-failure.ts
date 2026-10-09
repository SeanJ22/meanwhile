import type { DebtCause, FreshnessDebt } from "../scheduler/debt.ts";
import type { AcquirerResult } from "./research-types.ts";
import { needsSourceInvestigation, plainRereadSlot } from "./detective.ts";

/** What a failed read of a known door stands for, in the round's own debt causes: a rate limit, 5xx or timeout is a passing outage; a host refusing us or a page no longer serving the record is the site changing. */
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
  /** The door is shut: the investigation gets the turn. */
  | { readonly kind: "INVESTIGATE" };

/** Passing outages keep a free backoff retry; a shut door alternates investigation with a plain re-read. */
export function knownDoorRetry(input: { readonly debt: FreshnessDebt | null; readonly now: string; readonly scoutTriedAfterFailure: boolean;
  readonly shutThreshold: number }): KnownDoorRetry {
  const { debt, now } = input;
  if (!debt) return { kind: "INVESTIGATE" };
  const { retryAt } = debt;
  const due = Date.parse(retryAt) <= Date.parse(now);
  if (!needsSourceInvestigation(debt, input.shutThreshold)) return due ? { kind: "PLAIN_RETRY" } : { kind: "OUTAGE_WAIT", retryAt };
  return due && (input.scoutTriedAfterFailure || plainRereadSlot(debt, Date.parse(now), input.shutThreshold))
    ? { kind: "PLAIN_RETRY" } : { kind: "INVESTIGATE" };
}
