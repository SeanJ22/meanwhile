import type { DebtCause } from "../scheduler/debt.ts";
import type { AcquirerResult } from "./research-types.ts";

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
