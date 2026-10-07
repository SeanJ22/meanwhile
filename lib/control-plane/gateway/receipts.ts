import { contentHash } from "../ids.ts";
import { assertAggregateOnly } from "../owner-surface.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import {
  ADMIN_RECEIPT_LOG_KEY,
  receiptIdFor,
  type ActionReceipt,
  type ActionRequest,
  type AuthorityClass,
  type ReceiptOutcome,
  type RefusalCode,
} from "./contract.ts";

export const RECEIPT_FORMAT_VERSION = 1;

export function inputDigest(input: Readonly<Record<string, unknown>>): string {
  return contentHash(canonicalJson(input));
}

export interface ReceiptDraft {
  readonly request: ActionRequest;
  readonly label: string;
  readonly authority: AuthorityClass;
  readonly subjectKind: string;
  /** Differs from the request's subject when the canonical identity is derived (e.g. a fingerprint of on-screen words). */
  readonly subject: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: ReceiptOutcome;
  readonly says: string;
  readonly refusal: RefusalCode | null;
  readonly openedWork: readonly { readonly kind: string; readonly id: string; readonly title: string }[];
  readonly readBackAt: string | null;
  readonly undo: string | null;
  readonly change?: { readonly before: string; readonly after: string };
  readonly codeSha: string | null;
}

export function buildReceipt(draft: ReceiptDraft): ActionReceipt {
  const { request } = draft;
  return {
    formatVersion: RECEIPT_FORMAT_VERSION,
    receiptId: receiptIdFor(request.type, request.idempotencyKey),
    idempotencyKey: request.idempotencyKey,
    type: request.type,
    label: draft.label,
    authority: draft.authority,
    subjectKind: draft.subjectKind,
    subject: draft.subject,
    requestedSubject: request.subject,
    inputDigest: inputDigest(request.input),
    caller: request.caller,
    actorRef: request.actorRef,
    stateVersion: request.stateVersion,
    codeSha: draft.codeSha,
    startedAt: draft.startedAt,
    completedAt: draft.completedAt,
    outcome: draft.outcome,
    says: draft.says,
    refusal: draft.refusal,
    openedWork: draft.openedWork,
    readBackAt: draft.readBackAt,
    undo: draft.undo,
    ...(draft.change ? { change: draft.change } : {}),
  };
}

export async function readReceipts(
  repos: ControlPlaneRepositories,
): Promise<readonly ActionReceipt[]> {
  return repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
}

export async function findReceipt(
  repos: ControlPlaneRepositories,
  receiptId: string,
): Promise<ActionReceipt | null> {
  const rows = await readReceipts(repos);
  for (const row of rows) if (row.receiptId === receiptId) return row;
  return null;
}

/** A failed append is returned as a named refusal, not thrown: the action has already happened. */
export async function appendReceipt(
  repos: ControlPlaneRepositories,
  receipt: ActionReceipt,
  nowIso: string,
): Promise<{ readonly ok: true; readonly appended: boolean } | { readonly ok: false; readonly detail: string }> {
  try {
    assertAggregateOnly(receipt, "appendReceipt");
    const outcome = await repos.adminReceipts.append(
      ADMIN_RECEIPT_LOG_KEY,
      receipt.receiptId,
      receipt,
      nowIso,
    );
    return { ok: true, appended: outcome.appended };
  } catch (error) {
    // The error name, never its message: a driver message can carry the connection string.
    return { ok: false, detail: `the receipt could not be written (${(error as Error)?.name ?? "error"})` };
  }
}
