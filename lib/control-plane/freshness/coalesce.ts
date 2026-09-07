/**
 * **THE WINDOW SHIPS ONE COMMIT, OR NONE.**
 * (FCP-4, 2026-09-07.)
 *
 * ## The law being preserved, not invented
 *
 * RULING 124 already ended the per-source commit: five refresh workflows on
 * five crons produced three commits, three production builds and three deploys
 * before 5 AM on 2026-08-24, every one shipping the same application. The
 * consolidated refresh commits ONCE however many sources moved, and a quiet day
 * costs zero commits and zero builds.
 *
 * **Nothing here weakens that and nothing here re-implements it.** What this
 * adds is the half RULING 124 did not need and FCP-4 does: the window now has
 * holdings in FOUR certification states rather than a single changed/unchanged
 * bit, and the question "what ships tonight" has to be answered from them
 * without letting one uncertified source hold four certified ones.
 *
 * ## The decision, entire
 *
 * ```
 *   zero CERTIFIED changed holdings   ->  no commit, no push, no deploy
 *   one or many                       ->  exactly one shipping commit
 *   anything not CERTIFIED            ->  stays durably owed, last-good serves
 * ```
 *
 * ## Held is not dropped, and that is the whole reason it is a state
 *
 * A holding that is `CERTIFICATION_PENDING` or `PROOF_INFRASTRUCTURE_BLOCKED`
 * is OWED. Its bytes are already acquired and parked (`evidenceRef`), so the
 * next attempt certifies what we have rather than asking the publisher again.
 * A holding that is `CONSUMER_DEFECT` is owed differently: it must not be
 * re-attempted into a green, so it carries its defect forward and waits for a
 * fix rather than a retry.
 *
 * ## Regeneration happens ONCE, over the final set
 *
 * FCP-4: "generated dependents are regenerated from the final coalesced
 * candidate tree once, not separately per source", and "expensive whole-tree
 * validation/build executes at most once". `regenerationPlan` names the one
 * pass, over exactly the holdings that are actually shipping — which is why
 * the plan is computed after the shipping set, never before it.
 *
 * PURE.
 */

import type { CandidateHolding } from "./acquisition.ts";
import {
  CROSS_HOLDING_COUPLINGS,
  type CertificationVerdict,
} from "./certification.ts";

export const COALESCE_FORMAT_VERSION = 1;

/** Why a holding did not ship tonight. Machine-readable, one per held row. */
export const HOLD_REASONS = [
  "NOT_YET_PROVED",
  "PROOF_INFRASTRUCTURE_UNAVAILABLE",
  "CONTENT_DEFECT",
  "COUPLED_TO_A_HELD_HOLDING",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface HeldHolding {
  readonly holding: CandidateHolding;
  readonly reason: HoldReason;
  /** True when the parked bytes are enough to retry without refetching. */
  readonly retryableWithoutRefetch: boolean;
  readonly detail: string;
}

export interface WindowPlan {
  readonly formatVersion: typeof COALESCE_FORMAT_VERSION;
  /** The holdings that ship in this window's single commit. */
  readonly shipping: readonly CandidateHolding[];
  readonly held: readonly HeldHolding[];
  /** Exactly 0 or 1. Never more, for any number of sources. */
  readonly commits: 0 | 1;
  readonly builds: 0 | 1;
  readonly deploys: 0 | 1;
  /** The one regeneration pass, over the final shipping set. */
  readonly regeneration: RegenerationPlan;
  /** One sentence a digest can quote. */
  readonly headline: string;
}

export interface RegenerationPlan {
  /** The cross-holding invariants that must be regenerated over the final set. */
  readonly invariants: readonly string[];
  /** How many times each runs. One, and the type says so. */
  readonly passes: 0 | 1;
  readonly over: readonly string[];
  readonly why: string;
}

/**
 * Plan one window from its certification verdicts.
 *
 * `verdicts` is every CHANGED holding's verdict. An UNCHANGED source never
 * reaches here at all: it produced no candidate, so it has nothing to ship and
 * nothing to hold, and counting it would make a quiet day look like work.
 */
export function planWindow(
  verdicts: readonly CertificationVerdict[],
): WindowPlan {
  const shipping: CandidateHolding[] = [];
  const held: HeldHolding[] = [];

  for (const v of verdicts) {
    if (v.state === "CERTIFIED") {
      shipping.push(v.holding);
      continue;
    }
    const reason: HoldReason =
      v.state === "CONSUMER_DEFECT"
        ? "CONTENT_DEFECT"
        : v.state === "PROOF_INFRASTRUCTURE_BLOCKED"
          ? "PROOF_INFRASTRUCTURE_UNAVAILABLE"
          : "NOT_YET_PROVED";
    held.push({
      holding: v.holding,
      reason,
      /*
       * A content defect is retryable without refetching too — the bytes are
       * parked — but retrying it is not the remedy, and saying "retryable"
       * about it would invite exactly the retry that must not happen. The
       * flag answers *can the next attempt avoid the publisher*, and for a
       * defect the honest answer is that there should be no next attempt
       * until somebody fixes something.
       */
      retryableWithoutRefetch: reason !== "CONTENT_DEFECT",
      detail: v.reason,
    });
  }

  /*
   * SHIP_TOGETHER couplings, applied after the per-holding decision.
   *
   * There are none today (see CROSS_HOLDING_COUPLINGS), so this loop removes
   * nothing — and it is here rather than absent because the alternative is
   * that adding the first real coupling means finding this place and inventing
   * it under pressure. An empty loop that is correct is cheaper than a correct
   * loop written during an incident.
   */
  const shipTogether = CROSS_HOLDING_COUPLINGS.filter((c) => c.mode === "SHIP_TOGETHER");
  for (const coupling of shipTogether) {
    const heldClasses = new Set(held.map((h) => h.holding.recordClass));
    if (!coupling.classes.some((c) => heldClasses.has(c))) continue;
    for (let i = shipping.length - 1; i >= 0; i -= 1) {
      if (!coupling.classes.includes(shipping[i].recordClass)) continue;
      held.push({
        holding: shipping[i],
        reason: "COUPLED_TO_A_HELD_HOLDING",
        retryableWithoutRefetch: true,
        detail: `${coupling.id}: ${coupling.why}`,
      });
      shipping.splice(i, 1);
    }
  }

  const ships = shipping.length > 0;
  const regeneration = regenerationPlan(shipping);

  return {
    formatVersion: COALESCE_FORMAT_VERSION,
    shipping,
    held,
    commits: ships ? 1 : 0,
    builds: ships ? 1 : 0,
    deploys: ships ? 1 : 0,
    regeneration,
    headline: ships
      ? `${shipping.length} certified holding(s) ship in ONE commit; ${held.length} held and owed`
      : held.length > 0
        ? `nothing certified tonight: 0 commits, 0 builds, 0 deploys; ${held.length} holding(s) ` +
          "remain owed and the last-known-good continues to serve"
        : "a quiet window: no source changed, so there is nothing to certify and nothing to ship",
  };
}

/**
 * The one regeneration pass.
 *
 * Zero passes when nothing ships, which is not a special case but the same
 * rule: regenerating a dependent over an unchanged tree produces the bytes
 * already committed, and committing them is the ceremonial commit RULING 124
 * ended.
 */
export function regenerationPlan(
  shipping: readonly CandidateHolding[],
): RegenerationPlan {
  if (shipping.length === 0) {
    return {
      invariants: [],
      passes: 0,
      over: [],
      why: "nothing ships, so no dependent is invalidated and no regeneration is owed",
    };
  }
  const classes = [...new Set(shipping.map((h) => h.recordClass))];
  const invariants = CROSS_HOLDING_COUPLINGS.filter((c) =>
    c.classes.some((cl) => classes.includes(cl)),
  ).map((c) => c.id);
  return {
    invariants,
    passes: 1,
    over: classes,
    why:
      "regenerated ONCE from the final coalesced candidate tree, never per source: a per-source " +
      "pass would rebuild the same dependents N times and leave the last one binding a tree the " +
      "earlier ones did not see",
  };
}

/**
 * **A RESTART DOES NOT SHIP THE SAME HOLDING TWICE.** (FCP-8 row 10.)
 *
 * The standing runner restarts — a reboot, a crash, a deliberate stop. When it
 * comes back, the obligations it had are still owed (their next-due is derived
 * from `lastWorkedAt`, so an interrupted cycle's work is simply due again) and
 * the candidate bytes are still parked. What must NOT happen is the window
 * shipping a holding it already shipped, which is how a restart turns into a
 * duplicate commit and a second build.
 *
 * The guard is content identity, not a flag: a holding whose `contentHash` is
 * already in the shipped set has nothing new to say, whatever any status field
 * survived the restart. A flag can be lost; a hash is the bytes.
 */
export function withoutAlreadyShipped(
  verdicts: readonly CertificationVerdict[],
  shippedHashes: readonly string[],
): readonly CertificationVerdict[] {
  const shipped = new Set(shippedHashes);
  return verdicts.filter((v) => !shipped.has(v.holding.contentHash));
}

/**
 * **THE FAN-OUT BOUND, COMPUTED RATHER THAN ASSERTED.**
 *
 * FCP-5 asks for a machine-enforced cost invariant. This is the freshness half:
 * whatever a window contains, its hosted-visible fan-out is at most one commit,
 * one build and one deploy, and on a quiet day it is zero of each. Returned as
 * a value so the contract test compares numbers rather than reading a promise.
 */
export function windowFanOut(plan: WindowPlan): {
  readonly commits: number;
  readonly builds: number;
  readonly deploys: number;
  readonly hostedFreshnessRuns: number;
} {
  return {
    commits: plan.commits,
    builds: plan.builds,
    deploys: plan.deploys,
    /*
     * Zero, always, and not because this window happened to avoid them: no
     * freshness execution class is granted `hosted-actions-minutes` at all
     * (resource-policy.ts). The number is a consequence of the grant table,
     * and `tests/hosted-cost-invariant.test.ts` asserts it from that table
     * rather than from this line.
     */
    hostedFreshnessRuns: 0,
  };
}
