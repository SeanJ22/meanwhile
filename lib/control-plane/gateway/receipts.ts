/**
 * **BUILDING AND READING THE PROOF.** (Admin Pass C, ADM-C6 / §3.7.)
 *
 * *"Do not use toast messages as the only proof."*
 *
 * A receipt is not a log line. It is the durable answer to a question the owner
 * asks days later — *what did I do, what happened, and where can I see it?* —
 * and it is also the mechanism that stops the same click happening twice. Both
 * jobs come out of one property: the record id is DERIVED from the action type
 * and the caller's idempotency key, so the store's own append idempotency does
 * the deduplication and there is nothing to keep in sync.
 *
 * ## Why the input is a DIGEST and not the input
 *
 * `inputDigest` is a content address of the canonical JSON of what was
 * submitted. That is enough to prove two submissions carried the same input,
 * and to prove a stored receipt corresponds to a replayed request, without
 * putting the owner's typed words into a second store. It also keeps the record
 * clear of `assertAggregateOnly`'s refused field names by construction: a digest
 * has no field names at all.
 *
 * ## Why every submission gets a receipt, including a refusal and a read
 *
 * §3.7 requires one for every state-changing action. This module writes one for
 * every action, full stop, and the two extra cases each earn their row:
 *
 * ```
 *   a REFUSAL   a refusal that leaves no record is indistinguishable from a
 *               click that never arrived. "I pressed it and nothing happened"
 *               is the report this makes answerable
 *   a READ      an owner-initiated readback is a question that was asked and
 *               answered at an instant, and the answer moves. The receipt is
 *               what makes "it said this at 4:02" a fact rather than a memory
 * ```
 *
 * These are owner-clicked actions, not a poll: the volume is human-scale, and
 * the live pulse (`lib/control-plane/live-pulse.ts`) deliberately does not go
 * through here.
 *
 * SERVER-SIDE. `node:crypto` via `contentHash`, and repository calls. Never
 * imported by middleware, which runs on the Edge runtime.
 */

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

/**
 * A stable digest of an action's input.
 *
 * Canonical JSON first, so two objects that differ only in key order are one
 * input — otherwise a form POST and a JSON fetch carrying the same fields would
 * produce different digests and the audit would suggest a difference that is not
 * there. Then the repository's own content address, so a digest here and a
 * digest anywhere else in the control plane mean the same thing.
 */
export function inputDigest(input: Readonly<Record<string, unknown>>): string {
  return contentHash(canonicalJson(input));
}

/** Everything the gateway knows about an action once it has decided what happened. */
export interface ReceiptDraft {
  readonly request: ActionRequest;
  readonly label: string;
  readonly authority: AuthorityClass;
  readonly subjectKind: string;
  /**
   * What was actually acted on.
   *
   * Usually the request's own subject. It differs when the canonical identity
   * is DERIVED — a queued gap's subject id is a fingerprint of the words on the
   * screen, which the button cannot know. Recording the derived identity is
   * what lets the receipt be lined up against the row it created; the request
   * exactly as submitted is still provable through `inputDigest`.
   */
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

/** The record, assembled. Pure: no clock, no store — both instants are given. */
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

/**
 * Every receipt the console has written, oldest first.
 *
 * One read of one log key. `readAll()` is deliberately not used: it walks every
 * key in the log, and this log has exactly one — a caller that got into the
 * habit of `readAll` here would be doing a full-table scan to answer a question
 * about one partition.
 */
export async function readReceipts(
  repos: ControlPlaneRepositories,
): Promise<readonly ActionReceipt[]> {
  return repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
}

/**
 * The receipt for one action, or null when there is none.
 *
 * The whole partition is read and scanned rather than queried by id, because
 * `AppendOnlyRepository` has no get-by-id and inventing one for this caller
 * would mean a fourth method on an interface three providers implement. The
 * partition is one key of owner-initiated actions; if it ever grows past what
 * one read should carry, the fix is a narrower log key, not a wider interface.
 */
export async function findReceipt(
  repos: ControlPlaneRepositories,
  receiptId: string,
): Promise<ActionReceipt | null> {
  const rows = await readReceipts(repos);
  for (const row of rows) if (row.receiptId === receiptId) return row;
  return null;
}

/**
 * Append the proof.
 *
 * `assertAggregateOnly` runs first for the same reason both existing admin
 * append helpers run it: the cheapest place to catch an aggregate-only
 * violation is before it is durable, and the owner reading his own console is a
 * rendering like any other (RULING 226).
 *
 * The refusal is NAMED rather than thrown, because the caller has already done
 * the work by the time it gets here and needs to say so plainly. A thrown
 * append would turn "it happened but the receipt did not land" into "it
 * failed", which is a different and more comforting sentence than the truth.
 */
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
    // The name, never the message: a driver error's message can carry the
    // connection string, and this sentence reaches the owner's screen.
    return { ok: false, detail: `the receipt could not be written (${(error as Error)?.name ?? "error"})` };
  }
}
