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

export const CALLER_AUTHORITIES = ["OWNER_SESSION", "OPERATOR_CHAT", "AGENT", "ANONYMOUS"] as const;
export type CallerAuthority = (typeof CALLER_AUTHORITIES)[number];

/** An AGENT caller may only read and propose. */
export const ALLOWED_BY_CALLER: Readonly<Record<CallerAuthority, readonly AuthorityClass[]>> = {
  OWNER_SESSION: ["READ_ONLY", "PROPOSE_ONLY", "REVERSIBLE_NONPRODUCTION", "CODE_CHANGE", "GOVERNED_INTEGRATION", "OWNER_DECISION_REQUIRED"],
  OPERATOR_CHAT: ["READ_ONLY", "PROPOSE_ONLY", "REVERSIBLE_NONPRODUCTION", "CODE_CHANGE", "GOVERNED_INTEGRATION"],
  AGENT: ["READ_ONLY", "PROPOSE_ONLY"],
  ANONYMOUS: [],
};

export function authorityPermits(caller: CallerAuthority, required: AuthorityClass): boolean {
  if (required === "PROHIBITED") return false;
  return ALLOWED_BY_CALLER[caller]?.includes(required) ?? false;
}

export const REFUSAL_CODES = [
  "UNKNOWN_ACTION",
  "AUTHORITY_MISMATCH",
  /** Always refused, by law. */
  "PROHIBITED_ACTION",
  "STALE_STATE",
  /** This exact action already ran. The existing receipt is returned. */
  "ALREADY_DONE",
  "INVALID_INPUT",
  "OWNER_DECISION_MISSING",
  "NOT_SUPPORTED_YET",
  "DOWNSTREAM_REFUSED",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

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

export interface ActionDefinition {
  readonly type: string;
  readonly label: string;
  readonly does: string;
  readonly doesNot: string;
  readonly authority: AuthorityClass;
  readonly subjectKind: string;
  readonly requiresStateVersion: boolean;
  readonly refusals: readonly RefusalCode[];
}

export interface ActionRequest {
  readonly type: string;
  readonly subject: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The revision/SHA/heartbeat the control was rendered against; a mismatch is `STALE_STATE`. */
  readonly stateVersion: string | null;
  /** Same key, same receipt: a double-click, a retried fetch and a replayed tool call are one action. */
  readonly idempotencyKey: string;
  readonly caller: CallerAuthority;
  /** The admin session reference, for the audit record. Never a person's name. */
  readonly actorRef: string;
}

export type ReceiptOutcome = "DONE" | "REFUSED" | "QUEUED" | "IN_PROGRESS";

export interface ActionReceipt {
  readonly formatVersion: 1;
  readonly receiptId: string;
  readonly idempotencyKey: string;
  readonly type: string;
  readonly label: string;
  readonly authority: AuthorityClass;
  readonly subjectKind: string;
  readonly subject: string;
  readonly inputDigest: string;
  /** Original target, retained when the action's subject becomes a derived intent id. */
  readonly requestedSubject?: string;
  readonly caller: CallerAuthority;
  readonly actorRef: string;
  readonly stateVersion: string | null;
  readonly codeSha: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly outcome: ReceiptOutcome;
  readonly says: string;
  readonly refusal: RefusalCode | null;
  readonly openedWork: readonly { readonly kind: string; readonly id: string; readonly title: string }[];
  readonly readBackAt: string | null;
  readonly undo: string | null;
  readonly change?: { readonly before: string; readonly after: string };
}

export interface ActionOutcome {
  readonly ok: boolean;
  readonly receipt: ActionReceipt;
  /** True when this returned an existing receipt rather than doing the work again. */
  readonly replayed: boolean;
}

/** `null` on either side means the action does not depend on a moving world. */
export function isStale(quoted: string | null, current: string | null): boolean {
  if (quoted === null || current === null) return false;
  return quoted !== current;
}

/** The receipt id an action gets: derived, so a replay finds the same row. */
export function receiptIdFor(type: string, idempotencyKey: string): string {
  return `${type}:${idempotencyKey}`;
}

export function refusalSays(code: RefusalCode, label: string): string {
  return `${label} was not done. ${REFUSAL_WORDS[code]}`;
}

export const ADMIN_RECEIPT_LOG_KEY = "admin-action";
