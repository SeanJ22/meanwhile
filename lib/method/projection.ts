/**
 * What a worker inherits from the method store: route identity and applicability, class A and B assertions, outcomes
 * as observation tuples, and only current, inheritable class C and D assertions. Everything else a C or D says is
 * moved to `withheld` by id with its reason. No raw prose field is carried; legacy unclassified entries are a named
 * gap, and their prose is reachable only through `readNonAuthoritativeProse()`.
 */

import {
  CLAIM_CLASS_LETTER,
  currentTruthFor,
  findClaim,
  staleDependents,
  type ClaimClass,
  type ClaimProvenance,
  type ClaimValidation,
  type MethodClaim,
} from "./claims.ts";
import {
  applicableRoutesUnprojected,
  type MethodKnowledge,
  type MethodRoute,
} from "./knowledge.ts";
import type { Jurisdiction, PortabilityClass } from "./portability.ts";

/** The named gap for an entry nobody has classified; a constant so no consumer can reword it into a finding. */
export const LEGACY_UNCLASSIFIED_GAP =
  "ROUTE KNOWN. ITS SUBSTANTIVE LEGACY PROSE IS NOT YET CLASSIFIED AND IS NOT INHERITED AS A CONCLUSION.";

/** The two classes that propagate a conclusion into a later session's reasoning. */
const SUBSTANTIVE_CLASSES: readonly ClaimClass[] = ["COVERAGE_CLAIM", "DERIVED_CONCLUSION"];

/** Why a substantive assertion is not being inherited, each reported by name. */
export const WITHHOLDING_REASONS = [
  /** Carries a retraction record of any kind: RETRACTED, SUPERSEDED, CORRECTED, CONTRADICTED, REOPENED. */
  "WITHDRAWN",
  /** `validation.state === "CONTRADICTED"`, whether or not a retraction was also filed. */
  "CONTRADICTED",
  /** Rests on a withdrawn assertion and has been neither withdrawn nor revalidated since. */
  "RESTS_ON_WITHDRAWN",
  /** A C or D with no provenance or no validation state is a belief, not authority. */
  "UNEVIDENCED",
  /** The route itself was retired. The claims on it are history, not instruction. */
  "ROUTE_RETIRED",
] as const;
export type WithholdingReason = (typeof WITHHOLDING_REASONS)[number];

/** Route identity and applicability. The fields that hold reasoning are absent by construction. */
export interface ProjectedRouteIdentity {
  id: string;
  title: string;
  tier: MethodRoute["tier"];
  fields: string[];
  learnedAtVersion: number;
  learnedOn: string | null;
  portability: PortabilityClass;
  /** The dimensions that narrow the route, typed. Empty means unconstrained. */
  states: string[];
  governmentTypes: string[];
  platforms: string[];
  publishers: string[];
  /** Why it applies HERE, from `appliesTo` — derived, never prose from the store. */
  appliesBecause: string;
  /** True when the offer rests on UNKNOWN portability rather than on evidence. */
  speculative: boolean;
}

/** A walk as a tuple; the free-text `note` is deliberately absent, since a tuple cannot carry a conclusion. */
export interface ProjectedObservation {
  routeId: string;
  jurisdiction: string;
  walkedOn: string;
  rows: number;
  disposition: MethodRoute["outcomes"][number]["outcome"];
}

/** A typed, declared, class-carrying assertion a worker may act on. */
export interface ProjectedAssertion {
  id: string;
  routeId: string;
  class: ClaimClass;
  /** The brief's letter, for reports that speak that language. */
  classLetter: "A" | "B" | "C" | "D";
  statement: string;
  /** Present for C and D, where the validator requires it. */
  provenance?: ClaimProvenance;
  validation?: ClaimValidation;
}

/** A substantive assertion that is not current, its text under `statementNotCurrent` so it is never collected as current. */
export interface WithheldAssertion {
  id: string;
  routeId: string;
  class: ClaimClass;
  reason: WithholdingReason;
  why: string;
  statementNotCurrent: string;
  /** The claim carrying the corrected current truth, when one resolves. */
  correctedBy: string | null;
  correctedStatement: string | null;
}

/** One route, as a worker inherits it. */
export interface ProjectedRoute {
  identity: ProjectedRouteIdentity;
  /** Declared class A assertions. */
  existence: ProjectedAssertion[];
  /** Recorded walks, as tuples. */
  observations: ProjectedObservation[];
  /** Declared class B assertions. */
  observationAssertions: ProjectedAssertion[];
  /** Declared class C and D assertions that are current AND inheritable. */
  substantive: ProjectedAssertion[];
  /** True when this entry declared no class; its prose may hold an undeclared conclusion, so none of it is projected. */
  legacyUnclassified: boolean;
  /** `LEGACY_UNCLASSIFIED_GAP` when the above is true, otherwise `null`. */
  namedGap: string | null;
}

export interface ProjectionCounts {
  routesInherited: number;
  routesSpeculative: number;
  routesLegacyUnclassified: number;
  observations: number;
  existenceAssertions: number;
  observationAssertions: number;
  substantiveAssertions: number;
  withheld: number;
}

export interface MethodProjection {
  jurisdiction: Jurisdiction;
  routes: ProjectedRoute[];
  /** Every substantive assertion NOT inherited, by id, with the reason named. */
  withheld: WithheldAssertion[];
  counts: ProjectionCounts;
}

function assertion(routeId: string, c: MethodClaim): ProjectedAssertion {
  return {
    id: c.id,
    routeId,
    class: c.class,
    classLetter: CLAIM_CLASS_LETTER[c.class],
    statement: c.statement,
    ...(c.provenance ? { provenance: c.provenance } : {}),
    ...(c.validation ? { validation: c.validation } : {}),
  };
}

function withheldFor(
  k: MethodKnowledge,
  routeId: string,
  c: MethodClaim,
  reason: WithholdingReason,
  why: string,
): WithheldAssertion {
  // One definition of "what corrected this": reuse `currentTruthFor`.
  const truth = currentTruthFor(k, c.id);
  const corrected = truth.status === "SUPERSEDED" ? truth.claim : null;
  return {
    id: c.id,
    routeId,
    class: c.class,
    reason,
    why,
    statementNotCurrent: c.statement,
    correctedBy: corrected?.id ?? null,
    correctedStatement: corrected?.statement ?? null,
  };
}

/** Whether this substantive assertion is inheritable as current instruction; null when it may be inherited. */
function withholdingReason(
  c: MethodClaim,
  staleIds: ReadonlySet<string>,
): { reason: WithholdingReason; why: string } | null {
  if (c.retraction) {
    return {
      reason: "WITHDRAWN",
      why:
        `${c.retraction.kind} on ${c.retraction.on}: ${c.retraction.why} ` +
        `WHAT SURVIVES: ${c.retraction.survives}`,
    };
  }
  if (c.validation?.state === "CONTRADICTED") {
    return {
      reason: "CONTRADICTED",
      why:
        `contradicted on ${c.validation.on} by ${c.validation.by}` +
        (c.validation.note ? `: ${c.validation.note}` : "") +
        " — a contradicted assertion is kept and is never taught",
    };
  }
  if (staleIds.has(c.id)) {
    return {
      reason: "RESTS_ON_WITHDRAWN",
      why:
        "rests on an assertion that has been withdrawn, and has been neither withdrawn nor " +
        "revalidated since — it is still teaching and must not",
    };
  }
  if (!c.provenance || !c.validation) {
    return {
      reason: "UNEVIDENCED",
      why:
        `a ${c.class} propagates into later sessions and is inherited only with structured ` +
        `provenance AND a stated validation; missing: ` +
        `${[!c.provenance ? "provenance" : null, !c.validation ? "validation" : null].filter(Boolean).join(", ")}`,
    };
  }
  return null;
}

/** The method-inheritance read path; every consumer asking what a jurisdiction inherits calls this. */
export function projectMethodFor(k: MethodKnowledge, j: Jurisdiction): MethodProjection {
  const staleIds = new Set(staleDependents(k).map((f) => f.dependent));
  const applicable = new Map(
    applicableRoutesUnprojected(k, j).map((a) => [a.route.id, a]),
  );

  const routes: ProjectedRoute[] = [];
  const withheld: WithheldAssertion[] = [];

  for (const r of k.routes) {
    const claims = r.claims ?? [];

    // A retired route's substantive claims are named as withheld rather than dropped.
    if (r.retiredOn) {
      for (const c of claims) {
        if (!SUBSTANTIVE_CLASSES.includes(c.class)) continue;
        withheld.push(
          withheldFor(
            k,
            r.id,
            c,
            "ROUTE_RETIRED",
            `route ${r.id} was retired on ${r.retiredOn}`,
          ),
        );
      }
      continue;
    }

    const hit = applicable.get(r.id);
    if (!hit) continue;

    const substantive: ProjectedAssertion[] = [];
    for (const c of claims) {
      if (!SUBSTANTIVE_CLASSES.includes(c.class)) continue;
      const refusal = withholdingReason(c, staleIds);
      if (refusal) withheld.push(withheldFor(k, r.id, c, refusal.reason, refusal.why));
      else substantive.push(assertion(r.id, c));
    }

    routes.push({
      identity: {
        id: r.id,
        title: r.title,
        tier: r.tier,
        fields: [...r.fields],
        learnedAtVersion: r.learnedAtVersion,
        learnedOn: r.learnedOn,
        portability: r.applicability.portability,
        states: [...r.applicability.states],
        governmentTypes: [...r.applicability.governmentTypes],
        platforms: [...r.applicability.platforms],
        publishers: [...r.applicability.publishers],
        appliesBecause: hit.reason,
        speculative: hit.speculative,
      },
      existence: claims.filter((c) => c.class === "ROUTE_EXISTENCE").map((c) => assertion(r.id, c)),
      observations: r.outcomes.map((o) => ({
        routeId: r.id,
        jurisdiction: o.jurisdiction,
        walkedOn: o.walkedOn,
        rows: o.rows,
        disposition: o.outcome,
      })),
      observationAssertions: claims
        .filter((c) => c.class === "ROUTE_OUTCOME")
        .map((c) => assertion(r.id, c)),
      substantive,
      legacyUnclassified: claims.length === 0,
      namedGap: claims.length === 0 ? LEGACY_UNCLASSIFIED_GAP : null,
    });
  }

  return {
    jurisdiction: j,
    routes,
    withheld,
    counts: {
      routesInherited: routes.length,
      routesSpeculative: routes.filter((r) => r.identity.speculative).length,
      routesLegacyUnclassified: routes.filter((r) => r.legacyUnclassified).length,
      observations: routes.reduce((n, r) => n + r.observations.length, 0),
      existenceAssertions: routes.reduce((n, r) => n + r.existence.length, 0),
      observationAssertions: routes.reduce((n, r) => n + r.observationAssertions.length, 0),
      substantiveAssertions: routes.reduce((n, r) => n + r.substantive.length, 0),
      withheld: withheld.length,
    },
  };
}

/** Every substantive sentence a worker inheriting this projection may act on. */
export function substantiveAssertions(p: MethodProjection): ProjectedAssertion[] {
  return p.routes.flatMap((r) => r.substantive);
}

/** Ids only, for a report or an assertion that does not care about the text. */
export function inheritedRouteIds(p: MethodProjection): string[] {
  return p.routes.map((r) => r.identity.id);
}

/** Does this projection offer this route at all? */
export function projectionHasRoute(p: MethodProjection, routeId: string): boolean {
  return p.routes.some((r) => r.identity.id === routeId);
}

/** The routes whose substantive prose nobody has classified, with the named gap. */
export function legacyUnclassifiedRoutes(
  p: MethodProjection,
): Array<{ id: string; namedGap: string }> {
  return p.routes
    .filter((r) => r.legacyUnclassified)
    .map((r) => ({ id: r.identity.id, namedGap: r.namedGap as string }));
}

/** The prose, which is not authority: for classifying a legacy entry, quoting a route, or an audit. */
export interface NonAuthoritativeProse {
  routeId: string;
  /** Literal `false`. It is a field so that a consumer can be made to see it. */
  authoritative: false;
  warning: string;
  applicabilityNote: string;
  origin: string;
  outcomeNotes: string[];
  subBranchReasons: string[];
  retiredReason: string | null;
}

export function readNonAuthoritativeProse(
  k: MethodKnowledge,
  routeId: string,
): NonAuthoritativeProse | null {
  const r = k.routes.find((x) => x.id === routeId);
  if (!r) return null;
  return {
    routeId,
    authoritative: false,
    warning:
      "NOT AUTHORITY. This is unclassified free text from the method store. It may hold a " +
      "coverage claim or a conclusion about a government that nobody declared, evidenced or " +
      "retracted. Classify it before any later session is allowed to act on it.",
    applicabilityNote: r.applicability.note,
    origin: r.origin,
    outcomeNotes: r.outcomes.map((o) => o.note ?? "").filter((n) => n.length > 0),
    subBranchReasons: r.subBranches.map((b) => b.reason),
    retiredReason: r.retiredReason ?? null,
  };
}

/** What a consumer is handed when it asks about one assertion by id: the current truth for it. */
export function inheritedTruthFor(
  k: MethodKnowledge,
  id: string,
): { id: string; inheritable: boolean; currentStatement: string | null; why: string } {
  const t = currentTruthFor(k, id);
  const located = findClaim(k, id);
  const stale = new Set(staleDependents(k).map((f) => f.dependent));

  if (t.status === "CURRENT" && located) {
    const refusal = SUBSTANTIVE_CLASSES.includes(located.claim.class)
      ? withholdingReason(located.claim, stale)
      : null;
    if (refusal) {
      return { id, inheritable: false, currentStatement: null, why: `${refusal.reason}: ${refusal.why}` };
    }
  }
  return {
    id,
    inheritable: t.status === "CURRENT" && Boolean(t.claim),
    currentStatement: t.claim?.statement ?? null,
    why: t.why,
  };
}
