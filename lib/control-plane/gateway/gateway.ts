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
import { withWriteReadback } from "./write-readback.ts";

/** The receipt id is `<type>:<idempotencyKey>`, so both halves are bounded here. */
const ACTION_TYPE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export const ACTION_TYPE_MAX_CHARS = 64;
export const SUBJECT_MAX_CHARS = 512;

const UNKNOWN_ACTION_LABEL = "An action the console does not have";
const UNKNOWN_ACTION_AUTHORITY: AuthorityClass = "PROHIBITED";
const UNKNOWN_ACTION_SUBJECT_KIND = "something the console was asked to do";

function outcomeOf(receipt: ActionReceipt, replayed: boolean): ActionOutcome {
  return { ok: receipt.outcome !== "REFUSED", receipt, replayed };
}

/** The only way an action runs. Returns an outcome for every input; throws only on a non-object. */
export async function submit(request: ActionRequest, deps: GatewayDeps): Promise<ActionOutcome> {
  const startedAt = deps.now();
  const type = typeof request.type === "string" ? request.type.trim() : "";
  const idempotencyKey = typeof request.idempotencyKey === "string" ? request.idempotencyKey.trim() : "";
  const subject = typeof request.subject === "string" ? request.subject.trim().slice(0, SUBJECT_MAX_CHARS) : "";
  // Defaulted here: `buildReceipt` digests it, and a digest of `undefined` throws.
  const input: Readonly<Record<string, unknown>> =
    request.input !== null && typeof request.input === "object" ? request.input : {};
  const normalised: ActionRequest = { ...request, type, idempotencyKey, subject, input };

  if (!ACTION_TYPE.test(type) || type.length > ACTION_TYPE_MAX_CHARS || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    /* A malformed pair cannot form a receipt id, so this refusal is returned and not appended. */
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

  if (entry === null) return refuseWith("UNKNOWN_ACTION", null);

  /* Authority is checked for everything but PROHIBITED, so the PROHIBITED refusal stays reachable. */
  const authority = entry.definition.authority;
  if (authority !== "PROHIBITED" && !authorityPermits(normalised.caller, authority)) {
    return refuseWith("AUTHORITY_MISMATCH", entry);
  }

  if (authority === "PROHIBITED") return refuseWith("PROHIBITED_ACTION", entry);

  const validated = entry.validate(input);
  if (!validated.ok) {
    return refuseWith("INVALID_INPUT", entry, `${entry.definition.label} was not done — ${validated.why}.`);
  }

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

  /* Idempotency: refuse rather than guess when the receipt log cannot be read. */
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

  const context: ActionContext = { request: normalised, receiptId, at: deps.now() };
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
    codeSha: deps.codeSha,
  });
  const wrote = await appendReceipt(deps.repos, receipt, receipt.completedAt ?? startedAt);
  if (wrote.ok) {
    await wake(receipt);
    return outcomeOf(receipt, false);
  }

  /*
   * The work happened but the receipt append failed. If a concurrent identical
   * submission's receipt landed under the same id, return that one as a replay.
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
