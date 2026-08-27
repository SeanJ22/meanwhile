/**
 * Cumulative project discovery knowledge — the compounding engine.
 *
 * ## The three properties this has to make structurally true
 *
 * 1. **State N+1 never rediscovers a method state N already taught.** Routes
 *    are project knowledge, not session knowledge.
 * 2. **State N+1 is never PREVENTED from inventing a method** because state N's
 *    manifest is treated as complete. The manifest is versioned current
 *    knowledge, never a finished list.
 * 3. **A newly learned route mechanically reopens prior conclusions it would
 *    have applied to.** Not "a future session should remember to go back" —
 *    that has been the rule since RULING 61 and has never once happened.
 *
 * ## Why a new store rather than an edit to `branch-manifest.ts`
 *
 * The manifest holds 62 routes with real reasoning attached and is wired into
 * `judgeManifestWalk`, tier ordering and `isEvidencedAbsence`. Rewriting it
 * would risk the project's accumulated discovery knowledge to gain a data
 * shape, which RULING 63 forbids in as many words: *do not reset the project's
 * learned discovery system while improving its architecture.*
 *
 * So this store INGESTS the manifest rather than replacing it. Every existing
 * route arrives with its id, its tier, its prose and its sub-branches intact,
 * gains a typed portability class defaulting to `UNKNOWN`, and keeps working.
 */

import {
  type Applicability,
  type Jurisdiction,
  appliesTo,
  overGeneralized,
  unknownApplicability,
} from "./portability.ts";

/** What a route yielded in one jurisdiction on one date. */
export interface RouteOutcome {
  jurisdiction: string;
  /** ISO date. */
  walkedOn: string;
  rows: number;
  /**
   * A route that returned zero is a WALKED route, never a broken one. RULING 88
   * is explicit: a newly conceived route returning nothing is a reported
   * success, and the invention is the deliverable.
   */
  outcome: "YIELDED" | "ZERO" | "FAILED" | "BLOCKED";
  note?: string;
}

/**
 * A sub-branch — an inherited route that failed somewhere new.
 *
 * RULING 60: a branch that stops working is evidence the tree needs another
 * limb, never evidence the fact is unobtainable. It is never DELETED, because
 * deleting it would let a later session rediscover it as new.
 */
export interface SubBranch {
  jurisdiction: string;
  failedOn: string;
  reason: string;
  /** The route id that replaced or supplemented it here, if one did. */
  replacedBy?: string;
}

export interface MethodRoute {
  id: string;
  title: string;
  /** RULING 84 / RULING 166: A0, A1, B, C. */
  tier: "A0" | "A1" | "B" | "C";
  /** Which owed field types this route can advance. */
  fields: string[];
  applicability: Applicability;
  outcomes: RouteOutcome[];
  subBranches: SubBranch[];
  /** Where this route came from. */
  origin: string;
  /** The method version at which this route entered project knowledge. */
  learnedAtVersion: number;
  learnedOn: string | null;
  /** A route is never removed. One that stops working carries a dated note. */
  retiredOn?: string;
  retiredReason?: string;
}

export interface MethodKnowledge {
  /**
   * The method version. It increments whenever a route ENTERS project
   * knowledge, and it is what convergence records are stamped with — so a
   * completion earned under v7 stops being exhaustion the moment v8 contains an
   * applicable route that was never walked.
   */
  version: number;
  updatedOn: string | null;
  routes: MethodRoute[];
}

export function emptyKnowledge(): MethodKnowledge {
  return { version: 0, updatedOn: null, routes: [] };
}

/**
 * The routes a jurisdiction INHERITS.
 *
 * Everything applicable, including the speculative ones. Inheritance is the
 * starting advantage of a new state, never its constraint (RULING 178).
 */
export function inheritedRoutes(
  k: MethodKnowledge,
  j: Jurisdiction,
): Array<{ route: MethodRoute; reason: string; speculative: boolean }> {
  const out: Array<{ route: MethodRoute; reason: string; speculative: boolean }> = [];
  for (const r of k.routes) {
    if (r.retiredOn) continue;
    const v = appliesTo(r.applicability, j);
    if (v.applies) out.push({ route: r, reason: v.reason, speculative: v.speculative });
  }
  return out;
}

/**
 * Learn a route. **There is no cap, and no cap may be introduced.**
 *
 * 76 becomes 87 becomes 91 becomes 150. The version increments; nothing else
 * bounds it. `tests/method-knowledge.test.ts` asserts that adding an 88th route
 * to an 87-route store requires no change to any constant.
 */
export function learnRoute(
  k: MethodKnowledge,
  route: Omit<MethodRoute, "learnedAtVersion">,
  on: string,
): { knowledge: MethodKnowledge; version: number; duplicate: MethodRoute | null } {
  const duplicate = k.routes.find((r) => r.id === route.id) ?? null;
  if (duplicate) {
    // RULING 63: duplication is worse than a gap, and a session that builds a
    // branch which already existed has committed a defect reported as one.
    return { knowledge: k, version: k.version, duplicate };
  }
  const version = k.version + 1;
  return {
    knowledge: {
      version,
      updatedOn: on,
      routes: [...k.routes, { ...route, learnedAtVersion: version }],
    },
    version,
    duplicate: null,
  };
}

/**
 * A prior conclusion — an absence, a block, a dark body, a converged graph.
 *
 * These are what a newly learned route REOPENS. Each one records the method
 * version it was earned under, which is the whole mechanism: a conclusion
 * earned at v7 is re-examined against every route learned after v7.
 */
export interface PriorConclusion {
  id: string;
  kind: "ABSENCE" | "BLOCKED" | "DARK" | "CONVERGED";
  field: string;
  jurisdiction: Jurisdiction;
  earnedAtVersion: number;
  earnedOn: string;
  /** Set when a later route reopened it. */
  reopenedBy?: string;
  reopenedOn?: string;
}

export interface Reopening {
  conclusion: PriorConclusion;
  route: MethodRoute;
  why: string;
}

/**
 * Which prior conclusions does current knowledge reopen?
 *
 * **This is the function that makes RULING 178's last clause real.** A
 * conclusion earned under method version 76 does not retain "exhausted" status
 * if version 87 contains an applicable route that was never walked, and nobody
 * has to remember to check.
 *
 * A SPECULATIVE match reopens too. Reopening costs a re-walk; not reopening
 * costs a fact nobody finds, and only one of those is visible later.
 */
export function findReopenings(
  k: MethodKnowledge,
  conclusions: readonly PriorConclusion[],
): Reopening[] {
  const out: Reopening[] = [];
  for (const c of conclusions) {
    if (c.reopenedBy) continue;
    for (const r of k.routes) {
      if (r.retiredOn) continue;
      // Only routes learned AFTER the conclusion was earned can reopen it.
      // An earlier route was available when the conclusion was made, so it was
      // either walked or deliberately not — and re-litigating that would make
      // every conclusion permanently unstable.
      if (r.learnedAtVersion <= c.earnedAtVersion) continue;
      if (!r.fields.includes(c.field)) continue;
      const v = appliesTo(r.applicability, c.jurisdiction);
      if (!v.applies) continue;
      out.push({
        conclusion: c,
        route: r,
        why:
          `route ${r.id} entered project knowledge at v${r.learnedAtVersion}, after this ` +
          `${c.kind} was earned at v${c.earnedAtVersion}; ${v.reason}`,
      });
      break;
    }
  }
  return out;
}

export function applyReopenings(
  conclusions: PriorConclusion[],
  reopenings: readonly Reopening[],
  on: string,
): PriorConclusion[] {
  const byId = new Map(reopenings.map((r) => [r.conclusion.id, r]));
  return conclusions.map((c) => {
    const r = byId.get(c.id);
    // The old measurement is PRESERVED — `earnedAtVersion` and `earnedOn` stay.
    // Reopening adds a fact; it never erases the one it supersedes.
    return r ? { ...c, reopenedBy: r.route.id, reopenedOn: on } : c;
  });
}

export interface MethodIssue {
  id: string;
  rule: string;
  detail: string;
}

/**
 * The method validator. What it refuses is the list in the remediation brief,
 * plus the two the brief could not have known about until the manifest was read.
 */
export function validateKnowledge(
  k: MethodKnowledge,
  conclusions: readonly PriorConclusion[] = [],
): MethodIssue[] {
  const out: MethodIssue[] = [];
  const bad = (id: string, rule: string, detail: string) => out.push({ id, rule, detail });

  const seen = new Set<string>();
  for (const r of k.routes) {
    if (seen.has(r.id)) bad(r.id, "duplicate-route", "route id appears more than once");
    seen.add(r.id);

    if (!r.applicability) {
      bad(r.id, "missing-applicability", "route carries no applicability state");
      continue;
    }
    const provenStates = [
      ...new Set(r.outcomes.filter((o) => o.outcome === "YIELDED").map((o) => o.jurisdiction)),
    ];
    const over = overGeneralized(r.applicability, provenStates);
    if (over) bad(r.id, "over-generalized", over);

    if (r.learnedAtVersion > k.version) {
      bad(r.id, "version-ahead", `learnedAtVersion ${r.learnedAtVersion} exceeds store version ${k.version}`);
    }

    // A route that stopped working is RETAINED with jurisdiction and date. A
    // deleted route is one a later session rediscovers as new (RULING 63).
    if (r.retiredOn && !r.retiredReason) {
      bad(r.id, "retired-without-reason", "a retired route must carry its reason and date");
    }
    for (const sb of r.subBranches) {
      if (!sb.jurisdiction || !sb.failedOn) {
        bad(r.id, "subbranch-undated", "a failed inherited route records jurisdiction AND date");
      }
    }
  }

  // Every conclusion carries the method version it was earned under, or the
  // reopening machinery cannot see it at all.
  for (const c of conclusions) {
    if (typeof c.earnedAtVersion !== "number") {
      bad(c.id, "conclusion-without-version", `${c.kind} carries no method version`);
    }
  }

  // The load-bearing one: knowledge has grown past a conclusion and nothing
  // reopened it. Silence here is the failure mode RULING 178 names.
  const pending = findReopenings(k, conclusions);
  for (const p of pending) {
    bad(
      p.conclusion.id,
      "unreopened-conclusion",
      `${p.conclusion.kind} on ${p.conclusion.field} is still closed but ${p.why}`,
    );
  }

  return out;
}

/**
 * **There is no maximum number of routes, and this states it in code.**
 *
 * A constant here — `MAX_ROUTES`, or a fixed-length tuple, or a check that the
 * count matches a recorded number — would freeze the manifest. RULING 178 and
 * the non-final-manifest test both forbid it. This function exists so that a
 * later reader looking for the cap finds this comment instead of one.
 */
export function routeCount(k: MethodKnowledge): number {
  return k.routes.length;
}

export { appliesTo, unknownApplicability, type Applicability, type Jurisdiction };
