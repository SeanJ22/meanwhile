/**
 * The gateway's saved receipt, not an HTTP 200 or a click, decides the state:
 *
 *   DONE                  final, worded by the action's own `doneWords`
 *   QUEUED / IN_PROGRESS  still pending
 *   REFUSED (ok:false)    Refused, with the gateway's reason
 *   401 / 403 / 400       Failed: the gateway never decided, so nothing was saved
 *   anything else         Result unknown: it may have been saved
 */
import type { Confirmation } from "@/lib/control-plane/gateway/confirmation.ts";
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

export function confirmationOf(body: unknown): Confirmation | null {
  const c = body && typeof body === "object" ? (body as { confirmation?: unknown }).confirmation : null;
  if (!c || typeof c !== "object") return null;
  const x = c as Partial<Confirmation>;
  const okState = x.state === "applied" || x.state === "waiting" || x.state === "not-needed" || x.state === "unread" || x.state === "not-picked-up" || x.state === "working";
  return okState && typeof x.words === "string" ? { state: x.state as Confirmation["state"], at: typeof x.at === "string" ? x.at : null, words: x.words,
    ...(x.plan && typeof x.plan === "object" ? { plan: x.plan } : {}), ...(x.progress && typeof x.progress === "object" ? { progress: x.progress } : {}),
    ...(Array.isArray(x.items) ? { items: x.items } : {}) } : null;
}

/** An order's parts as the receipt lists them. */
function itemsOf(c: Pick<Confirmation, "items">): Pick<UiReceipt, "items"> | Record<string, never> {
  return c.items ? { items: c.items.map((i) => ({ name: i.name, status: i.status, note: i.note, label: i.label })) } : {};
}

/**
 * Fold what the runner did into a receipt that is still open. "Done" is the
 * runner's word, not the click's: a saved request stays queued, with the words
 * saying what it is waiting on, until the runner's own record names it. A final
 * state is never overwritten.
 */
export function applyConfirmation(prev: UiReceipt, c: Confirmation, at: string): UiReceipt {
  if (prev.status !== "queued" && prev.status !== "read" && prev.status !== "running") return prev;
  if (c.state === "applied") {
    return {
      ...prev,
      status: "done",
      statusWords: "Done",
      steps: [...prev.steps, { label: "Runner confirmed", at: c.at ?? at }],
      says: c.words,
      lifecycle: { ...prev.lifecycle, workersReceived: c.at ?? at },
      ...(c.plan ? { plan: c.plan } : {}), ...(c.progress ? { progress: c.progress } : {}), ...itemsOf(c), notPickedUp: false,
    };
  }
  if (c.state === "working") return { ...prev, status: "running", statusWords: STATUS_WORDS.running, says: c.words, notPickedUp: false,
    lifecycle: { ...prev.lifecycle, workStarted: prev.lifecycle.workStarted ?? at },
    ...(c.plan ? { plan: c.plan } : {}), ...(c.progress ? { progress: c.progress } : {}), ...itemsOf(c) };
  if (c.state === "not-picked-up") return { ...prev, status: "queued", statusWords: "Not picked up", says: c.words, notPickedUp: true,
    ...(c.plan ? { plan: c.plan } : {}), ...(c.progress ? { progress: c.progress } : {}), ...itemsOf(c) };
  if (c.state === "waiting" || c.state === "unread") return { ...prev, status: "queued", statusWords: STATUS_WORDS.queued, says: c.words, notPickedUp: false,
    ...(c.plan ? { plan: c.plan } : {}), ...(c.progress ? { progress: c.progress } : {}), ...itemsOf(c) };
  return prev;
}

/** Open means the runner has not confirmed it, so the screen keeps asking. */
export function isOpen(r: Pick<UiReceipt, "status">): boolean {
  return r.status === "queued" || r.status === "read" || r.status === "running";
}

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
    const base = { ...prev, gatewayReceiptId: r.receiptId, readBackAt: r.readBackAt, replayed: body.replayed === true, ...(r.change ? { change: r.change } : {}) };
    if (r.outcome === "REFUSED") {
      return { ...base, status: "refused", statusWords: STATUS_WORDS.refused, steps: step("Refused"), says: r.says };
    }
    if (body.ok !== true) {
      return { ...base, status: "unknown", statusWords: STATUS_WORDS.unknown, steps: step("No clear answer"), says: UNKNOWN_SAYS };
    }
    const confirmation = confirmationOf(body);
    if (r.outcome === "DONE" && confirmation !== null && (confirmation.state === "waiting" || confirmation.state === "unread" || confirmation.state === "not-picked-up")) {
      return applyConfirmation(
        { ...base, status: "queued", statusWords: STATUS_WORDS.queued, steps: step("Saved"), says: confirmation.words, lifecycle: { ...prev.lifecycle, saved: r.completedAt ?? r.startedAt ?? at } },
        confirmation,
        at,
      );
    }
    if (r.outcome === "DONE") {
      return {
        ...base,
        status: "done",
        statusWords: def.doneWords.split(".")[0] || STATUS_WORDS.done,
        steps: step(body.replayed ? "Already saved earlier" : "Saved"),
        says: `${confirmation?.items ? confirmation.words : def.doneWords}${body.replayed ? " This was the earlier send; nothing was done twice." : ""}`,
        lifecycle: { ...prev.lifecycle, saved: r.completedAt ?? r.startedAt ?? at },
        ...(confirmation?.items ? { ...itemsOf(confirmation), ...(confirmation.progress ? { progress: confirmation.progress } : {}), ...(confirmation.plan ? { plan: confirmation.plan } : {}) } : {}),
      };
    }
    // QUEUED or IN_PROGRESS: saved, not finished. Unless the runner already confirmed it (a replay).
    const saved: UiReceipt = {
      ...base,
      status: r.outcome === "QUEUED" ? "queued" : "running",
      statusWords: r.outcome === "QUEUED" ? STATUS_WORDS.queued : STATUS_WORDS.running,
      steps: step(r.outcome === "QUEUED" ? "Queued" : "Running"),
      says: r.says,
      lifecycle: { ...prev.lifecycle, saved: r.startedAt ?? at },
    };
    return confirmation === null ? saved : applyConfirmation(saved, confirmation, at);
  }
  return { ...prev, status: "unknown", statusWords: STATUS_WORDS.unknown, steps: step("No clear answer"), says: UNKNOWN_SAYS };
}

export const HISTORY_FILTERS: readonly { readonly id: string; readonly label: string; readonly statuses: readonly ReceiptStatus[] | null }[] = [
  { id: "all", label: "All", statuses: null },
  { id: "open", label: "In progress", statuses: ["queued", "read", "running"] },
  { id: "done", label: "Done", statuses: ["done"] },
  { id: "partial", label: "Partly done", statuses: ["partial"] },
  { id: "bad", label: "Refused or failed", statuses: ["refused", "failed"] },
  { id: "unknown", label: "Result unknown", statuses: ["unknown"] },
];

export const ORDER_STEPS = ["Received", "Accepted", "Scheduled", "In progress", "Done"] as const;

/**
 * How far an order has got, as the count of steps reached (0 to 5), from the receipt's own status and plan.
 * Accepted needs a plan; Scheduled needs a time the work is due; In progress needs the work to have started.
 */
export function orderStepsReached(r: Pick<UiReceipt, "status" | "plan" | "lifecycle">): number {
  if (r.status === "refused" || r.status === "failed") return 0;
  if (r.status === "done" || r.status === "partial") return 5;
  if (r.status === "running" || r.lifecycle.workStarted) return 4;
  if (r.plan?.resultsBy) return 3;
  if (r.plan) return 2;
  return r.lifecycle.saved || r.status === "queued" || r.status === "read" ? 1 : 0;
}

export function acceptedLine(r: Pick<UiReceipt, "plan" | "scopeName" | "level">, format: (iso: string) => string): string | null {
  if (!r.plan) return null;
  const where = r.level === "local" && r.scopeName && r.scopeName !== "—" ? ` in ${r.scopeName}` : "";
  return ["Accepted", r.plan.who, r.plan.creates !== null ? `creates ${r.plan.creates} ${r.plan.creates === 1 ? "item" : "items"}${where}` : r.plan.change,
    ...(r.plan.resultsBy ? [`first results by ${format(r.plan.resultsBy)}`] : [])].join(" · ");
}

export const TAKE_BACK: Readonly<Partial<Record<UiReceipt["kind"], UiReceipt["kind"]>>> = {
  "global-runner-pause": "global-runner-resume",
  "global-runner-resume": "global-runner-pause",
  "global-paid": "global-paid-resume",
  "global-paid-resume": "global-paid",
};

export function doneWithChange(r: Pick<UiReceipt, "status" | "change">): string | null {
  return r.status === "done" && r.change ? `Done · ${r.change.before} → ${r.change.after}` : null;
}

const SENTENCE_MAX = 140;

export function oneSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?=\s|$)/.exec(flat);
  const first = end ? flat.slice(0, end.index + 1) : flat;
  return first.length > SENTENCE_MAX ? `${first.slice(0, SENTENCE_MAX - 1).trimEnd()}…` : first;
}
