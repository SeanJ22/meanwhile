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
import { plainCode } from "../plain-words.ts";
import type { WorkerAttemptView, WorkerRoleView } from "./readback.ts";
import { FLEET_ROLES, type FleetRole } from "./types.ts";

/**
 * The plural of each role, DERIVED from the console's one dictionary.
 *
 * ADM-63. This was a second hand-kept dictionary and it disagreed with the
 * first on the same card: the heading read "Validators" from `plainCode` while
 * the activity sentence beneath it read "verifiers" from here. Neither was
 * dead code — both rendered, a few pixels apart.
 *
 * Deriving it means the disagreement cannot come back. A role whose singular
 * changes takes its plural with it, and there is nowhere left for a second
 * opinion to live.
 */
export const ROLE_PLURAL: Record<FleetRole, string> = Object.fromEntries(
  FLEET_ROLES.map((role) => [role, `${plainCode(role)}s`]),
) as Record<FleetRole, string>;

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

/**
 * **WHAT A FINDING MEANS, IN A WHOLE SENTENCE.** (9.6.26 owner feedback, ACLOSE-6.)
 *
 * `FINDING_PLAIN` above turns a code into a NOUN PHRASE — "source scope
 * mismatch" — and the owner read exactly that, beside the instrument's raw
 * engineering sentence, and said he still could not tell what had happened:
 *
 * > *"The held artifact must bind to the exact observed publisher, source,
 * > route, and URL scope."*
 *
 * That sentence is correct and it is written for whoever maintains the parser.
 * De-underscoring a constant is not translation; `plain-words.ts` says so in as
 * many words ("`REFUSED_BY_HOST` is 'The source refused the request', not
 * 'Refused by host'"). So this is the third layer that dictionary already
 * describes: the code as words, then what it MEANS, then the raw text one
 * disclosure down.
 *
 * Each sentence answers the two questions the row could not: **what did we
 * actually get**, and **what has to happen next**. They are written from the
 * refusal each code is thrown with (`record-evidence.ts`, `parser.ts`), not
 * invented — a mapping that guessed would be worse than the raw text, because
 * the raw text is at least true.
 *
 * An unmapped code returns null rather than a generic sentence. The row then
 * shows the noun phrase and the instrument's own words, which is where this
 * started — no worse, and never a fabricated explanation of a code nobody has
 * written one for yet.
 */
const FINDING_MEANING: Record<string, string> = {
  SOURCE_SCOPE_MISMATCH:
    "We fetched a document, but it turned out to describe a different publisher or route than the one this task was checking, so we did not use it.",
  SOURCE_SHAPE_UNSUPPORTED:
    "We found a page that describes where the records live rather than the records themselves. The next attempt has to follow the links on that page to the records.",
  ARTIFACT_PROVENANCE_MISSING:
    "The document we were handed did not carry a record of where it came from, and we do not read facts out of a document that cannot say who published it.",
  CONTRACT_SCOPE_MISSING: "Nobody had written down what this route is supposed to return, so there was nothing to check the document against.",
  DATE_MAPPING_MISSING: "The document has dates in it and nothing told us which field is which, so we did not guess.",
  DECLARED_COUNT_INVALID: "The document states how many records it holds and that number is not readable, so we could not check we got all of them.",
  DECLARED_COUNT_MISMATCH: "The document says how many records it holds, and we came out with a different number. We stopped rather than publish a short list as a complete one.",
  DELIMITED_TEXT_MALFORMED: "The file is a table of plain text and its rows do not line up, so reading it would have invented values.",
  DUPLICATE_JSON_KEY: "The same field appears twice in one record with different values, so there is no single answer to take.",
  DUPLICATE_SOURCE_RECORD_ID: "Two records arrived carrying the same identifier from the source, so we cannot tell them apart.",
  EMPTY_SOURCE_CELL: "A field we need was blank at the source. That is the source's gap, and we record it rather than fill it.",
  EXTRACTION_MAPPING_MISSING: "Nothing told us which parts of this document become which facts, so there was no safe way to read it.",
  FIELD_MAPPING_INVALID: "The instructions for reading this document point at fields the document does not have.",
  FIELD_TYPE_MISMATCH: "A field held something other than what it is supposed to hold — a word where a date belongs, or similar.",
  HTML_ACTIVE_CONTENT: "The page builds itself with scripts, so what we downloaded is not what a person sees. It needs a route that returns the records themselves.",
  HTML_CELL_INCOMPLETE: "A cell in the page's table was cut off, so the value in it is not the whole value.",
  HTML_ENTITY_UNSUPPORTED: "The page used a character escape we do not decode, and a mis-decoded name is a wrong name.",
  HTML_MERGED_CELL_UNSUPPORTED: "The table merges cells across rows or columns, so which value belongs to which record is genuinely ambiguous.",
  HTML_ROW_INCOMPLETE: "A row of the table has fewer cells than its header, so the columns no longer line up.",
  HTML_TABLE_UNSUPPORTED: "The page lays its records out in a shape this reader does not handle yet.",
  IDENTITY_CONTRACT_INVALID: "What is supposed to make each record unique was not stated in a usable way, so records could not be told apart.",
  IDENTITY_FIELD_MISSING: "The field that identifies each record is absent, so two records could not be distinguished.",
  JSON_MALFORMED: "The file is supposed to be structured data and it does not parse. Nothing was read from it.",
  JSON_NESTING_LIMIT: "The data is nested more deeply than we read, which is a limit of ours rather than a fault of the source.",
  JSON_ROWS_MISSING: "The response parsed and contained no list of records where one was expected.",
  REQUIRED_MAPPING_MISSING: "A field we must have has no rule saying where to find it in this document.",
  SOURCE_FIELD_MISSING: "A field we must have is not in this document at all.",
  TABLE_SCOPE_INVALID: "We were pointed at a table that is not the one holding these records.",
  XML_FIELD_AMBIGUOUS: "The same field name appears in more than one place in the document and nothing says which one is meant.",
  XML_MALFORMED: "The file is supposed to be structured data and it does not parse. Nothing was read from it.",
  XML_SHAPE_UNSUPPORTED: "The document is laid out in a shape this reader does not handle yet.",
  DECLARED_COUNT_CONFLICT: "The document states its own record count in two places and the two disagree.",
  SCHEMA_UNSUPPORTED: "The source describes its data in a form this reader does not handle yet.",
  ZERO_ROW_EXTRACTION:
    "We read the document successfully and it yielded no records at all. An empty extraction is treated as a failure, never as proof the source is empty.",
  ROW_SCHEMA_INVALID: "A record did not have the shape the rest of the document uses.",
  REQUIRED_FIELD_MISSING: "A record was missing a field we require, so we did not keep a partial record.",
  REQUIRED_FIELD_INVALID: "A required field held a value we could not accept.",
  IDENTITY_FIELD_INVALID: "The value meant to identify a record could not be used as an identifier.",
  CATEGORY_FIELD_INVALID: "A field that must be one of a fixed set of values held something outside that set.",
  NUMERIC_VALUE_INVALID: "A number did not read as a number, and we do not round or guess one.",
  EVIDENCE_SPAN_MISSING: "We could not point at the exact place in the document a value came from, and a value we cannot point at is not evidence.",
  SOURCE_PAGINATION_REMAINS: "There are more pages of records at the source that this attempt did not read, so what we have is a part and not the whole.",
  SUBRESOURCE_NOT_INTERPRETED: "A linked document was noticed and not read, so anything only it holds is still missing.",
  UNEXTRACTED_COMPOSITE_FIELD: "One field holds several facts together and was kept whole rather than split into a guess.",
  PERMISSION_DENIED: "The source's own rules say we may not take this route, so nothing was requested.",
  AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE:
    "A model suggested something might be wrong. A suggestion is not evidence, so nothing was changed until a machine can check it.",
  AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE:
    "A model suggested something might be wrong. A suggestion is not evidence, so nothing was changed until a machine can check it.",
  AUDIT_EXTERNAL_AUTHORITY_MISSING: "There is no independent source on file to check this record against, so it could not be confirmed by a second authority.",
  ENGINEERING_CANDIDATE_REFUSED: "A proposed piece of code did not meet the bar to be offered for review, so it was not offered.",
  ENGINEERING_DETERMINISTIC_PROOF_FAILED: "A proposed piece of code did not reproduce the result it claimed, so it was not offered for review.",
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

/**
 * What this finding MEANS, in a whole sentence, or null when nobody has written
 * one yet.
 *
 * Null rather than a generic sentence on purpose: a row that says "something
 * went wrong with the source" for a code it has no entry for has told the owner
 * less than the instrument's own words would have, while sounding like it told
 * him more.
 */
export function findingMeaning(code: string): string | null {
  return FINDING_MEANING[code] ?? null;
}

/** Every finding code that carries an owner sentence. Exported so a test can count them. */
export function findingCodesWithMeaning(): readonly string[] {
  return Object.keys(FINDING_MEANING);
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
  /*
   * The gloss is dropped when it repeats the word it is glossing. The owner
   * read `2 failed (failed)` and `1 extracted (records were extracted)` in one
   * sentence: the second is a translation, the first is the same word twice in
   * brackets, which reads as a machine talking to itself.
   */
  return ` Verdicts: ${[...by.entries()]
    .map(([v, n]) => {
      const word = v.toLowerCase();
      const meaning = verdictPlain(v);
      return meaning === word ? `${n} ${word}` : `${n} ${word} (${meaning})`;
    })
    .join("; ")}.`;
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
