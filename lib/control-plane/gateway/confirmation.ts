/**
 * **"DONE" MEANS THE RUNNER SAYS SO.** (S11, rulings §0 test 5 and §6.)
 *
 * A click saves a receipt. A saved receipt proves the console recorded the
 * request; it does not prove anything has acted on it. This module asks the one
 * question the owner cares about — *has the runner picked this up?* — by
 * reading what the runner already writes, for each kind of action. It writes
 * nothing, and it adds no ledger: the receipts stay immutable and the runner's
 * own records are the proof.
 *
 * ```
 *   runner.pause / runner.resume / runner.runCycleNow / research.pause /
 *   fleet.deployHere        the runner's HONORED record beside the intent. The
 *                           receipt's subject IS the intent id, and the record's
 *                           `honors` names it: one point read, found by content
 *   expansion.scope.set     the runner's assignment reading names this receipt
 *                           (written when a round starts), else a round that
 *                           started after the save has read the new list
 *   config.setDiscoverySearch
 *                           the runner's own heartbeat names this receipt
 *   config.setFleetSpendCeiling / config.setPlaceTarget / expansion.scope.remove
 *                           a round started after the save: the runner reads
 *                           these when a round starts
 *   everything else         finished inside the console; nothing for the runner
 *                           (config.setDataSwitch is read at each read of a number, so it is in force when saved)
 * ```
 *
 * A round that has not started since the save is "waiting", and a paused runner
 * starts none: the words say so rather than pretend.
 *
 * PURE apart from the reads it is handed.
 */
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID, type ResearchIntent } from "../scheduler/research-policy.ts";
import { RUNNER_ID } from "../admin-data.ts";
import type { ActionReceipt } from "./contract.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { formatEastern } from "../eastern-time.ts";

export type ConfirmationState =
  /** The runner has picked it up. */
  | "applied"
  /** Saved, and the runner has not picked it up yet. */
  | "waiting"
  /** Finished inside the console; there is nothing for the runner to do. */
  | "not-needed"
  /** The runner's records could not be read, so nothing is claimed either way. */
  | "unread"
  /** Saved, the runner has not taken it, and it is overdue: its heartbeat is silent or a round due after the save has passed. */
  | "not-picked-up";

/** BR-12: what accepting an order means, in four plain parts. Built only from data already read. */
export interface OrderPlan {
  /** Who does it: "Runner" or "Admin". */
  readonly who: string;
  /** What changes, one phrase. */
  readonly change: string;
  /** How many items it creates, or null when the order creates none or it is not counted. */
  readonly creates: number | null;
  /** When the first results are due: the heartbeat's next round time, or null when unknown. */
  readonly resultsBy: string | null;
}

/** One progress bar per order: setting is one step; a send is created out of created plus deferred; a hunt is the place's score change. */
export interface OrderProgress {
  readonly done: number | null;
  readonly of: number | null;
}

export interface Confirmation {
  readonly state: ConfirmationState;
  readonly plan?: OrderPlan;
  readonly progress?: OrderProgress;
  /** When the runner picked it up, when it has. */
  readonly at: string | null;
  /** One plain sentence for the owner. */
  readonly words: string;
}

/** Actions whose receipt subject is a research intent id the runner honors. */
export const INTENT_ACTIONS: ReadonlySet<string> = new Set([
  "runner.pause",
  "runner.resume",
  "runner.runCycleNow",
  "research.pause",
  "research.resume",
  "fleet.deployHere",
]);

/** Actions the runner reads when a round starts. */
const ROUND_ACTIONS: ReadonlySet<string> = new Set([
  "config.setFleetSpendCeiling",
  "config.setPlaceTarget",
  "config.setDiscoverySearch",
  "expansion.scope.set",
  "expansion.scope.setMany",
  "expansion.scope.budget",
  "expansion.scope.remove",
]);

/** What each action's pickup means, in the owner's words. */
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
  let core = await confirmCore(repos, receipt);
  if (receipt.outcome === "REFUSED") return core;
  let nextRound: string | null = null;
  try {
    const beat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    nextRound = beat?.nextCycleDueAt ?? null;
    if (core.state === "waiting") core = notPickedUp(core, beat, receipt, nowMs);
  } catch { /* the plan says — */ }
  return { ...core, plan: orderPlan(receipt, nextRound), progress: orderProgress(receipt, core) };
}

/** A runner that has not beaten for this long is silent. Rounds beat far more often than this. */
export const RUNNER_SILENT_MS = 15 * 60 * 1000;

/**
 * BR-02: a waiting order that is overdue says why. Overdue means the runner's last beat is old, or a round that was
 * due after the save has come and gone with nothing picking the order up. Pure.
 */
export function notPickedUp(
  waiting: Confirmation,
  beat: Pick<RunnerHeartbeat, "beatAt" | "nextCycleDueAt"> | null,
  receipt: Pick<ActionReceipt, "completedAt" | "startedAt">,
  nowMs: number,
): Confirmation {
  const savedAt = Date.parse(receipt.completedAt ?? receipt.startedAt);
  const beatAt = beat ? Date.parse(beat.beatAt) : NaN;
  // A runner that has never beaten is silent once the order has waited as long as a beat may be late.
  const silent = Number.isFinite(beatAt) ? nowMs - beatAt > RUNNER_SILENT_MS : nowMs - savedAt > RUNNER_SILENT_MS;
  const due = beat?.nextCycleDueAt ? Date.parse(beat.nextCycleDueAt) : NaN;
  const roundPassed = Number.isFinite(due) && due > savedAt && due < nowMs;
  if (!silent && !roundPassed) return waiting;
  const since = Number.isFinite(beatAt) && beat ? formatEastern(beat.beatAt) : null;
  return { state: "not-picked-up", at: null, words: since ? `The runner hasn't checked in since ${since}.` : "The runner hasn't checked in yet." };
}

const SETTING_ACTIONS: ReadonlySet<string> = new Set(["config.setSetting", "config.setFleetSpendCeiling", "config.setPlaceTarget", "config.setDiscoverySearch", "config.setDataSwitch"]);

/** The plan for an accepted order. Pure. */
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

/** Progress per order type, from what the confirmation already says. Pure. */
export function orderProgress(receipt: Pick<ActionReceipt, "type" | "openedWork">, confirmation: Pick<Confirmation, "state">): OrderProgress {
  const finished = confirmation.state === "applied" || confirmation.state === "not-needed";
  if (SETTING_ACTIONS.has(receipt.type)) return { done: finished ? 1 : 0, of: 1 };
  if (receipt.type === "fleet.deployHere") return { done: finished ? receipt.openedWork.length : 0, of: receipt.openedWork.length || null };
  // A hunt or mission is measured by the place's score since it was accepted; no score is held here.
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
