/**
 * **ONE DOOR. EVERY BUTTON, EVERY CHAT TOOL, EVERY DELEGATED JOB.**
 * (Admin Pass C, ADM-C6; §3.5, §3.6, §3.7.)
 *
 * §3.5 forbids the shape this file exists to prevent: *"Do not create one
 * action path for buttons, another privileged action path for chat."* Two
 * paths do not diverge on the day they are written; they diverge on the day
 * someone adds a staleness check to one of them. So `submit` is the only
 * function that carries out an action, the console's form POST calls it, the
 * operator chat's tool calls it, and there is no second entry point to add a
 * check to.
 *
 * ## The order, and why each step is where it is
 *
 * ```
 *   1  ENVELOPE     is this even an action? a type and an idempotency key we
 *                   can safely use as a durable record id, or nothing is written
 *   2  UNKNOWN      not in the registry -> refuse. Fails closed (§3.6)
 *   3  AUTHORITY    this caller may not invoke this class -> refuse
 *   4  PROHIBITED   this class is never allowed -> refuse
 *   5  INPUT        the action's own schema -> refuse
 *   6  STALE        the world moved since the control was drawn -> refuse
 *   7  IDEMPOTENCY  this exact action already ran -> return its receipt, and
 *                   do not do the work a second time
 *   8  EXECUTE      the delegated path does the one thing it does
 *   9  RECEIPT      append the proof, refusal included
 * ```
 *
 * Two orderings are load-bearing and neither is obvious:
 *
 * **PROHIBITED is checked after authority, but only for classes that are not
 * prohibited.** `authorityPermits` returns false for `PROHIBITED` no matter who
 * is asking, so checking authority first without that scoping would answer
 * *"whoever asked for this is not allowed to do it"* for an action nobody is
 * ever allowed to do — and the owner would reasonably conclude that somebody
 * else could. The truer sentence is *"this is never allowed from here, by
 * design"*, and it is the one that survives being read at 3 a.m.
 *
 * **IDEMPOTENCY is checked after validation and staleness, not before.** A
 * replay must return what the first submission decided, and a stale or invalid
 * submission that got a receipt has already decided. Checking earlier would be
 * a cheaper query and would answer a different question: it would return a
 * refusal receipt for a request that is now perfectly valid.
 *
 * ## A refusal is a first-class outcome
 *
 * Every branch above produces an `ActionOutcome` with a real `ActionReceipt`,
 * and every one of those receipts is appended. A refusal that leaves no record
 * is indistinguishable from a click that never arrived, and *"I pressed it and
 * nothing happened"* is exactly the report this makes answerable.
 *
 * ## What it refuses to guess
 *
 * If the receipt log cannot be READ, the gateway does not execute. It cannot
 * tell a first submission from a replay, and doing the work anyway is how a
 * retried request becomes two state changes. It says so and stops.
 *
 * SERVER-SIDE. Nothing here reads the environment or opens a connection: the
 * repositories, the clock, the current state version and the code SHA all
 * arrive as dependencies, which is what lets every acceptance point be proven
 * against the in-memory store.
 */

import {
  authorityPermits,
  isStale,
  receiptIdFor,
  refusalSays,
  type ActionOutcome,
  type ActionReceipt,
  type ActionRequest,
  type AuthorityClass,
  type RefusalCode,
} from "./contract.ts";
import { lookupAction, type ActionContext, type GatewayDeps, type RegisteredAction } from "./registry.ts";
import { appendReceipt, buildReceipt, findReceipt } from "./receipts.ts";
import { sendWakeHint, wakeHintOf } from "./wake-hint.ts";
import { bindScoreAssignments, scoresAtAcceptance } from "./hunt-score.ts";
import { withWriteReadback } from "./write-readback.ts";

/**
 * What a well-formed action envelope looks like.
 *
 * The record id of the durable receipt is `<type>:<idempotencyKey>`, so both
 * halves are bounded and character-restricted here rather than trusted. This is
 * not input hygiene for its own sake: an unbounded, unconstrained record id is
 * a row in an append-only log that nobody can ever address again.
 */
const ACTION_TYPE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export const ACTION_TYPE_MAX_CHARS = 64;
export const SUBJECT_MAX_CHARS = 512;

/**
 * The definition a receipt for an unknown action carries.
 *
 * An unknown action has no entry, so it has no label and no authority — and it
 * still has to produce a readable receipt, because the fact that somebody
 * submitted it is exactly what an audit wants to see. `PROHIBITED` is the
 * honest class for it: nothing may run it.
 */
const UNKNOWN_ACTION_LABEL = "An action the console does not have";
const UNKNOWN_ACTION_AUTHORITY: AuthorityClass = "PROHIBITED";
const UNKNOWN_ACTION_SUBJECT_KIND = "something the console was asked to do";

function outcomeOf(receipt: ActionReceipt, replayed: boolean): ActionOutcome {
  return { ok: receipt.outcome !== "REFUSED", receipt, replayed };
}

/**
 * Submit an action. The only way anything happens.
 *
 * Returns an `ActionOutcome` for every input, including a refusal and including
 * an unknown type. It throws only if the caller handed it something that is not
 * an object at all, which is a programming error rather than a refusal.
 */
export async function submit(request: ActionRequest, deps: GatewayDeps): Promise<ActionOutcome> {
  const startedAt = deps.now();
  const type = typeof request.type === "string" ? request.type.trim() : "";
  const idempotencyKey = typeof request.idempotencyKey === "string" ? request.idempotencyKey.trim() : "";
  const subject = typeof request.subject === "string" ? request.subject.trim().slice(0, SUBJECT_MAX_CHARS) : "";
  // `input` is defaulted here rather than at each use: `buildReceipt` digests
  // it, and a digest of `undefined` would throw inside the one function whose
  // job is to record what happened.
  const input: Readonly<Record<string, unknown>> =
    request.input !== null && typeof request.input === "object" ? request.input : {};
  const normalised: ActionRequest = { ...request, type, idempotencyKey, subject, input };

  /* 1 · ENVELOPE. The one branch that writes nothing, and it says why. */
  if (!ACTION_TYPE.test(type) || type.length > ACTION_TYPE_MAX_CHARS || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    /*
     * The receipt id is derived from these two fields. A malformed pair cannot
     * produce one we would be willing to write into an append-only log and
     * would never be able to address again, so this refusal is returned and NOT
     * appended — the one deliberate exception to "every refusal leaves a
     * record", and it is stated in the sentence the caller gets back.
     */
    const receipt = buildReceipt({
      request: normalised,
      label: UNKNOWN_ACTION_LABEL,
      authority: UNKNOWN_ACTION_AUTHORITY,
      subjectKind: UNKNOWN_ACTION_SUBJECT_KIND,
      subject,
      startedAt,
      completedAt: startedAt,
      outcome: "REFUSED",
      says:
        "That request was not shaped like an action at all, so nothing was done and nothing was recorded — " +
        "there was no safe way to write a record we could find again.",
      refusal: "INVALID_INPUT",
      openedWork: [],
      readBackAt: null,
      undo: null,
      codeSha: deps.codeSha,
    });
    return outcomeOf(receipt, false);
  }

  const receiptId = receiptIdFor(type, idempotencyKey);
  const entry = lookupAction(type);

  /** Tell the runner its controls changed. A notification only: it can fail without touching the action's result. */
  const wake = async (receipt: ActionReceipt): Promise<void> => {
    await sendWakeHint(deps.wake, wakeHintOf(receipt, deps.now()));
  };

  /** Build, append and return one refusal. Every refusal in this function goes through here. */
  const refuseWith = async (
    code: RefusalCode,
    action: RegisteredAction | null,
    says: string | null = null,
  ): Promise<ActionOutcome> => {
    const label = action?.definition.label ?? UNKNOWN_ACTION_LABEL;
    const receipt = buildReceipt({
      request: normalised,
      label,
      authority: action?.definition.authority ?? UNKNOWN_ACTION_AUTHORITY,
      subjectKind: action?.definition.subjectKind ?? UNKNOWN_ACTION_SUBJECT_KIND,
      subject,
      startedAt,
      completedAt: deps.now(),
      outcome: "REFUSED",
      says: says ?? refusalSays(code, label),
      refusal: code,
      openedWork: [],
      readBackAt: null,
      undo: null,
      codeSha: deps.codeSha,
    });
    const wrote = await appendReceipt(deps.repos, receipt, receipt.completedAt ?? startedAt);
    return outcomeOf(wrote.ok ? receipt : { ...receipt, says: `${receipt.says} (${wrote.detail}.)` }, false);
  };

  /* 2 · UNKNOWN. Fails closed: not in the registry means not runnable. */
  if (entry === null) return refuseWith("UNKNOWN_ACTION", null);

  /* 3 · AUTHORITY, scoped away from PROHIBITED so step 4 is reachable. */
  const authority = entry.definition.authority;
  if (authority !== "PROHIBITED" && !authorityPermits(normalised.caller, authority)) {
    return refuseWith("AUTHORITY_MISMATCH", entry);
  }

  /* 4 · PROHIBITED. Always, for everyone, with the reason. */
  if (authority === "PROHIBITED") return refuseWith("PROHIBITED_ACTION", entry);

  /* 5 · INPUT, by the action's own pure validator. */
  const validated = entry.validate(input);
  if (!validated.ok) {
    return refuseWith("INVALID_INPUT", entry, `${entry.definition.label} was not done — ${validated.why}.`);
  }

  /* 6 · STALE. Two different failures, told apart. */
  if (
    entry.definition.requiresStateVersion &&
    normalised.stateVersion === null &&
    deps.currentStateVersion !== null
  ) {
    return refuseWith(
      "INVALID_INPUT",
      entry,
      `${entry.definition.label} was not done. The control did not say which version of the page it was drawn from, ` +
        "and this is one where that matters — so it refused rather than act on a page that may have moved.",
    );
  }
  if (isStale(normalised.stateVersion, deps.currentStateVersion)) {
    return refuseWith("STALE_STATE", entry);
  }

  /* 7 · IDEMPOTENCY. Read before doing, and refuse to guess if we cannot read. */
  let existing: ActionReceipt | null = null;
  try {
    existing = await findReceipt(deps.repos, receiptId);
  } catch (error) {
    return refuseWith(
      "DOWNSTREAM_REFUSED",
      entry,
      `${entry.definition.label} was not done. The record of what this console has already done could not be read ` +
        `(${(error as Error)?.name ?? "error"}), so there was no way to tell whether this had already happened. ` +
        "Doing it anyway could have done it twice.",
    );
  }
  if (existing !== null) {
    // A replay of an applied action tells the runner again: this is how a missed hint is made up.
    if (existing.outcome !== "REFUSED") await wake(existing);
    return outcomeOf(existing, true);
  }

  /* 8 · EXECUTE. */
  const context: ActionContext = { request: normalised, receiptId, at: deps.now() };
  const huntScores = await scoresAtAcceptance(type, validated.value, deps.readPlaceScore);
  let result;
  try {
    // Every store write the action makes is read back if it times out, so a timeout never becomes "nothing was recorded" when it may have landed.
    result = await entry.execute({ ...deps, repos: withWriteReadback(deps.repos) }, context, validated.value);
  } catch (error) {
    return refuseWith(
      "DOWNSTREAM_REFUSED",
      entry,
      `${entry.definition.label} did not finish (${(error as Error)?.name ?? "error"}). ` +
        "Whatever it had not done is not done; the record below is what is known.",
    );
  }
  if (!result.ok) return refuseWith(result.refusal, entry, result.says);

  /* 9 · RECEIPT. */
  const receipt = buildReceipt({
    request: normalised,
    label: entry.definition.label,
    authority,
    subjectKind: entry.definition.subjectKind,
    subject: result.subject ?? subject,
    startedAt,
    completedAt: deps.now(),
    outcome: result.outcome,
    says: result.says,
    refusal: null,
    openedWork: result.openedWork ?? [],
    readBackAt: result.readBackAt ?? null,
    undo: result.undo ?? null,
    ...(result.change ? { change: result.change } : {}),
    ...(huntScores ? { huntScores: await bindScoreAssignments(deps.repos,huntScores,receiptId) } : {}),
    codeSha: deps.codeSha,
  });
  const wrote = await appendReceipt(deps.repos, receipt, receipt.completedAt ?? startedAt);
  if (wrote.ok) {
    await wake(receipt);
    return outcomeOf(receipt, false);
  }

  /*
   * THE WORK HAPPENED AND THE PROOF DID NOT.
   *
   * Two ways to get here and they are not the same.
   *
   * A CONCURRENT TWIN: two identical submissions raced past step 7 together,
   * both executed, and the second one's append collided with the first one's
   * record under the same id. The store refused it, which is the store doing
   * its job. The right answer is the receipt that DID land, returned as the
   * replay it is.
   *
   * A REAL FAILURE: the store could not be written. The action happened and the
   * owner is told exactly that, rather than being shown a success that has no
   * record behind it or a failure that undoes nothing.
   */
  const landed = await findReceipt(deps.repos, receiptId).catch(() => null);
  if (landed !== null) {
    if (landed.outcome !== "REFUSED") await wake(landed);
    return outcomeOf(landed, true);
  }
  return outcomeOf(
    {
      ...receipt,
      says: `${receipt.says} One thing did not work: ${wrote.detail}, so this console has no durable record of it.`,
    },
    false,
  );
}
