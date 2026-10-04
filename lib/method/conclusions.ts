/**
 * **THE PRIOR-CONCLUSION CORPUS — THE INPUT THE REOPENING MACHINERY NEVER HAD.**
 * (2026-08-29.)
 *
 * `findReopenings()` and `applyReopenings()` have existed in
 * `lib/method/knowledge.ts` since the store was built. They are the mechanical
 * form of RULING 178's last clause — *a newly learned route reopens the prior
 * conclusions it would have applied to* — and they are correct.
 *
 * They take a `PriorConclusion[]`. **Nothing in this repository ever wrote one.**
 * `pnpm method:check` reads `data/method/conclusions.json` if it exists, and it
 * did not exist, so the reopening sweep ran over an empty array on every session
 * and reported zero awaiting reopening. Zero was true, and it was true the way a
 * selector that matches nothing reports zero offenders (RULING 159): the
 * instrument was never pointed at a population.
 *
 * That is the exact failure mode the module note in `knowledge.ts` calls out —
 * *"a new route reopens old absences" has been true in principle since RULING 61
 * and has never once happened* — surviving one layer further down than the
 * repair went. The engine was built and never fuelled.
 *
 * ## The store is a BARE ARRAY, deliberately
 *
 * `scripts/method-check.mts` already reads this path and already parses it as
 * `PriorConclusion[]`. Wrapping the corpus in an envelope would have broken the
 * one consumer that existed, for tidiness. So a `ConclusionRecord` IS a
 * `PriorConclusion` with governed extras alongside it: `method:check` keeps
 * working, unchanged, and starts reporting a corpus the day one exists.
 *
 * ## What a record must never be
 *
 * **A conclusion is EARNED, never authored to make a mechanism demonstrable.**
 * A fabricated absence is a false claim about a government with a date on it,
 * and it would propagate exactly like a real one — that is what makes the
 * reopening machinery worth having in the first place. So a record carries an
 * explicit `fixture` flag, `validateConclusions` REFUSES a fixture record in the
 * canonical corpus by name, and the tests that exercise the loop mark their own
 * data as fixtures in the data rather than in a comment.
 *
 * ## Withdrawal never touches a route
 *
 * Nothing in this module returns a modified `MethodKnowledge`. A conclusion can
 * be withdrawn, invalidated, reopened or re-earned and the routes that produced
 * it are untouched by every one of those — the same rule `lib/method/claims.ts`
 * holds for assertions: a false conclusion must never cause a valid route to be
 * deleted.
 *
 * Time is a parameter throughout. Nothing here reads a clock.
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
  /**
   * **WHAT SURVIVES.** The same required field a claim retraction carries, for
   * the same reason: the routes that produced this conclusion are still project
   * knowledge, and a withdrawal that does not say so invites somebody to tidy
   * them away with it.
   */
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

/**
 * One earned conclusion, durable.
 *
 * It extends `PriorConclusion` rather than wrapping it so that the whole corpus
 * can be handed straight to `findReopenings` — one shape, no adapter, nothing to
 * forget to map.
 */
export interface ConclusionRecord extends PriorConclusion {
  /** Required here, where `PriorConclusion` leaves it optional for the legacy shape. */
  status: ConclusionStatus;
  earnedBy: ConclusionEvidence;
  /** Why this is a conclusion and not a shrug. Stated, always. */
  why: string;
  /**
   * **TRUE ONLY FOR A TEST FIXTURE, AND IT LIVES IN THE DATA.** A comment saying
   * "this is only a fixture" is invisible to the corpus a later session reads.
   * `validateConclusions` refuses a record carrying this in the canonical store.
   */
  fixture?: boolean;
  withdrawal?: ConclusionWithdrawal;
}

/** The store, on disk and in memory. A bare array — see the module note. */
export type ConclusionStore = ConclusionRecord[];

export function emptyConclusionStore(): ConclusionStore {
  return [];
}

/**
 * The record's id, derived rather than assigned.
 *
 * `earnedAtVersion` is in the digest on purpose: re-earning a conclusion after a
 * reopening, under a later method version, is a NEW event about the same
 * subject, and collapsing the two would erase the fact that we went back.
 */
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

/**
 * Record an earned conclusion, STAMPED WITH THE METHOD VERSION IT WAS EARNED
 * UNDER.
 *
 * The version is the whole mechanism. A conclusion that does not carry one can
 * never be reopened, because there is nothing to compare a later route's
 * `learnedAtVersion` against — which is why `validateKnowledge` has always
 * refused a versionless conclusion and why this function takes the store it was
 * earned against rather than a number somebody types.
 *
 * Idempotent by derived id: re-recording the same conclusion at the same version
 * returns what is already there.
 */
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

/**
 * Withdraw or invalidate a conclusion. **The record is kept.**
 *
 * A withdrawn conclusion stops closing an avenue — `findReopenings` skips it,
 * because there is nothing left to reopen — and stays in the corpus carrying why
 * it went. Deleting it would let a later session re-earn the same wrong
 * conclusion having never been told it was wrong.
 */
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

/* ------------------------------------------------- WHAT A REOPENING DOES TO A WORKITEM */

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
 * What a reopening does to the WorkItem the conclusion closed.
 *
 * The state is the REAL one from `lib/control-plane/work-item.ts` — imported
 * rather than re-spelled, so a rename there breaks this loudly instead of
 * leaving two vocabularies that agree by coincidence.
 *
 * A terminal item is the case that matters. `VERIFIED_COMPLETE` was an
 * affirmative finding, honestly earned, under a method version that no longer
 * describes the avenues available. Taking it back is not an accusation; it is
 * RULING 179 — `CONVERGED_AS_OF` means every eligible avenue has a disposition
 * UNDER THE CURRENT METHOD VERSION, and the method version moved.
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

/* ------------------------------------------------------------------- VALIDATION */

/**
 * What the corpus refuses.
 *
 * `validateKnowledge` already refuses a versionless conclusion and a status off
 * the closed set, because those two break the reopening sweep itself. These are
 * the corpus's own rules, and the load-bearing one is the fixture refusal: a
 * manufactured conclusion is a false claim about a government that propagates
 * exactly like an earned one.
 */
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

/* --------------------------------------------------------------- THE DURABLE STORE */

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
