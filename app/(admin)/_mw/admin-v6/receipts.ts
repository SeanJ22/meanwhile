/**
 * **WHAT HAPPENED TO EACH INSTRUCTION, WITHOUT OVERCLAIMING.**
 *
 * A receipt walks Queued → Read by the workers → Running, then ends in exactly
 * one of Done, Partly done, Refused, Failed or Result unknown. The gateway's
 * saved receipt — not an HTTP 200 and not a click — decides the state.
 *
 * Mapping the deployed gateway (`ActionOutcome` in lib/control-plane/gateway/contract.ts):
 *
 *   DONE                  final, worded by the action's own `doneWords` (a saved
 *                         pause is "Pause saved", never "workers paused")
 *   QUEUED / IN_PROGRESS  still pending
 *   REFUSED (ok:false)    Refused, with the gateway's plain reason
 *   401 / 403 / 400       Failed — the gateway never decided, so nothing was saved
 *   anything else         Result unknown — it may have been saved; check before retrying
 *
 * Only "Instruction saved" is filled from a DONE receipt. Workers received it,
 * work started/finished, facts checked, published and checked on the public
 * page stay empty until something reports each of them.
 *
 * PURE except `newActionKey`, which reads the platform's random source.
 */
import type { ActionOutcome } from "@/lib/control-plane/gateway/contract.ts";
import type { ActionDef } from "./actions.ts";
import type { Lifecycle, ReceiptStatus, UiReceipt } from "./model.ts";

export const EMPTY_LIFECYCLE: Lifecycle = {
  saved: null,
  workersReceived: null,
  workStarted: null,
  workFinished: null,
  factsChecked: null,
  published: null,
  checkedOnPublicPage: null,
};

export const STATUS_WORDS: Readonly<Record<ReceiptStatus, string>> = {
  queued: "Queued",
  read: "Read by the workers",
  running: "Running",
  done: "Done",
  partial: "Partly done",
  refused: "Refused",
  failed: "Failed",
  unknown: "Result unknown",
};

export type ChipTone = "neutral" | "info" | "good" | "gold" | "warn";
export const STATUS_TONE: Readonly<Record<ReceiptStatus, ChipTone>> = {
  queued: "neutral",
  read: "info",
  running: "info",
  done: "good",
  partial: "gold",
  refused: "warn",
  failed: "warn",
  unknown: "warn",
};

export const UNKNOWN_SAYS = "No clear answer came back. It may still have been saved. Check what happened before trying again.";

export function newActionKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `v6-${c.randomUUID()}`;
  return `v6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function startReceipt(input: {
  readonly key: string;
  readonly def: ActionDef;
  readonly target: string;
  readonly targetName: string;
  readonly label: string;
  readonly scopeKey: string;
  readonly scopeName: string;
  readonly level: "local" | "global";
  readonly at: string;
  readonly simulated: boolean;
  readonly words?: string;
}): UiReceipt {
  return {
    key: input.key,
    kind: input.def.kind,
    target: input.target,
    targetName: input.targetName,
    label: input.label,
    scopeKey: input.scopeKey,
    scopeName: input.scopeName,
    level: input.level,
    status: "queued",
    statusWords: STATUS_WORDS.queued,
    steps: [{ label: "Sent", at: input.at }],
    says: "Sent. Waiting for the answer.",
    items: [],
    lifecycle: EMPTY_LIFECYCLE,
    simulated: input.simulated,
    gatewayType: null,
    gatewayReceiptId: null,
    readBackAt: null,
    replayed: false,
    sentAt: input.at,
    words: input.words,
  };
}

function isOutcome(body: unknown): body is ActionOutcome {
  if (!body || typeof body !== "object") return false;
  const r = (body as { receipt?: unknown }).receipt;
  return !!r && typeof r === "object" && typeof (r as { receiptId?: unknown }).receiptId === "string" &&
    typeof (r as { outcome?: unknown }).outcome === "string";
}

/** Fold the gateway's answer into the receipt. */
export function applyGatewayReply(prev: UiReceipt, def: ActionDef, httpStatus: number | null, body: unknown, at: string): UiReceipt {
  const step = (label: string) => [...prev.steps, { label, at }];
  if (httpStatus === 401 || httpStatus === 403) {
    return { ...prev, status: "failed", statusWords: STATUS_WORDS.failed, steps: step("Failed"),
      says: "Failed: your sign-in has expired or isn’t allowed to do this. Nothing was saved. Sign in again, then try again." };
  }
  if (httpStatus === 400 && !isOutcome(body)) {
    return { ...prev, status: "failed", statusWords: STATUS_WORDS.failed, steps: step("Failed"),
      says: "Failed: the request wasn’t accepted, so nothing was saved. You can try again." };
  }
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300 && isOutcome(body)) {
    const r = body.receipt;
    const base = { ...prev, gatewayReceiptId: r.receiptId, readBackAt: r.readBackAt, replayed: body.replayed === true };
    if (r.outcome === "REFUSED") {
      return { ...base, status: "refused", statusWords: STATUS_WORDS.refused, steps: step("Refused"), says: r.says };
    }
    if (body.ok !== true) {
      return { ...base, status: "unknown", statusWords: STATUS_WORDS.unknown, steps: step("No clear answer"), says: UNKNOWN_SAYS };
    }
    if (r.outcome === "DONE") {
      return {
        ...base,
        status: "done",
        statusWords: def.doneWords.split(".")[0] || STATUS_WORDS.done,
        steps: step(body.replayed ? "Already saved earlier" : "Saved"),
        says: `${def.doneWords}${body.replayed ? " This was the earlier send; nothing was done twice." : ""}`,
        lifecycle: { ...prev.lifecycle, saved: r.completedAt ?? r.startedAt ?? at },
      };
    }
    // QUEUED or IN_PROGRESS: saved, not finished.
    return {
      ...base,
      status: r.outcome === "QUEUED" ? "queued" : "running",
      statusWords: r.outcome === "QUEUED" ? STATUS_WORDS.queued : STATUS_WORDS.running,
      steps: step(r.outcome === "QUEUED" ? "Queued" : "Running"),
      says: r.says,
      lifecycle: { ...prev.lifecycle, saved: r.startedAt ?? at },
    };
  }
  return { ...prev, status: "unknown", statusWords: STATUS_WORDS.unknown, steps: step("No clear answer"), says: UNKNOWN_SAYS };
}

/** Count receipts by the History filter groups. */
export const HISTORY_FILTERS: readonly { readonly id: string; readonly label: string; readonly statuses: readonly ReceiptStatus[] | null }[] = [
  { id: "all", label: "All", statuses: null },
  { id: "open", label: "In progress", statuses: ["queued", "read", "running"] },
  { id: "done", label: "Done", statuses: ["done"] },
  { id: "partial", label: "Partly done", statuses: ["partial"] },
  { id: "bad", label: "Refused or failed", statuses: ["refused", "failed"] },
  { id: "unknown", label: "Result unknown", statuses: ["unknown"] },
];
