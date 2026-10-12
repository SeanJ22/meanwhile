/**
 * Cumulative project discovery knowledge. Routes are project knowledge, never a finished list, and a newly learned
 * route mechanically reopens prior conclusions it would have applied to.
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

/** Routes entering or amended after this version must declare claim classes; earlier ones report as unclassified. */
export const CLAIM_CLASS_REQUIRED_FROM_VERSION = 55;
export const CLAIM_CLASS_ADOPTED_ON = "2026-08-28";

/** What a route yielded in one jurisdiction on one date. */
export interface RouteOutcome {
  jurisdiction: string;
  /** ISO date. */
  walkedOn: string;
  rows: number;
  /** A route that returned zero is a walked route, never a broken one. */
  outcome: "YIELDED" | "ZERO" | "FAILED" | "BLOCKED";
  note?: string;
}

/** An inherited route that failed somewhere new; never deleted, so it is never rediscovered as new. */
export interface SubBranch {
  jurisdiction: string;
  failedOn: string;
  reason: string;
  /** The route id that replaced or supplemented it here, if one did. */
  replacedBy?: string;
}

/**
 * `RETRIEVAL`: names a retrieval mechanism. `REASONING_DISCIPLINE`: a way of checking work, applicable across routes.
 * Absent means unclassified; the populator writes only `RETRIEVAL`, and only where the record proves it.
 */
export const ROUTE_KINDS = ["RETRIEVAL", "REASONING_DISCIPLINE"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export interface MethodRoute {
  id: string;
  title: string;
  /** A0, A1, B, C. */
  tier: "A0" | "A1" | "B" | "C";
  /** Retrieval route or reasoning discipline; absent is reported as unclassified, never guessed. See `ROUTE_KINDS`. */
  kind?: RouteKind;
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
  /** What this route cost, in kinds rather than minutes, captured when learned. Absent means nobody recorded it, not zero. */
  effort?: RouteEffort;
  /** The assertions this entry makes, each classified and separately retractable (`lib/method/claims.ts`). */
  claims?: MethodClaim[];
}

/** Cost dimensions as classes rather than durations, so they can be recorded truthfully. */
export interface RouteEffort {
  /** What has to be redone, and how often, for the next jurisdiction. `PER_ZIP` is the expensive class. */
  repeats: "ONCE" | "PER_STATE" | "PER_COUNTY" | "PER_VENDOR" | "PER_ZIP";
  /** Whether a machine can walk this unattended from here; `HUMAN_ONLY` must never be hidden inside an average. */
  execution: "MACHINE" | "HUMAN_ONLY" | "MACHINE_AFTER_HUMAN_SETUP";
  /** Whether finding this route was new invention or reuse of a known shape. */
  discovery: "NEW_METHOD" | "REAPPLIED_KNOWN_METHOD";
  /** True when this route exists because a reader was being told something false, rather than a fact was missing. */
  readerIntegrityRepair?: boolean;
  /** What was actually observed, in the recorder's own words. Never a guess. */
  note?: string;
}

export interface MethodKnowledge {
  /** Increments whenever a route enters project knowledge; convergence records are stamped with it. */
  version: number;
  updatedOn: string | null;
  routes: MethodRoute[];
}

export function emptyKnowledge(): MethodKnowledge {
  return { version: 0, updatedOn: null, routes: [] };
}

/** Every applicable route, unprojected. Not a consumer surface: consumers use `projectMethodFor()`. */
export function applicableRoutesUnprojected(
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

/** Learn a route. There is no cap. */
export function learnRoute(
  k: MethodKnowledge,
  route: Omit<MethodRoute, "learnedAtVersion">,
  on: string,
): { knowledge: MethodKnowledge; version: number; duplicate: MethodRoute | null } {
  const duplicate = k.routes.find((r) => r.id === route.id) ?? null;
  if (duplicate) {
    // Duplication is worse than a gap: an existing branch is never rebuilt.
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

/** Record what a route did in one jurisdiction on one date. Idempotent by (jurisdiction, date, outcome). */
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
 * A jurisdictional failure: evidence that a route cannot work here, not that this attempt failed. Narrowing requires
 * the caller to say so and why; a transport, permission or tooling failure never narrows.
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
 * The portability a route has earned from its outcomes, conservatively: one success never narrows; `NATIONWIDE` needs
 * three states and `STATE_FAMILY` two, the same bars `overGeneralized` refuses; `ZERO`, `FAILED` and `BLOCKED` never
 * narrow; `UNKNOWN` is a valid resting state.
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
 * `REOPENED`: knowledge grew past an honestly earned conclusion. `WITHDRAWN` / `INVALIDATED`: the conclusion itself was
 * wrong; it closes nothing, and the route that produced it is untouched.
 */
export const CONCLUSION_STATUSES = ["EARNED", "REOPENED", "WITHDRAWN", "INVALIDATED"] as const;
export type ConclusionStatus = (typeof CONCLUSION_STATUSES)[number];

/** The statuses under which a conclusion is still closing an avenue. */
export const CLOSING_CONCLUSION_STATUSES: readonly ConclusionStatus[] = ["EARNED", "REOPENED"];

/** A prior conclusion, recording the method version it was earned under. */
export interface PriorConclusion {
  id: string;
  kind: "ABSENCE" | "BLOCKED" | "DARK" | "CONVERGED";
  field: string;
  jurisdiction: Jurisdiction;
  earnedAtVersion: number;
  earnedOn: string;
  /** Defaults to `EARNED`; an absent status means the conclusion is standing. */
  status?: ConclusionStatus;
  /** Set when a later route reopened it. */
  reopenedBy?: string;
  reopenedOn?: string;
}

/** Is this conclusion still closing an avenue? An absent status means yes. */
export function isClosing(c: PriorConclusion): boolean {
  return CLOSING_CONCLUSION_STATUSES.includes(c.status ?? "EARNED");
}

export interface Reopening {
  conclusion: PriorConclusion;
  route: MethodRoute;
  why: string;
}

/** Which prior conclusions current knowledge reopens; a speculative match reopens too. */
export function findReopenings(
  k: MethodKnowledge,
  conclusions: readonly PriorConclusion[],
): Reopening[] {
  const out: Reopening[] = [];
  for (const c of conclusions) {
    if (c.reopenedBy) continue;
    // A withdrawn or invalidated conclusion closes nothing, so nothing can reopen it.
    if (!isClosing(c)) continue;
    for (const r of k.routes) {
      if (r.retiredOn) continue;
      // Only routes learned after the conclusion was earned can reopen it.
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
    // The old measurement is preserved; reopening adds a fact.
    return r ? { ...c, status: "REOPENED" as ConclusionStatus, reopenedBy: r.route.id, reopenedOn: on } : c;
  });
}

export interface MethodIssue {
  id: string;
  rule: string;
  detail: string;
}

/** The method validator. */
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

    // `outcome.outcome` is a closed set: an unrecognised value would silently drop a route's evidence from `overGeneralized`.
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

    // `effort` fields are closed sets: an unrecognised value would silently drop a route out of the forecast's buckets.
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

    // `kind` is a closed set; absent is valid (unclassified).
    if (r.kind !== undefined && !(ROUTE_KINDS as readonly string[]).includes(r.kind)) {
      bad(
        r.id,
        "kind-value-off-the-closed-set",
        `kind is ${JSON.stringify(r.kind)}, which is none of ${ROUTE_KINDS.join(", ")} (absent is valid and means UNCLASSIFIED)`,
      );
    }

    // A route that stopped working is retained with jurisdiction and date.
    if (r.retiredOn && !r.retiredReason) {
      bad(r.id, "retired-without-reason", "a retired route must carry its reason and date");
    }
    for (const sb of r.subBranches) {
      if (!sb.jurisdiction || !sb.failedOn) {
        bad(r.id, "subbranch-undated", "a failed inherited route records jurisdiction AND date");
      }
    }

    /*
     * A route that entered after the floor version, or carries a sub-branch dated strictly after adoption, must declare its
     * claim classes. Only sub-branches whose `failedOn` parses as an ISO date count as dated amendments.
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
    // `status` is a closed set: an unrecognised value would fall out of the reopening sweep.
    if (c.status !== undefined && !(CONCLUSION_STATUSES as readonly string[]).includes(c.status)) {
      bad(
        c.id,
        "conclusion-status-off-the-closed-set",
        `status is ${JSON.stringify(c.status)}, which is none of ${CONCLUSION_STATUSES.join(", ")}`,
      );
    }
  }

  // Knowledge has grown past a conclusion and nothing reopened it.
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

/** There is no maximum number of routes. */
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
