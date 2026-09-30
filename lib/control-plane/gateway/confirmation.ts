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
 *   config.setFleetSpendCeiling / expansion.scope.remove
 *                           a round started after the save: the runner reads
 *                           these when a round starts
 *   everything else         finished inside the console; nothing for the runner
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

export type ConfirmationState =
  /** The runner has picked it up. */
  | "applied"
  /** Saved, and the runner has not picked it up yet. */
  | "waiting"
  /** Finished inside the console; there is nothing for the runner to do. */
  | "not-needed"
  /** The runner's records could not be read, so nothing is claimed either way. */
  | "unread";

export interface Confirmation {
  readonly state: ConfirmationState;
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
  "fleet.deployHere",
]);

/** Actions the runner reads when a round starts. */
const ROUND_ACTIONS: ReadonlySet<string> = new Set([
  "config.setFleetSpendCeiling",
  "config.setDiscoverySearch",
  "expansion.scope.set",
  "expansion.scope.remove",
]);

/** What each action's pickup means, in the owner's words. */
const APPLIED_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Paused. The runner confirmed it and is not starting new rounds.",
  "runner.resume": "Resumed. The runner confirmed it and is starting its next round.",
  "runner.runCycleNow": "Started. The runner confirmed it and began a round.",
  "research.pause": "Paid research is paused. The runner confirmed it; no new paid work starts.",
  "fleet.deployHere": "Sent. The runner read it and put that work first.",
  "expansion.scope.set": "The runner has read it and is working on it.",
  "expansion.scope.remove": "The runner has read the new list; that place is off it.",
  "config.setFleetSpendCeiling": "The runner is using the new spending ceiling.",
  "config.setDiscoverySearch": "The runner is using the new search setting.",
};

const WAITING_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Saved. Waiting for the runner to confirm the pause.",
  "runner.resume": "Saved. Waiting for the runner to confirm it is running again.",
  "runner.runCycleNow": "Saved. Waiting for the runner to start the round.",
  "research.pause": "Saved. Waiting for the next round to close the paid lane.",
  "fleet.deployHere": "Saved. Waiting for the runner to read it.",
  "expansion.scope.set": "Saved. Waiting for the runner to read it.",
  "expansion.scope.remove": "Saved. Waiting for the runner to read the new list.",
  "config.setFleetSpendCeiling": "Saved. The runner uses it when its next round starts.",
  "config.setDiscoverySearch": "Saved. The runner uses it when its next round starts.",
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
export async function confirmReceipt(repos: ControlPlaneRepositories, receipt: ActionReceipt): Promise<Confirmation> {
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
    if (type === "expansion.scope.set") {
      const state = await repos.researchState.readNarrowed(RESEARCH_STATE_ID, { assignments: true });
      const refs = (state?.value as AssignmentReading | undefined)?.assignments?.assignments ?? [];
      if (refs.some((a) => a.ref === receipt.receiptId)) return applied(heartbeat?.lastCycleStartedAt ?? null);
    }
    if (later(heartbeat?.lastCycleStartedAt, receipt.completedAt ?? receipt.startedAt)) return applied(heartbeat?.lastCycleStartedAt ?? null);
    return waiting;
  } catch {
    return { state: "unread", at: null, words: "Saved. The runner's records could not be read just now, so whether it has picked this up is not known." };
  }
}
