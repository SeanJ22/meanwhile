import type { ControlPlaneRepositories } from "../repository/types.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID, type ResearchIntent } from "../scheduler/research-policy.ts";
import { RUNNER_ID } from "../admin-data.ts";
import type { ActionReceipt } from "./contract.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { formatEastern } from "../eastern-time.ts";
import { isLeadOrder, leadCounts, leadCountsWords, leadItems, LEADS_ACTION, rowOpen, type LeadOrder } from "../leads/order.ts";

export type ConfirmationState =
  | "applied"
  | "waiting"
  | "not-needed"
  | "unread"
  /** Saved, the runner has not taken it, and it is overdue: its heartbeat is silent or a round due after the save has passed. */
  | "not-picked-up"
  /** The runner has started on it and has not finished. */
  | "working";

export interface OrderPlan {
  readonly who: string;
  readonly change: string;
  /** How many items it creates, or null when the order creates none or it is not counted. */
  readonly creates: number | null;
  readonly resultsBy: string | null;
}

export interface OrderProgress {
  readonly done: number | null;
  readonly of: number | null;
}

/** One part of an order, as order tracking lists it. */
export interface OrderItem {
  readonly name: string;
  readonly status: "done" | "failed" | "queued" | "running";
  readonly label: string;
  readonly note: string;
}

export interface Confirmation {
  readonly state: ConfirmationState;
  readonly plan?: OrderPlan;
  readonly progress?: OrderProgress;
  /** Each part's own status, for an order made of many. */
  readonly items?: readonly OrderItem[];
  readonly at: string | null;
  readonly words: string;
}

export const INTENT_ACTIONS: ReadonlySet<string> = new Set([
  "runner.pause",
  "runner.resume",
  "runner.runCycleNow",
  "research.pause",
  "research.resume",
  "fleet.deployHere",
]);

const ROUND_ACTIONS: ReadonlySet<string> = new Set([
  "config.setFleetSpendCeiling",
  "config.setPlaceTarget",
  "config.setDiscoverySearch",
  "expansion.scope.set",
  "expansion.scope.setMany",
  "expansion.scope.budget",
  "expansion.scope.remove",
]);

const APPLIED_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Paused.",
  "runner.resume": "Resumed.",
  "runner.runCycleNow": "Started.",
  "research.pause": "Paid research paused.",
  "research.resume": "Paid research resumed.",
  "fleet.deployHere": "Sent.",
  "expansion.scope.set": "Runner has it.",
  "expansion.scope.setMany": "Runner has the list.",
  "expansion.scope.budget": "Budget in use.",
  "expansion.scope.remove": "Removed.",
  "config.setFleetSpendCeiling": "Ceiling in use.",
  "config.setPlaceTarget": "Target in use.",
  "config.setDiscoverySearch": "Search setting in use.",
};

const WAITING_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Saved. Waiting for the runner.",
  "runner.resume": "Saved. Waiting for the runner.",
  "runner.runCycleNow": "Saved. Waiting for the runner.",
  "research.pause": "Saved. Waiting for the next round.",
  "research.resume": "Saved. Waiting for the next round.",
  "fleet.deployHere": "Saved. Waiting for the runner.",
  "expansion.scope.set": "Saved. Waiting for the runner.",
  "expansion.scope.setMany": "Saved. Waiting for the runner.",
  "expansion.scope.budget": "Saved. Waiting for the next round.",
  "expansion.scope.remove": "Saved. Waiting for the runner.",
  "config.setFleetSpendCeiling": "Saved. Waiting for the next round.",
  "config.setPlaceTarget": "Saved. Waiting for the next round.",
  "config.setDiscoverySearch": "Saved. Waiting for the next round.",
};

function later(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > y;
}

interface AssignmentReading {
  readonly assignments?: { readonly assignments?: readonly { readonly ref?: unknown }[] };
}

/** Has the runner picked this receipt's action up? Never throws: an unreadable record is "unread". */
export async function confirmReceipt(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number = Date.now()): Promise<Confirmation> {
  if (receipt.type === LEADS_ACTION && receipt.outcome !== "REFUSED") return confirmLeads(repos, receipt, nowMs);
  let core = await confirmCore(repos, receipt);
  if (receipt.outcome === "REFUSED") return core;
  let nextRound: string | null = null;
  try {
    const beat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    nextRound = beat?.nextCycleDueAt ?? null;
    if (core.state === "waiting") core = notPickedUp(core, beat, receipt, nowMs);
  } catch { }
  return { ...core, plan: orderPlan(receipt, nextRound), progress: orderProgress(receipt, core) };
}

/** A leads order, from its own rows: each row's status, how many are finished, and whether the runner has started. */
async function confirmLeads(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number): Promise<Confirmation> {
  let beat: RunnerHeartbeat | null = null;
  let order: LeadOrder | null = null;
  try {
    beat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    const row = await repos.leadOrders.read(receipt.receiptId);
    order = row !== null && isLeadOrder(row.value) ? row.value : null;
  } catch { }
  if (order === null) return { state: "unread", at: null, words: "Saved. Runner status —", plan: leadsPlan(receipt, null, beat) };
  const counts = leadCounts(order);
  const base = { plan: leadsPlan(receipt, counts.queued, beat), progress: { done: order.rows.filter((r) => !rowOpen(r)).length, of: counts.total }, items: leadItems(order) };
  if (!order.open) return { ...base, state: "applied", at: order.updatedAt, words: `Done: ${leadCountsWords(counts)}` };
  if (counts.tested > 0) return { ...base, state: "working", at: null, words: `Testing links: ${leadCountsWords(counts)}` };
  const waiting: Confirmation = { state: "waiting", at: null, words: `Saved. Waiting for the runner to test ${counts.queued.toLocaleString("en-US")} link${counts.queued === 1 ? "" : "s"}.` };
  return { ...base, ...notPickedUp(waiting, beat, receipt, nowMs) };
}

function leadsPlan(receipt: Pick<ActionReceipt, "label">, toTest: number | null, beat: Pick<RunnerHeartbeat, "nextCycleDueAt"> | null): OrderPlan {
  return { who: "Runner", change: receipt.label, creates: toTest !== null && toTest > 0 ? toTest : null, resultsBy: beat?.nextCycleDueAt ?? null };
}

/** A runner that has not beaten for this long is silent. Rounds beat far more often than this. */
export const RUNNER_SILENT_MS = 15 * 60 * 1000;

export function notPickedUp(
  waiting: Confirmation,
  beat: Pick<RunnerHeartbeat, "beatAt" | "nextCycleDueAt"> | null,
  receipt: Pick<ActionReceipt, "completedAt" | "startedAt">,
  nowMs: number,
): Confirmation {
  const savedAt = Date.parse(receipt.completedAt ?? receipt.startedAt);
  const beatAt = beat ? Date.parse(beat.beatAt) : NaN;
  const silent = Number.isFinite(beatAt) ? nowMs - beatAt > RUNNER_SILENT_MS : nowMs - savedAt > RUNNER_SILENT_MS;
  const due = beat?.nextCycleDueAt ? Date.parse(beat.nextCycleDueAt) : NaN;
  const roundPassed = Number.isFinite(due) && due > savedAt && due < nowMs;
  if (!silent && !roundPassed) return waiting;
  const since = Number.isFinite(beatAt) && beat ? formatEastern(beat.beatAt) : null;
  return { state: "not-picked-up", at: null, words: since ? `The runner hasn't checked in since ${since}.` : "The runner hasn't checked in yet." };
}

const SETTING_ACTIONS: ReadonlySet<string> = new Set(["config.setSetting", "config.setFleetSpendCeiling", "config.setPlaceTarget", "config.setDiscoverySearch", "config.setDataSwitch"]);

export function orderPlan(receipt: Pick<ActionReceipt, "type" | "openedWork" | "label">, nextRoundAt: string | null): OrderPlan {
  const runner = INTENT_ACTIONS.has(receipt.type) || ROUND_ACTIONS.has(receipt.type);
  const created = receipt.openedWork.length;
  return {
    who: runner ? "Runner" : "Admin",
    change: receipt.label,
    creates: created > 0 ? created : null,
    resultsBy: runner ? nextRoundAt : null,
  };
}

export function orderProgress(receipt: Pick<ActionReceipt, "type" | "openedWork">, confirmation: Pick<Confirmation, "state">): OrderProgress {
  const finished = confirmation.state === "applied" || confirmation.state === "not-needed";
  if (SETTING_ACTIONS.has(receipt.type)) return { done: finished ? 1 : 0, of: 1 };
  if (receipt.type === "fleet.deployHere") return { done: finished ? receipt.openedWork.length : 0, of: receipt.openedWork.length || null };
  return { done: null, of: null };
}

async function confirmCore(repos: ControlPlaneRepositories, receipt: ActionReceipt): Promise<Confirmation> {
  if (receipt.outcome === "REFUSED") return { state: "not-needed", at: null, words: receipt.says };
  const type = receipt.type;
  const inIntent = INTENT_ACTIONS.has(type);
  const inRound = ROUND_ACTIONS.has(type);
  if (!inIntent && !inRound) return { state: "not-needed", at: receipt.completedAt, words: receipt.says };
  const applied = (at: string | null, detail?: string): Confirmation => ({
    state: "applied",
    at,
    words: `${APPLIED_WORDS[type]}${detail ? ` ${detail}` : ""}`,
  });
  const waiting: Confirmation = { state: "waiting", at: null, words: WAITING_WORDS[type] };
  try {
    if (inIntent) {
      const rows: readonly ResearchIntent[] = await repos.researchIntents.readWhere(RESEARCH_INTENT_LOG_KEY, ["honors"], receipt.subject);
      const honored = rows.find((r) => r.kind === "HONORED");
      return honored && honored.kind === "HONORED" ? applied(honored.honoredAt) : waiting;
    }
    const heartbeat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    if (type === "config.setDiscoverySearch" && heartbeat?.discoverySearch?.receiptId === receipt.receiptId) {
      return applied(heartbeat.discoverySearch.appliedAt ?? null);
    }
    if (type === "expansion.scope.set" || type === "expansion.scope.setMany") {
      const state = await repos.researchState.readNarrowed(RESEARCH_STATE_ID, { assignments: true });
      const refs = (state?.value as AssignmentReading | undefined)?.assignments?.assignments ?? [];
      if (refs.some((a) => a.ref === receipt.receiptId)) return applied(heartbeat?.lastCycleStartedAt ?? null);
    }
    if (later(heartbeat?.lastCycleStartedAt, receipt.completedAt ?? receipt.startedAt)) return applied(heartbeat?.lastCycleStartedAt ?? null);
    return waiting;
  } catch {
    return { state: "unread", at: null, words: "Saved. Runner status —" };
  }
}
