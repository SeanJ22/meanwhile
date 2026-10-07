/**
 * The prior-conclusion corpus `findReopenings()` reads, stored as a bare `PriorConclusion[]` so `method:check` reads it
 * unchanged. A conclusion is earned, never authored: `validateConclusions` refuses a fixture record in the canonical
 * corpus. Nothing here modifies a route, and nothing here reads a clock.
 */

import { existsSync, readFileSync } from "node:fs";

import { fingerprint } from "../control-plane/ids.ts";
import { isTerminalState, type WorkItemState } from "../control-plane/work-item.ts";
import { atomicWriteJson } from "./candidate.ts";
import {
  CONCLUSION_STATUSES,
  isClosing,
  type ConclusionStatus,
  type Jurisdiction,
  type MethodIssue,
  type MethodKnowledge,
  type PriorConclusion,
  type Reopening,
} from "./knowledge.ts";

/** How a conclusion stopped being current, when it was not a reopening. */
export const CONCLUSION_WITHDRAWAL_KINDS = ["WITHDRAWN", "INVALIDATED"] as const;
export type ConclusionWithdrawalKind = (typeof CONCLUSION_WITHDRAWAL_KINDS)[number];

export interface ConclusionWithdrawal {
  kind: ConclusionWithdrawalKind;
  /** ISO date, from `pnpm stamp`. */
  on: string;
  /** Why, in evidence. A withdrawal that cannot say why is a deletion. */
  why: string;
  /** What remains true: the routes that produced the conclusion stay project knowledge. */
  survives: string;
}

/** What was actually walked to earn the conclusion. */
export interface ConclusionEvidence {
  /** Route ids walked. A conclusion resting on no route is a belief. */
  routeIds: string[];
  /** The Attempt that earned it, where a control-plane Attempt existed. */
  attemptId?: string;
  /** The WorkItem this conclusion closes, so a reopening can name what reopens. */
  workItemId?: string;
}

/** One earned conclusion; extends `PriorConclusion` so the corpus goes straight to `findReopenings`. */
export interface ConclusionRecord extends PriorConclusion {
  /** Required here, where `PriorConclusion` leaves it optional for the legacy shape. */
  status: ConclusionStatus;
  earnedBy: ConclusionEvidence;
  /** Why this is a conclusion and not a shrug. Stated, always. */
  why: string;
  /** True only for a test fixture; refused in the canonical store. */
  fixture?: boolean;
  withdrawal?: ConclusionWithdrawal;
}

/** The store: a bare array. */
export type ConclusionStore = ConclusionRecord[];

export function emptyConclusionStore(): ConclusionStore {
  return [];
}

/** Derived from the record; `earnedAtVersion` is in the digest so re-earning under a later version is a new record. */
export function conclusionId(
  kind: PriorConclusion["kind"],
  field: string,
  j: Jurisdiction,
  earnedAtVersion: number,
): string {
  return `pc-${fingerprint([
    kind,
    field,
    j.state,
    j.governmentType,
    j.platform,
    j.publisher,
    earnedAtVersion,
  ])}`;
}

export function findConclusion(store: ConclusionStore, id: string): ConclusionRecord | null {
  return store.find((c) => c.id === id) ?? null;
}

/** Every conclusion still closing an avenue. What `findReopenings` should see. */
export function openConclusions(store: ConclusionStore): ConclusionRecord[] {
  return store.filter(isClosing);
}

/** Record an earned conclusion, stamped with the method version it was earned under. Idempotent by derived id. */
export function recordConclusion(
  store: ConclusionStore,
  k: MethodKnowledge,
  input: {
    kind: PriorConclusion["kind"];
    field: string;
    jurisdiction: Jurisdiction;
    why: string;
    earnedBy: ConclusionEvidence;
    fixture?: boolean;
  },
  earnedOn: string,
): { store: ConclusionStore; record: ConclusionRecord; already: boolean } {
  const id = conclusionId(input.kind, input.field, input.jurisdiction, k.version);
  const existing = findConclusion(store, id);
  if (existing) return { store, record: existing, already: true };

  const record: ConclusionRecord = {
    id,
    kind: input.kind,
    field: input.field,
    jurisdiction: input.jurisdiction,
    earnedAtVersion: k.version,
    earnedOn,
    status: "EARNED",
    earnedBy: input.earnedBy,
    why: input.why,
    ...(input.fixture ? { fixture: true } : {}),
  };
  return { store: [...store, record], record, already: false };
}

/** Withdraw or invalidate a conclusion; the record is kept so a later session is told it was wrong. */
export function withdrawConclusion(
  store: ConclusionStore,
  id: string,
  withdrawal: ConclusionWithdrawal,
): { store: ConclusionStore; withdrawn: boolean; reason: string } {
  const existing = findConclusion(store, id);
  if (!existing) return { store, withdrawn: false, reason: `no conclusion ${id} in the corpus` };
  if (existing.withdrawal) {
    return { store, withdrawn: false, reason: `already ${existing.withdrawal.kind}: ${id}` };
  }
  return {
    store: store.map((c) => (c.id === id ? { ...c, status: withdrawal.kind, withdrawal } : c)),
    withdrawn: true,
    reason: `${withdrawal.kind} ${id} on ${withdrawal.on}; WHAT SURVIVES: ${withdrawal.survives}`,
  };
}

/** The governed open state a reopened obligation re-enters. */
export const REOPENED_WORK_ITEM_STATE: WorkItemState = "REOPENED";

export interface ReopenedWorkItem {
  from: WorkItemState;
  to: WorkItemState;
  /** True when the item had reached a terminal state and is being taken back. */
  wasTerminal: boolean;
  why: string;
}

/**
 * What a reopening does to the WorkItem the conclusion closed. A terminal item is taken back because convergence holds
 * only under the method version it was reached under.
 */
export function workItemStateAfterReopening(
  from: WorkItemState,
  reopening: Reopening,
): ReopenedWorkItem {
  const wasTerminal = isTerminalState(from);
  return {
    from,
    to: REOPENED_WORK_ITEM_STATE,
    wasTerminal,
    why: wasTerminal
      ? `${from} was earned under method version ${reopening.conclusion.earnedAtVersion}; ` +
        `${reopening.route.id} entered project knowledge at v${reopening.route.learnedAtVersion} and ` +
        "applies here, so the finding no longer covers every eligible avenue (RULING 179)"
      : `still open; ${reopening.route.id} adds an avenue that was not available when the ` +
        `${reopening.conclusion.kind} was earned at v${reopening.conclusion.earnedAtVersion}`,
  };
}

/** What the corpus refuses; the load-bearing rule is the fixture refusal. */
export function validateConclusions(store: ConclusionStore, k: MethodKnowledge): MethodIssue[] {
  const out: MethodIssue[] = [];
  const bad = (id: string, rule: string, detail: string) => out.push({ id, rule, detail });
  const routeIds = new Set(k.routes.map((r) => r.id));
  const seen = new Set<string>();

  for (const c of store) {
    if (seen.has(c.id)) bad(c.id, "duplicate-conclusion", "conclusion id appears more than once");
    seen.add(c.id);

    if (c.fixture) {
      bad(
        c.id,
        "fixture-conclusion-in-canonical-corpus",
        "this record is marked as a TEST FIXTURE and must never ship in the canonical corpus — " +
          "a manufactured conclusion propagates exactly like an earned one",
      );
    }
    if (!(CONCLUSION_STATUSES as readonly string[]).includes(c.status)) {
      bad(
        c.id,
        "conclusion-status-off-the-closed-set",
        `status is ${JSON.stringify(c.status)}, which is none of ${CONCLUSION_STATUSES.join(", ")}`,
      );
    }
    if (typeof c.earnedAtVersion !== "number") {
      bad(c.id, "conclusion-without-version", `${c.kind} carries no method version and can never be reopened`);
    } else if (c.earnedAtVersion > k.version) {
      bad(
        c.id,
        "conclusion-version-ahead",
        `earnedAtVersion ${c.earnedAtVersion} exceeds store version ${k.version}`,
      );
    }
    if (!c.earnedBy || !Array.isArray(c.earnedBy.routeIds) || c.earnedBy.routeIds.length === 0) {
      bad(
        c.id,
        "conclusion-without-evidence",
        "a conclusion names the routes that were walked to earn it; one that names none is a belief",
      );
    } else {
      for (const r of c.earnedBy.routeIds) {
        if (!routeIds.has(r)) {
          bad(c.id, "conclusion-route-unknown", `earnedBy names route ${r}, which project knowledge does not hold`);
        }
      }
    }
    if (c.withdrawal) {
      const gaps: string[] = [];
      if (!c.withdrawal.on) gaps.push("on");
      if (!c.withdrawal.why) gaps.push("why");
      if (!c.withdrawal.survives) gaps.push("survives");
      if (gaps.length > 0) {
        bad(
          c.id,
          "conclusion-withdrawal-incomplete",
          `a withdrawal records the date, the evidence, and WHAT SURVIVES it; missing: ${gaps.join(", ")}`,
        );
      }
    }
  }
  return out;
}

export function readConclusionStore(path: string): ConclusionStore {
  if (!existsSync(path)) return emptyConclusionStore();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(
      `CONCLUSION CORPUS MALFORMED at ${path}: expected a JSON array of PriorConclusion records, ` +
        `which is the shape scripts/method-check.mts already reads. Nothing was changed.`,
    );
  }
  return parsed as ConclusionStore;
}

export function writeConclusionStore(path: string, store: ConclusionStore): number {
  return atomicWriteJson(path, store);
}
