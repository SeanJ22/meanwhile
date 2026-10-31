/**
 * The prior-conclusion corpus `findReopenings()` reads, stored as a bare `PriorConclusion[]` so `method:check` reads it
 * unchanged. A conclusion is earned, never authored: `validateConclusions` refuses a fixture record in the canonical
 * corpus. Nothing here modifies a route, and nothing here reads a clock.
 */

import { existsSync, readFileSync } from "node:fs";

import { type ConclusionStatus, type PriorConclusion } from "./knowledge.ts";

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

