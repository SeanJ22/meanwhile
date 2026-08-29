/**
 * **PORTABILITY PROMOTION AS A JOB, NOT AS A CALL SOMEBODY REMEMBERS.**
 * (2026-08-29.)
 *
 * `earnedPortability()` and `applyEarnedPortability()` have been in
 * `lib/method/knowledge.ts` since the store was built, and they are careful,
 * conservative and correct. Nothing runs them. The store holds routes with
 * recorded outcomes and the overwhelming majority of them sit at `UNKNOWN`,
 * which is a valid resting state and is also, in that population, mostly the
 * answer to a question nobody asked.
 *
 * The gap is not a rule. The rule is right. The gap is that a derivation nobody
 * executes is a derivation the store does not have — the same shape as the
 * reopening machinery with no conclusion corpus, one module over.
 *
 * ## What this job adds, precisely
 *
 * It adds **determinism, idempotence and a NAMED refusal**, and it adds nothing
 * else. `earnedPortability` and `overGeneralized` remain the sole authority on
 * how far evidence reaches:
 *
 *   - three distinct YIELDED jurisdictions earn `NATIONWIDE`;
 *   - two earn `STATE_FAMILY`;
 *   - **one earns nothing** — it stays `UNKNOWN`, still inheriting everywhere,
 *     still marked speculative. RULING 178, and it is the bar this job exists to
 *     be unable to move: one success in one jurisdiction may never become
 *     national or state-wide authority;
 *   - narrowing happens ONLY on a DECLARED jurisdictional failure, never on a
 *     transport, permission or tooling failure (RULING 182).
 *
 * ## The over-promotion refusal is not decoration
 *
 * The job re-checks EVERY route's resulting applicability against
 * `overGeneralized` — including routes it did not move. A route already claiming
 * `NATIONWIDE` on one state's evidence is not something `applyEarnedPortability`
 * moves (the earned class is `UNKNOWN`, and narrowing on no declared failure is
 * refused), so a job that only looked at its own moves would write the store and
 * leave the over-claim standing, silently. Instead the run REFUSES, names the
 * route, and writes nothing. Declining quietly and refusing loudly are different
 * behaviours, and only one of them gets fixed.
 *
 * ## Idempotence
 *
 * A second run computes no moves and therefore performs no write at all — not a
 * write of identical content, no write. `updatedOn` does not churn, the bytes do
 * not change, and "did anything happen?" has a truthful answer.
 *
 * Time is a parameter. Nothing here reads a clock.
 */

import { floorLine, floored, type FlooredCount } from "../ops/denominator-floor.ts";
import { readMethodStore, writeMethodStore } from "./candidate.ts";
import {
  applyEarnedPortability,
  earnedPortability,
  type JurisdictionalFailure,
  type MethodKnowledge,
} from "./knowledge.ts";
import { overGeneralized, type PortabilityClass } from "./portability.ts";

export interface PortabilityMove {
  readonly id: string;
  readonly from: PortabilityClass;
  readonly to: PortabilityClass;
  readonly because: string;
}

/** A route whose applicability claims more reach than its evidence supports. */
export interface OverPromotion {
  readonly id: string;
  readonly portability: PortabilityClass;
  readonly provenStates: readonly string[];
  readonly why: string;
}

export interface PromotionPlan {
  /** The prospective store. Identical to the input when nothing moved. */
  readonly knowledge: MethodKnowledge;
  /** Every route the job examined. The denominator. */
  readonly considered: number;
  /** Deterministic: sorted by route id, never by iteration order. */
  readonly promotions: readonly PortabilityMove[];
  /** Over-claims found in the RESULT. Non-empty means the run is refused. */
  readonly refused: readonly OverPromotion[];
  readonly floor: FlooredCount;
}

/** Distinct jurisdictions a route actually YIELDED in. The only widening evidence. */
function provenStatesOf(outcomes: MethodKnowledge["routes"][number]["outcomes"]): string[] {
  return [...new Set(outcomes.filter((o) => o.outcome === "YIELDED").map((o) => o.jurisdiction))].sort();
}

/**
 * Compute what this run would do. Pure: it reads no file and writes none.
 *
 * `failures` carries DECLARED jurisdictional failures — the only input that may
 * narrow a route, and one a person has to write on purpose (see
 * `JurisdictionalFailure`). It is empty by default, so the job's own reach is
 * widening-or-nothing.
 */
export function planPortabilityPromotions(
  k: MethodKnowledge,
  failures: Record<string, JurisdictionalFailure[]> = {},
): PromotionPlan {
  const applied = applyEarnedPortability(k, failures);
  const promotions = [...applied.moved]
    .map((m) => ({ id: m.id, from: m.from, to: m.to, because: m.because }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const refused: OverPromotion[] = [];
  for (const r of applied.knowledge.routes) {
    const provenStates = provenStatesOf(r.outcomes);
    const over = overGeneralized(r.applicability, provenStates);
    if (!over) continue;
    refused.push({
      id: r.id,
      portability: r.applicability.portability,
      provenStates,
      why:
        `${r.id} ${over}. RULING 178: a route does not become nationwide by working somewhere. ` +
        "This run is REFUSED rather than silently declining to promote it, because a store that " +
        "over-claims reach offers a route to a jurisdiction as PROVEN when it is not.",
    });
  }

  return {
    knowledge: promotions.length > 0 ? applied.knowledge : k,
    considered: k.routes.length,
    promotions,
    refused,
    floor:
      k.routes.length > 0
        ? floored(
            "routes promoted out of UNKNOWN portability",
            "the routes project knowledge holds",
            k.routes.length,
            promotions.length,
          )
        : floored(
            "routes promoted out of UNKNOWN portability",
            "the routes project knowledge holds",
            0,
            0,
            "the store holds no routes at all — this is a store that failed to load, not a finding",
          ),
  };
}

/**
 * What a route would earn today, with the reason. For a report that wants to
 * explain a NON-promotion, which is the answer for most of the store and is the
 * one an operator most often mistakes for a bug.
 */
export function explainPortability(
  k: MethodKnowledge,
  routeId: string,
  failures: readonly JurisdictionalFailure[] = [],
): { id: string; current: PortabilityClass; earned: PortabilityClass; changed: boolean; because: string } | null {
  const route = k.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const earned = earnedPortability(route, failures);
  return {
    id: routeId,
    current: route.applicability.portability,
    earned: earned.portability,
    changed: earned.changed,
    because: earned.because,
  };
}

export interface PromotionRunOptions {
  /** ISO date, from `pnpm stamp`. */
  readonly stamp: string;
  /** **Default false.** Without it the run prints what it WOULD do and exits. */
  readonly write?: boolean;
  readonly failures?: Record<string, JurisdictionalFailure[]>;
  /** The version the caller read, when it read one earlier than this call. */
  readonly expectedVersion?: number;
}

export interface PromotionRunResult {
  readonly plan: PromotionPlan;
  readonly written: boolean;
  readonly refusal: string | null;
  readonly lines: readonly string[];
}

/**
 * Read, plan, report, and write only on an explicit `write`.
 *
 * The default is a dry run because this job rewrites applicability on an
 * arbitrary number of routes at once, and the first thing anyone should be able
 * to do with it is see the list.
 */
export function runPortabilityPromotion(
  storePath: string,
  options: PromotionRunOptions,
): PromotionRunResult {
  const k = readMethodStore(storePath);
  const plan = planPortabilityPromotions(k, options.failures ?? {});
  const lines: string[] = [];

  lines.push(`method version           ${k.version}`);
  lines.push(`routes considered        ${plan.considered}`);
  lines.push(`  ${floorLine(plan.floor)}`);
  for (const p of plan.promotions) lines.push(`  PROMOTE  ${p.id}  ${p.from} -> ${p.to}`);
  for (const p of plan.promotions) lines.push(`           because ${p.because}`);

  if (plan.refused.length > 0) {
    const refusal =
      `REFUSED — ${plan.refused.length} route(s) claim reach their evidence does not support. ` +
      "Nothing written; an over-promotion is named rather than quietly declined.";
    for (const o of plan.refused) lines.push(`  OVER-PROMOTED  ${o.why}`);
    return { plan, written: false, refusal, lines };
  }

  if (plan.promotions.length === 0) {
    lines.push("nothing to promote — the store already reflects every portability its evidence earns");
    return { plan, written: false, refusal: null, lines };
  }

  if (!options.write) {
    lines.push("");
    lines.push("DRY RUN — nothing written. Re-run with --write to apply.");
    return { plan, written: false, refusal: null, lines };
  }

  const receipt = writeMethodStore(storePath, plan.knowledge, {
    expectedVersion: options.expectedVersion ?? k.version,
    stamp: options.stamp,
  });
  lines.push("");
  lines.push(
    `written to ${receipt.path}   —  ${plan.promotions.length} promotion(s), ${receipt.bytes} bytes, ` +
      `method version ${receipt.version} (a promotion learns no route and bumps nothing)`,
  );
  return { plan, written: true, refusal: null, lines };
}
