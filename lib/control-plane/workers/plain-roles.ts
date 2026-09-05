/**
 * **EACH ROLE SECTION LEADS WITH WHAT IT IS DOING AND WHETHER ANYTHING NEEDS
 * THE OWNER.** (ADM-10, the 9.4.26 evening admin feedback.)
 *
 * The owner's words on the instrument detail: *"I don't even know, again,
 * what I'm looking at. Is there a decision to be made? Is there not?"* The
 * per-role blocks were attempt tables — instance hashes, execution modes,
 * verdict codes like `AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE` —
 * with no sentence above them. The fleet cards on Pilot health already lead
 * with one sentence per group; this brings the same discipline down to the
 * role level, from the SAME readback the table renders, so the sentence and
 * the table can never disagree.
 *
 * Three things, in this order, because that is the order he asked them:
 *
 *   doing      what this role is doing right now, from the counts and the
 *              newest attempts
 *   needsYou   null when nothing here needs a decision from him — and the
 *              page then SAYS so in the first line, so he can move on — else
 *              one sentence naming the work item and why
 *   notes      what the table's codes mean, in words, for the codes that
 *              actually appear in it
 *
 * PURE: the readback row in, sentences out.
 */
import type { WorkItemState } from "../work-item.ts";
import { words } from "../display-name.ts";
import type { WorkerAttemptView, WorkerRoleView } from "./readback.ts";
import type { FleetRole } from "./types.ts";

export const ROLE_PLURAL: Record<FleetRole, string> = {
  PARSER: "Parsers",
  VALIDATOR: "Verifiers",
  ADVERSARIAL_AUDITOR: "Auditors",
  ACQUIRER: "Acquirers",
  DETECTIVE: "Detectives",
  ENGINEERING: "Engineers",
};

export const ROLE_JOB: Record<FleetRole, string> = {
  PARSER: "pull typed records out of the documents the hunters fetched",
  VALIDATOR: "check parsed records against the contract and against an outside authority before anything is trusted",
  ADVERSARIAL_AUDITOR: "try to break a record from independent evidence; a record that survives is one we can stand behind",
  ACQUIRER: "fetch records through the routes the scouts found",
  DETECTIVE: "settle one factual question at a time — same body or not, whole list or not — from evidence alone",
  ENGINEERING: "turn a verified method into code, proved in isolation and proposed for review, never merged on its own",
};

/** Verdict codes in words. Unknown codes fall back to their own words. */
const VERDICT_PLAIN: Record<string, string> = {
  INCONCLUSIVE: "the audit could not settle it either way, so nothing was certified",
  SURVIVED: "the record survived the audit",
  CANDIDATE_PROVED: "the method candidate was proved in isolation",
  PROOF_FAILED: "the method candidate failed its proof",
  PASS: "passed the check",
  FAIL: "failed the check",
  FAILED: "failed",
  EXTRACTED: "records were extracted",
  ACQUIRED: "the record was fetched",
  OBSERVED: "the fact was observed",
  SUPPORTED: "the evidence supports it",
  UNPROVEN: "not proven",
  REFUSED: "refused",
  NOT_RUN: "not run",
};

/** Finding codes in words. */
const FINDING_PLAIN: Record<string, string> = {
  AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE: "a model raised a doubt that needs machine-checkable evidence before it counts",
  AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE: "a model raised a doubt that needs machine-checkable evidence before it counts",
  AUDIT_EXTERNAL_AUTHORITY_MISSING: "no independent authority is on file to check this record against",
  PERMISSION_DENIED: "the source's permission rules refused the route",
  DECLARED_COUNT_MISMATCH: "the document's own stated count does not match what was extracted",
  DUPLICATE_SOURCE_RECORD_ID: "two records carried the same source id",
  SOURCE_PAGINATION_REMAINS: "more pages remain unread at the source",
  SUBRESOURCE_NOT_INTERPRETED: "a linked sub-document was not read",
  UNEXTRACTED_COMPOSITE_FIELD: "a compound field was left unsplit",
  ENGINEERING_CANDIDATE_REFUSED: "the method candidate was refused",
  ENGINEERING_DETERMINISTIC_PROOF_FAILED: "the deterministic proof failed",
};

const STATE_PLAIN: Record<WorkItemState | "UNKNOWN", string> = {
  OPEN: "open",
  BLOCKED: "blocked on a dependency",
  AWAITING_VALIDATION: "waiting for a verifier",
  AWAITING_AUDIT: "waiting for an auditor",
  AWAITING_OWNER: "waiting on you",
  REOPENED: "reopened",
  VERIFIED_COMPLETE: "verified complete",
  HUMAN_INTERACTION_REQUIRED: "needs a person at the source",
  OFFLINE_PUBLIC_ACCESS: "only available offline",
  RECORDS_REQUEST_REQUIRED: "needs a records request",
  NOT_YET_PUBLISHED: "not yet published by the source",
  RECORD_NOT_YET_CREATED: "the record does not exist yet",
  LEGALLY_WITHHELD: "legally withheld",
  AUTHOR_DECISION_REQUIRED: "needs your decision",
  UNKNOWN: "in an unrecorded state",
};

/** Work-item states that are the owner's to move. */
const OWNER_STATES: ReadonlySet<string> = new Set<string>(["AWAITING_OWNER", "AUTHOR_DECISION_REQUIRED", "RECORDS_REQUEST_REQUIRED", "HUMAN_INTERACTION_REQUIRED"]);

export function verdictPlain(code: string | null): string {
  if (code === null) return "no typed result was recorded";
  return VERDICT_PLAIN[code] ?? words(code).toLowerCase();
}

export function findingPlain(code: string): string {
  return FINDING_PLAIN[code] ?? words(code).toLowerCase();
}

export function workItemStatePlain(state: WorkItemState | "UNKNOWN"): string {
  return STATE_PLAIN[state] ?? words(state).toLowerCase();
}

export interface RoleLead {
  readonly title: string;
  readonly job: string;
  /** What this role is doing right now. One or two sentences. */
  readonly doing: string;
  /** Null when nothing here needs the owner; else the one sentence that names what does. */
  readonly needsYou: string | null;
  /** The codes the table beneath will show, each in words. Only codes that appear. */
  readonly glossary: readonly { readonly code: string; readonly means: string }[];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function outcomeSummary(attempts: readonly WorkerAttemptView[]): string {
  if (attempts.length === 0) return "";
  const by = new Map<string, number>();
  for (const a of attempts) by.set(a.outcome, (by.get(a.outcome) ?? 0) + 1);
  const parts = [...by.entries()].sort((x, y) => y[1] - x[1]).map(([outcome, n]) => `${n} ${outcome.toLowerCase()}`);
  const subjects = new Set(attempts.map((a) => a.workItemId));
  const same = subjects.size === 1 && attempts.length > 1 ? ", all on the same work item" : "";
  return `Of the ${attempts.length} newest: ${parts.join(", ")}${same}.`;
}

function verdictSummary(attempts: readonly WorkerAttemptView[]): string {
  const verdicts = attempts.map((a) => a.verdict).filter((v): v is string => v !== null);
  if (verdicts.length === 0) {
    const notRecorded = attempts.filter((a) => a.resultStatus === "NOT_RECORDED").length;
    return notRecorded > 0 ? ` ${plural(notRecorded, "of them recorded no typed result", "of them recorded no typed result")}.` : "";
  }
  const by = new Map<string, number>();
  for (const v of verdicts) by.set(v, (by.get(v) ?? 0) + 1);
  return ` Verdicts: ${[...by.entries()].map(([v, n]) => `${n} ${v.toLowerCase()} (${verdictPlain(v)})`).join("; ")}.`;
}

export function roleLead(role: WorkerRoleView): RoleLead {
  const title = ROLE_PLURAL[role.role];
  const job = ROLE_JOB[role.role];
  const running = role.attempts.filter((a) => a.outcome === "RUNNING").length;
  const recorded = role.shown.denominator;
  const pending = role.pending.value;
  const registered = role.pending.denominator;
  const due = role.due.value;

  const now =
    recorded === 0
      ? `No ${title.toLowerCase()} have run yet; ${pending === 0 ? "nothing is queued for them" : `${plural(pending, "task")} waiting`}.`
      : `${running === 0 ? "None working right now" : `${plural(running, "attempt")} running now`}; ` +
        `${plural(pending, "task")} waiting of ${registered} registered, ${due} due now; ${plural(recorded, "attempt")} on record.`;
  const doing = `${now} ${outcomeSummary(role.attempts)}${verdictSummary(role.attempts)}`.trim();

  const owner = role.attempts.find((a) => OWNER_STATES.has(a.workItemState));
  const needsYou = owner
    ? `Yes — work item ${owner.workItemId} is ${workItemStatePlain(owner.workItemState)}; nothing moves there until you act.`
    : null;

  const codes = new Map<string, string>();
  for (const a of role.attempts) {
    for (const f of a.findings) if (!codes.has(f.code)) codes.set(f.code, findingPlain(f.code));
    if (a.verdict !== null && !codes.has(a.verdict)) codes.set(a.verdict, verdictPlain(a.verdict));
  }
  const glossary = [...codes.entries()].map(([code, means]) => ({ code, means }));

  return { title, job, doing, needsYou, glossary };
}
