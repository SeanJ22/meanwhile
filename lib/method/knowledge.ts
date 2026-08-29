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
  type MethodClaim,
  isIsoDate,
  validateClaims,
} from "./claims.ts";
import {
  type Applicability,
  type Jurisdiction,
  appliesTo,
  overGeneralized,
  unknownApplicability,
  type PortabilityClass,
} from "./portability.ts";

/**
 * **WHEN CLAIM CLASSES BECAME REQUIRED.** (2026-08-28.)
 *
 * The store held 116 routes at method version 55 when the four claim classes
 * were adopted, and backfilling 116 entries by re-deriving what each of their
 * paragraphs was asserting would be a large act of guessing — precisely the
 * thing the classes exist to prevent. So the requirement is FORWARD, and the
 * floor is stated as the version the store stood at:
 *
 *   - a route that ENTERS project knowledge after v55 declares its classes;
 *   - a route AMENDED after the adoption date — a dated sub-branch on or after
 *     it — declares its classes, because an amendment is exactly the moment
 *     somebody decided part of an entry was wrong;
 *   - the 116 that came before are reported as UNCLASSIFIED, by number, and a
 *     consumer is told that unclassified means nobody declared a class, NOT
 *     that the entry contains no conclusion.
 */
export const CLAIM_CLASS_REQUIRED_FROM_VERSION = 55;
export const CLAIM_CLASS_ADOPTED_ON = "2026-08-28";

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
  /**
   * **WHAT THIS ROUTE COST, IN KINDS RATHER THAN IN MINUTES** (2026-08-27).
   *
   * A scale forecast — what does the next thousand ZIPs take? — needs to know
   * which work is paid for ONCE and which is paid for per state, per county,
   * per vendor or per ZIP. The previous session could not produce that forecast
   * because the inputs were never captured, and the wrong repair would be to
   * reconstruct them afterwards from commit timestamps: a commit time measures
   * when someone typed, not what the work was, and a plausible number here
   * would be a fabrication with a decimal point on it.
   *
   * So nothing is estimated retrospectively. This is CAPTURED AT THE MOMENT A
   * ROUTE IS LEARNED, it is optional, and an absent `effort` means exactly what
   * it says: nobody recorded it, which is different from zero.
   *
   * `applicability.portability` already answers "would this route work
   * elsewhere". This answers the question portability cannot: **what did
   * getting it cost, and can a machine do it again without a person.**
   */
  effort?: RouteEffort;
  /**
   * **THE ASSERTIONS THIS ENTRY MAKES, EACH CLASSIFIED AND SEPARATELY
   * RETRACTABLE.** (2026-08-28. See `lib/method/claims.ts`.)
   *
   * A route is not one claim. It exists (A), it did something somewhere (B),
   * and it is often read as saying something about coverage (C) or about the
   * public record itself (D). Before this field those four lived together in
   * `applicability.note` at one authority, so withdrawing the false part meant
   * rewriting the paragraph or deleting the route — and the Pima case proved
   * that a false D and a perfectly valid A can be written in the same sentence.
   *
   * Optional on the type because 116 routes predate it and inventing classes
   * for them would be the guessing this field exists to stop. **Required by the
   * validator for new and amended entries**, which is where the rule can be
   * enforced without a fabrication.
   */
  claims?: MethodClaim[];
}

/**
 * The cost dimensions a scale forecast actually needs, each a CLASS rather than
 * a duration, because a class can be recorded truthfully from memory and a
 * duration cannot.
 */
export interface RouteEffort {
  /**
   * What has to be redone, and how often, for the next jurisdiction.
   *
   * - `ONCE` — generic work, reused everywhere. An adapter, a parser, a rule.
   * - `PER_STATE` — a state's own law, portal or vocabulary.
   * - `PER_COUNTY` — a county's own systems.
   * - `PER_VENDOR` — a platform (Legistar, CivicClerk, Apptegy, Granicus).
   * - `PER_ZIP` — genuinely unique to one place. The expensive class, and the
   *   one a forecast most needs an honest count of.
   */
  repeats: "ONCE" | "PER_STATE" | "PER_COUNTY" | "PER_VENDOR" | "PER_ZIP";
  /**
   * Can a machine walk this unattended from here?
   *
   * `HUMAN_ONLY` is the one that does not scale and must not be hidden inside
   * an average — a records request, a phone call, a CAPTCHA, a page that only
   * renders to a person. A route can be `MACHINE` now and have been
   * `HUMAN_ONLY` to discover, which is what `discovery` records separately.
   */
  execution: "MACHINE" | "HUMAN_ONLY" | "MACHINE_AFTER_HUMAN_SETUP";
  /** Whether finding this route was new invention or reuse of a known shape. */
  discovery: "NEW_METHOD" | "REAPPLIED_KNOWN_METHOD";
  /**
   * True when this route exists because a reader was being told something
   * false, rather than because a fact was missing. Integrity repair is not
   * collection work and averaging the two together describes neither.
   */
  readerIntegrityRepair?: boolean;
  /** What was actually observed, in the recorder's own words. Never a guess. */
  note?: string;
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
 * Record what a route actually did, in one jurisdiction, on one date.
 *
 * ## Why this exists
 *
 * The migration set all 61 inherited routes to `UNKNOWN` portability, which was
 * the honest call — `expectedToTravel` is an EXPECTATION and the manifest held
 * no outcome records. But nothing wrote outcomes either, so every route could
 * have stayed `UNKNOWN` forever and "speculative" would have become permanent
 * noise rather than a temporary state evidence resolves.
 *
 * **Idempotent by (jurisdiction, date, outcome).** A session that re-processes
 * the same walk must not deepen the evidence for it — that would let a route
 * earn `NATIONWIDE` by being re-read three times in one state.
 */
export function recordRouteOutcome(
  k: MethodKnowledge,
  routeId: string,
  outcome: RouteOutcome,
): { knowledge: MethodKnowledge; recorded: boolean; reason: string } {
  const route = k.routes.find((r) => r.id === routeId);
  if (!route) {
    return { knowledge: k, recorded: false, reason: `no route ${routeId} in project knowledge` };
  }
  const duplicate = route.outcomes.some(
    (o) =>
      o.jurisdiction === outcome.jurisdiction &&
      o.walkedOn === outcome.walkedOn &&
      o.outcome === outcome.outcome,
  );
  if (duplicate) {
    return {
      knowledge: k,
      recorded: false,
      reason: `already recorded: ${routeId} ${outcome.outcome} in ${outcome.jurisdiction} on ${outcome.walkedOn}`,
    };
  }
  return {
    knowledge: {
      ...k,
      routes: k.routes.map((r) =>
        r.id === routeId ? { ...r, outcomes: [...r.outcomes, outcome] } : r,
      ),
    },
    recorded: true,
    reason: `recorded ${outcome.outcome} for ${routeId} in ${outcome.jurisdiction}`,
  };
}

/**
 * A jurisdictional failure — evidence that a route cannot work HERE, as opposed
 * to evidence that this attempt did not work.
 *
 * **The distinction is the whole of RULING 182 applied to method knowledge.** A
 * timeout, a TLS refusal, a CAPTCHA and a missing adapter are all facts about
 * the attempt. Narrowing a route's applicability on any of them would convert a
 * transport failure into a claim about a government — the same collapse that
 * silently removed two states from this project on 2026-08-26.
 *
 * So narrowing requires the caller to SAY the failure was jurisdictional, and
 * to say why. That is a sentence somebody has to write, on purpose.
 */
export interface JurisdictionalFailure {
  jurisdiction: string;
  why: string;
}

export interface EarnedPortability {
  portability: PortabilityClass;
  states: string[];
  /** Why this class, from the evidence. Always stated. */
  because: string;
  changed: boolean;
}

/**
 * Derive the portability a route has EARNED from its recorded outcomes.
 *
 * Deliberately conservative, and asymmetric on purpose:
 *
 * - **One success does NOT narrow to `STATE_SPECIFIC`.** A route that worked in
 *   New Hampshire is not thereby proven to fail in Arizona, and narrowing it
 *   would stop it being offered there — the opposite of *inherit everything*.
 *   It stays `UNKNOWN`, which still inherits everywhere, marked speculative.
 * - **Widening needs breadth**: three distinct states for `NATIONWIDE`, two for
 *   `STATE_FAMILY`. Those are the same bars `overGeneralized` refuses below, so
 *   what is earned here can never be what is refused there.
 * - **`ZERO`, `FAILED` and `BLOCKED` never narrow.** A zero-yield walk is
 *   knowledge (RULING 88) and a blocked one is a fact about a wall.
 * - **`UNKNOWN` is a permanent-valid resting state.** The goal is not to drive
 *   it to zero; it is to make learning possible when evidence is earned.
 */
export function earnedPortability(
  route: MethodRoute,
  jurisdictionalFailures: readonly JurisdictionalFailure[] = [],
): EarnedPortability {
  const current = route.applicability.portability;
  const proven = [
    ...new Set(route.outcomes.filter((o) => o.outcome === "YIELDED").map((o) => o.jurisdiction)),
  ].sort();

  if (proven.length >= 3) {
    return {
      portability: "NATIONWIDE",
      states: proven,
      because: `YIELDED in ${proven.length} distinct jurisdictions: ${proven.join(", ")}`,
      changed: current !== "NATIONWIDE",
    };
  }
  if (proven.length === 2) {
    return {
      portability: "STATE_FAMILY",
      states: proven,
      because: `YIELDED in 2 distinct jurisdictions: ${proven.join(", ")}`,
      changed: current !== "STATE_FAMILY",
    };
  }

  // Narrowing happens ONLY on declared jurisdictional failure, never on a
  // transport, permission or tooling failure.
  const failedHere = jurisdictionalFailures.map((f) => f.jurisdiction);
  if (proven.length === 1 && failedHere.length > 0) {
    return {
      portability: "STATE_SPECIFIC",
      states: proven,
      because:
        `YIELDED in ${proven[0]} and declared jurisdictionally inapplicable in ` +
        `${failedHere.join(", ")}: ${jurisdictionalFailures.map((f) => f.why).join("; ")}`,
      changed: current !== "STATE_SPECIFIC",
    };
  }

  return {
    portability: "UNKNOWN",
    states: proven,
    because:
      proven.length === 1
        ? `YIELDED in ${proven[0]} only — one success does not prove it fails elsewhere, so it keeps inheriting`
        : `${route.outcomes.length} outcome(s) recorded, none establishing reach`,
    changed: false,
  };
}

/** Apply earned portability to the whole store. Returns what actually moved. */
export function applyEarnedPortability(
  k: MethodKnowledge,
  failures: Record<string, JurisdictionalFailure[]> = {},
): { knowledge: MethodKnowledge; moved: Array<{ id: string; from: PortabilityClass; to: PortabilityClass; because: string }> } {
  const moved: Array<{ id: string; from: PortabilityClass; to: PortabilityClass; because: string }> = [];
  const routes = k.routes.map((r) => {
    const earned = earnedPortability(r, failures[r.id] ?? []);
    if (!earned.changed) return r;
    moved.push({
      id: r.id,
      from: r.applicability.portability,
      to: earned.portability,
      because: earned.because,
    });
    return {
      ...r,
      applicability: {
        ...r.applicability,
        portability: earned.portability,
        states: earned.states,
      },
    };
  });
  return { knowledge: { ...k, routes }, moved };
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

    /*
     * **THE SAME HOLE, ONE FIELD OVER.** (2026-08-28.)
     *
     * The `effort` repair below closed a closed-set that nothing checked, and
     * `outcome.outcome` had exactly the same hole. This session wrote three
     * routes carrying `WORKED` — which is not a member of the set — every one
     * of them landed in the canonical store, and `method:check` reported
     * PASSED. `tsc` caught it afterwards, for an unrelated reason, which is
     * the identical sequence the `effort` note records.
     *
     * It is not cosmetic. `YIELDED` is the value `provenStates` filters on
     * three lines above and the value `overGeneralized` reasons from, so an
     * unrecognised outcome silently removes a route's evidence from the
     * over-generalisation check — the guard that stops a route claiming a
     * portability it has not earned.
     *
     * Fixing one instance of a class and leaving the class open is how the
     * same defect gets found twice.
     */
    const OUTCOMES = ["YIELDED", "ZERO", "FAILED", "BLOCKED"];
    for (const o of r.outcomes) {
      if (!OUTCOMES.includes(o.outcome as string)) {
        bad(
          r.id,
          "outcome-value-off-the-closed-set",
          `outcome is ${JSON.stringify(o.outcome)}, which is none of ${OUTCOMES.join(", ")}`,
        );
      }
      if (!o.jurisdiction || !o.walkedOn) {
        bad(r.id, "outcome-undated", "every outcome records the jurisdiction it was walked in AND the date");
      }
    }

    /*
     * **A DECLARED TYPE IS NOT A WRITE PATH.** (2026-08-27.)
     *
     * `effort` has had a closed set of values on all three of its fields since
     * it was declared, and nothing ever checked them. This session wrote four
     * routes carrying `PER_SOURCE`, `AUTOMATED` and `KNOWN_METHOD` — none of
     * which is a member of any of the three sets — and every one of them landed
     * in the canonical store while `method:check` reported PASSED. It was `tsc`
     * that caught it, minutes later and for an unrelated reason.
     *
     * That is the shape of defect this repository keeps finding: a guard that
     * is green because it never looked. A `repeats` value outside the set is
     * not cosmetic — the effort forecast buckets on it, so an unrecognised
     * value silently drops a route out of whichever bucket a reader is
     * counting, and the forecast reports the project as cheaper than it is.
     */
    if (r.effort) {
      const sets = {
        repeats: ["ONCE", "PER_STATE", "PER_COUNTY", "PER_VENDOR", "PER_ZIP"],
        execution: ["MACHINE", "HUMAN_ONLY", "MACHINE_AFTER_HUMAN_SETUP"],
        discovery: ["NEW_METHOD", "REAPPLIED_KNOWN_METHOD"],
      } as const;
      for (const [field, allowed] of Object.entries(sets)) {
        const value = (r.effort as unknown as Record<string, unknown>)[field];
        if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
          bad(
            r.id,
            "effort-value-off-the-closed-set",
            `effort.${field} is ${JSON.stringify(value)}, which is none of ${allowed.join(", ")}`,
          );
        }
      }
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

    /*
     * **A NEW OR AMENDED ENTRY DECLARES WHAT IT IS ASSERTING.** (2026-08-28.)
     *
     * Two mechanical triggers, and neither one requires a person to remember:
     *
     *   NEW      — the route entered after the floor version.
     *   AMENDED  — the route carries a sub-branch dated AFTER adoption, which
     *              is the store's existing record of "somebody decided part of
     *              this was wrong". That is exactly the moment the class
     *              matters, because it is the moment a reader has to know
     *              whether what changed was the route, its outcome, a coverage
     *              claim, or a conclusion about a government.
     *
     * The boundary is STRICTLY after the adoption date, because a rule cannot
     * demand a class of an amendment written before the rule existed, and
     * everything written on adoption day was written before it existed. The two
     * entries amended that day — the Pima pair — are classified anyway, by the
     * amendment in `lib/method/pima-claim-classes.ts`, which is the worked
     * example rather than an exemption.
     *
     * The amendment trigger reads only sub-branches whose `failedOn` PARSES as
     * an ISO date. Thirteen legacy sub-branches carry prose in that field (the
     * jurisdiction, date, reason and successor were written into each other's
     * slots before this store had a writer), and an unparseable date is not a
     * dated amendment. Those are counted and named by `method:check` rather
     * than silently swept into a rule they cannot answer.
     */
    const claims = r.claims ?? [];
    if (claims.length === 0) {
      const amendedAfterAdoption = r.subBranches.some(
        (sb) => isIsoDate(sb.failedOn) && sb.failedOn > CLAIM_CLASS_ADOPTED_ON,
      );
      if (r.learnedAtVersion > CLAIM_CLASS_REQUIRED_FROM_VERSION) {
        bad(
          r.id,
          "claim-class-required-for-new-route",
          `entered project knowledge at v${r.learnedAtVersion}, after claim classes were adopted at ` +
            `v${CLAIM_CLASS_REQUIRED_FROM_VERSION}, and declares no claim class`,
        );
      } else if (amendedAfterAdoption) {
        bad(
          r.id,
          "claim-class-required-for-amendment",
          `materially amended on or after ${CLAIM_CLASS_ADOPTED_ON} and still declares no claim class — ` +
            `an amendment must say whether what changed was the route, an outcome, a coverage claim or a conclusion`,
        );
      }
    }
  }

  // Everything the claim layer refuses: provenance required for C and D,
  // closed sets, declared dependency edges, and the stale-dependent flag.
  for (const i of validateClaims(k)) bad(i.id, i.rule, i.detail);

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

export {
  CLAIM_CLASSES,
  CLAIM_CLASS_LETTER,
  PROVENANCE_REQUIRED_CLASSES,
  allClaims,
  attachClaims,
  classificationCoverage,
  currentTruthFor,
  findClaim,
  findDependencyFlags,
  isIsoDate,
  readCurrentMethod,
  retractClaim,
  staleDependents,
  validateClaims,
  type ClaimClass,
  type ClaimProvenance,
  type ClaimRetraction,
  type ClaimValidation,
  type DependencyFlag,
  type MethodClaim,
} from "./claims.ts";
