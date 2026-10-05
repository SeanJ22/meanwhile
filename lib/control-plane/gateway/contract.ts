/**
 * **THE ACTION GATEWAY'S CONTRACT — one typed shape, both sides validate.**
 * (ADM-C6; RULING 273's interface law.)
 *
 * Every state-changing thing the owner can do from the console — a button, a
 * chat instruction, a delegated agent job — is an ACTION, and every action goes
 * through this one door. §3.5 of the brief is explicit that there may not be one
 * path for buttons and a second privileged path for chat: they share the schema,
 * the authorization, the validation, the stale-state handling, the idempotency,
 * the receipt and the refusal behaviour, or they are two systems pretending to
 * be one.
 *
 * This module is the CONTRACT only: types, the authority ladder, the refusal
 * vocabulary, and the pure predicates both the caller and the executor check.
 * The registry of real actions and the executor live beside it. Keeping the
 * contract separate is what lets the UI, the chat tools and the tests all
 * import the same definitions without importing a database client.
 *
 * PURE. No store, no clock, no environment.
 */

/* ------------------------------------------------------------- authority */

/**
 * What an action is allowed to touch. Exactly one class per action, and an
 * action whose class cannot be resolved fails closed (§3.6).
 */
export const AUTHORITY_CLASSES = [
  /** Reads. Changes nothing, anywhere. */
  "READ_ONLY",
  /** Writes a proposal for the owner. Never carries it out. */
  "PROPOSE_ONLY",
  /** Changes non-production state that can be put back. */
  "REVERSIBLE_NONPRODUCTION",
  /** Writes code on a branch. Never reaches production by itself. */
  "CODE_CHANGE",
  /** Ships through the canonical Steward, the gates and the deploy proof. */
  "GOVERNED_INTEGRATION",
  /** No machine may decide this; only a recorded owner decision moves it. */
  "OWNER_DECISION_REQUIRED",
  /** Refused outright, always, with the reason. */
  "PROHIBITED",
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

/** How much authority the caller itself carries. */
export const CALLER_AUTHORITIES = ["OWNER_SESSION", "OPERATOR_CHAT", "AGENT", "ANONYMOUS"] as const;
export type CallerAuthority = (typeof CALLER_AUTHORITIES)[number];

/**
 * The authority ladder: what a caller of each kind may invoke.
 *
 * The operator chat is the owner's own session speaking, so it carries the same
 * authority as a button — that is the point of one gateway (§3.5). An AGENT
 * caller (a delegated Codex or Claude Code job calling back in) may read and
 * propose and nothing else: an agent that could ship would be a remote shell
 * with a nicer name (§4).
 */
export const ALLOWED_BY_CALLER: Readonly<Record<CallerAuthority, readonly AuthorityClass[]>> = {
  OWNER_SESSION: ["READ_ONLY", "PROPOSE_ONLY", "REVERSIBLE_NONPRODUCTION", "CODE_CHANGE", "GOVERNED_INTEGRATION", "OWNER_DECISION_REQUIRED"],
  OPERATOR_CHAT: ["READ_ONLY", "PROPOSE_ONLY", "REVERSIBLE_NONPRODUCTION", "CODE_CHANGE", "GOVERNED_INTEGRATION"],
  AGENT: ["READ_ONLY", "PROPOSE_ONLY"],
  ANONYMOUS: [],
};

/** Does this caller carry enough authority for this class? */
export function authorityPermits(caller: CallerAuthority, required: AuthorityClass): boolean {
  if (required === "PROHIBITED") return false;
  return ALLOWED_BY_CALLER[caller]?.includes(required) ?? false;
}

/* -------------------------------------------------------------- refusals */

/**
 * Why the gateway said no. Every one of these is a REFUSAL, which is a
 * first-class outcome with a receipt — never an error page and never a silent
 * no-op.
 */
export const REFUSAL_CODES = [
  /** The action type is not in the registry. Fails closed (§3.6). */
  "UNKNOWN_ACTION",
  /** The caller may not invoke this authority class. */
  "AUTHORITY_MISMATCH",
  /** Always refused, by law. */
  "PROHIBITED_ACTION",
  /** The state the action was rendered against has moved. */
  "STALE_STATE",
  /** This exact action already ran. The existing receipt is returned. */
  "ALREADY_DONE",
  /** The input did not match the action's schema. */
  "INVALID_INPUT",
  /** Only a recorded owner decision moves this, and there is none. */
  "OWNER_DECISION_MISSING",
  /** The canonical system that would carry it out does not support it yet. */
  "NOT_SUPPORTED_YET",
  /** The canonical system was asked and refused or could not be reached. */
  "DOWNSTREAM_REFUSED",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** What each refusal means to the owner, in his words. */
export const REFUSAL_WORDS: Readonly<Record<RefusalCode, string>> = {
  UNKNOWN_ACTION: "The console does not know this action, so it refused rather than guess.",
  AUTHORITY_MISMATCH: "Whoever asked for this is not allowed to do it.",
  PROHIBITED_ACTION: "This is never allowed from here, by design.",
  STALE_STATE: "The page you clicked from is out of date — the system moved since it was drawn. Refresh and look again.",
  ALREADY_DONE: "This already happened. Nothing was done twice; here is the original receipt.",
  INVALID_INPUT: "Something in the request did not make sense, so nothing was done.",
  OWNER_DECISION_MISSING: "This needs a decision from you before anything can carry it out.",
  NOT_SUPPORTED_YET: "Nothing in the system can carry this out yet, so the console refused instead of pretending.",
  DOWNSTREAM_REFUSED: "The system that would do this refused or could not be reached.",
};

/* --------------------------------------------------------------- actions */

/**
 * One action's definition. The registry is a map of these; nothing outside the
 * registry can be invoked.
 */
export interface ActionDefinition {
  /** Stable machine id, e.g. `runner.pause`. Never shown to the owner. */
  readonly type: string;
  /** What the owner sees on the control. */
  readonly label: string;
  /** One plain sentence: what this does. */
  readonly does: string;
  /** One plain sentence: what this explicitly does NOT do. */
  readonly doesNot: string;
  readonly authority: AuthorityClass;
  /** What kind of thing the `subject` names, for the receipt. */
  readonly subjectKind: string;
  /**
   * Does the action need the caller to quote the state it was rendered against?
   * A control whose meaning depends on a moving world does; a plain "add this
   * to the queue" does not.
   */
  readonly requiresStateVersion: boolean;
  /** The refusals this action can legitimately produce, for the UI to explain up front. */
  readonly refusals: readonly RefusalCode[];
}

/** A submitted action, before the gateway has looked at it. */
export interface ScheduleOrigin { readonly id: string; readonly occurrence: string; readonly finishBy: string | null }

export interface ActionRequest {
  /** Added by the scheduler; HTTP callers do not supply it. */
  readonly scheduleOrigin?: ScheduleOrigin;
  readonly type: string;
  /** What it acts on: a row id, a work item id, a jurisdiction, a SHA. */
  readonly subject: string;
  /** The action's own typed input. Validated by the registry entry. */
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * The revision/SHA/heartbeat the control was rendered against. Compared to
   * the current one; a mismatch is `STALE_STATE` unless the action says it is
   * safe regardless.
   */
  readonly stateVersion: string | null;
  /**
   * Supplied by the caller so a double-click, a retried fetch and a replayed
   * chat tool call are ONE action. Two submissions with the same key return
   * the same receipt.
   */
  readonly idempotencyKey: string;
  readonly caller: CallerAuthority;
  /** The admin session reference, for the audit record. Never a person's name. */
  readonly actorRef: string;
}

/* -------------------------------------------------------------- receipts */

export type ReceiptOutcome = "DONE" | "REFUSED" | "QUEUED" | "IN_PROGRESS";

/**
 * The durable, append-only record of what the console did. §3.7: a toast is not
 * proof. Everything needed to answer "what happened, when, to what, by whom,
 * and what came of it" lives on this record.
 */
export interface ActionReceipt {
  readonly scheduleOrigin?: ScheduleOrigin;
  readonly formatVersion: 1;
  readonly receiptId: string;
  readonly idempotencyKey: string;
  readonly type: string;
  readonly label: string;
  readonly authority: AuthorityClass;
  readonly subjectKind: string;
  readonly subject: string;
  /** A stable digest of the input, so the record is auditable without storing free text. */
  readonly inputDigest: string;
  /** Original target, retained when the action's subject becomes a derived intent id. */
  readonly requestedSubject?: string;
  readonly caller: CallerAuthority;
  readonly actorRef: string;
  /** The revision/SHA the action was rendered against, when it quoted one. */
  readonly stateVersion: string | null;
  /** The code identity of the deploy that ran it, when known. */
  readonly codeSha: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly outcome: ReceiptOutcome;
  /** One plain sentence the owner reads. Never a code. */
  readonly says: string;
  readonly refusal: RefusalCode | null;
  /** Ids of work this action opened downstream: work items, jobs, tracker rows. */
  readonly openedWork: readonly { readonly kind: string; readonly id: string; readonly title: string }[];
  /** Where the resulting state can be read back, as a console path. */
  readonly readBackAt: string | null;
  /** What would undo this, when anything would. */
  readonly undo: string | null;
  /** BR-13: the value before and after, when the action changed one. */
  readonly change?: { readonly before: string; readonly after: string };
  readonly huntScores?: readonly import("./hunt-score.ts").HuntAcceptanceScore[];
}

/** The gateway's answer. One shape for success and refusal alike. */
export interface ActionOutcome {
  readonly ok: boolean;
  readonly receipt: ActionReceipt;
  /** True when this returned an existing receipt rather than doing the work again. */
  readonly replayed: boolean;
}

/* ------------------------------------------------------------ predicates */

/**
 * Is the quoted state version still current?
 *
 * `null` on either side means the action does not depend on a moving world.
 * Only a quoted version that disagrees with the current one is stale — an
 * action that quotes nothing against a world that has one is INVALID, not
 * stale, and the registry entry decides which by `requiresStateVersion`.
 */
export function isStale(quoted: string | null, current: string | null): boolean {
  if (quoted === null || current === null) return false;
  return quoted !== current;
}

/** The receipt id an action gets: derived, so a replay finds the same row. */
export function receiptIdFor(type: string, idempotencyKey: string): string {
  return `${type}:${idempotencyKey}`;
}

/** The plain sentence a refusal renders as, with the action named. */
export function refusalSays(code: RefusalCode, label: string): string {
  return `${label} was not done. ${REFUSAL_WORDS[code]}`;
}

/** The one log key every admin receipt is appended under. */
export const ADMIN_RECEIPT_LOG_KEY = "admin-action";
