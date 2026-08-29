/**
 * **WHAT A WORKER INHERITS — THE ONE CONSUMER SURFACE.** (2026-08-28.)
 *
 * `lib/method/claims.ts` gave every assertion in the method store its own
 * record, its own class and its own retraction. That was necessary and it was
 * not sufficient, because nothing made the consumers USE it.
 *
 * ## The defect this module closes, exactly
 *
 * `inheritedRoutes()` returned raw `MethodRoute` objects, and every consumer of
 * method inheritance — `pnpm method:prove`, `pnpm descent:handoff` — took them
 * and read them. A `MethodRoute` carries four prose fields that nobody
 * classified and nothing retracts:
 *
 *   - `applicability.note`  — the paragraph a route's whole lesson lives in
 *   - `origin`              — how it was conceived, which is often a conclusion
 *   - `outcomes[].note`     — the walk's own words
 *   - `subBranches[].reason` — the supersession record's own words
 *
 * The Pima case put a FALSE derived conclusion in the first of those and a
 * FALSE coverage claim in the third, and both were typed, withdrawn and
 * superseded on 2026-08-28 — in `claims`, which the consumers never opened. So
 * the retraction machinery worked perfectly and the withdrawn sentence carried
 * on being inherited anyway, out of a field one struct over. **A correction that
 * the read path does not read is not a correction.**
 *
 * And 112 of 116 entries predate claim classes entirely. Reporting that number
 * is honest. Letting those 112 paragraphs act as inherited SUBSTANTIVE authority
 * — while the four classified ones are carefully filtered — is not, and it is
 * the larger half of the hole.
 *
 * ## What this module projects, and the one rule behind all of it
 *
 * **A CONSUMER MUST NOT HAVE TO READ PROSE TO KNOW WHAT IT INHERITS.** So the
 * projected type does not carry the raw prose fields at all. What it carries is:
 *
 *   1. **Route identity and applicability** — id, title, tier, fields,
 *      portability, the dimensions that narrow it, and whether the offer here is
 *      speculative. That is what "this route exists and may apply to you" means
 *      and it survives any conclusion drawn from the route being wrong.
 *   2. **Declared `ROUTE_EXISTENCE` (class A) assertions**, as typed statements.
 *   3. **Outcomes as OBSERVATIONS** — the tuple (jurisdiction, date, rows,
 *      disposition). An observation inherits as an observation. Its free-text
 *      `note` does NOT, because that is precisely the slot the false
 *      "complete for the window" sentence was written into.
 *   4. **Declared `ROUTE_OUTCOME` (class B) assertions**, as typed statements.
 *   5. **Only CURRENT, INHERITABLE class C `COVERAGE_CLAIM` and class D
 *      `DERIVED_CONCLUSION` assertions** — the two classes that propagate as
 *      reasons for a later session to stop looking.
 *
 * Everything a C or D says that is retracted, corrected, superseded,
 * contradicted, unprovenanced, or resting on something withdrawn is moved to
 * `withheld` — by id, with the reason named, and with its text under the field
 * name `statementNotCurrent` so that a consumer flattening `.statement` across
 * the projection cannot pick it up by accident.
 *
 * ## Legacy entries: a named gap, never a promotion
 *
 * An entry that declared no class is projected as EXACTLY this and no more:
 *
 *   > route known; substantive legacy prose NOT YET CLASSIFIED as an inherited
 *   > conclusion
 *
 * carried as `legacyUnclassified: true` and the `namedGap` string. Its prose is
 * not emitted as a claim, not summarised into one, and not offered as one. It is
 * reachable — deliberately, because it is real knowledge somebody wrote — only
 * through `readNonAuthoritativeProse()`, whose name is the warning and whose
 * return value says `authoritative: false` in a field.
 *
 * This is the same rule the root constitution states for readers, applied to
 * the workers: **a null renders as its NAMED GAP, and the name says whose gap it
 * is.** "Nobody has classified this yet" is a fact about US. It is not a fact
 * about the route, and it is certainly not a licence to read the paragraph as
 * settled.
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

/**
 * The named gap for an entry nobody has classified.
 *
 * It is a constant rather than a sentence built at each call site so that a test
 * can assert on it, a report can print it, and no consumer can quietly reword it
 * into something that sounds like a finding.
 */
export const LEGACY_UNCLASSIFIED_GAP =
  "ROUTE KNOWN. ITS SUBSTANTIVE LEGACY PROSE IS NOT YET CLASSIFIED AND IS NOT INHERITED AS A CONCLUSION.";

/** The two classes that propagate a conclusion into a later session's reasoning. */
const SUBSTANTIVE_CLASSES: readonly ClaimClass[] = ["COVERAGE_CLAIM", "DERIVED_CONCLUSION"];

/**
 * Why a substantive assertion is NOT being inherited. Every one of these is a
 * state the store can actually be in, and each is reported by name — a claim
 * that silently vanished from a projection would be indistinguishable from one
 * that was never written.
 */
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

/**
 * Route identity and applicability. **No prose fields.**
 *
 * `title` is the route's NAME — what a worker calls it and what it looks up —
 * and it is carried for that reason. The four fields that hold reasoning
 * (`applicability.note`, `origin`, `outcomes[].note`, `subBranches[].reason`)
 * are absent from this type by construction, so a consumer cannot read them
 * without deliberately calling the accessor that says it is not authoritative.
 */
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

/**
 * A walk, as a tuple. **This is what an observation inherits as.**
 *
 * The `note` is deliberately absent. `reconcile-the-adapter-before-suspecting-it`
 * carries an outcome note asserting a window was "complete rather than
 * truncated" — a coverage claim, class C, written into a class B slot, withdrawn
 * on 2026-08-28 and still sitting in that field. A tuple cannot carry a
 * conclusion; a paragraph always can.
 */
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

/**
 * A substantive assertion that exists and is NOT current.
 *
 * It is kept — history is never erased — and its text lives under
 * `statementNotCurrent` rather than `statement` so that no consumer collecting
 * statements across the projection can pick a withdrawn one up by shape.
 */
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
  /**
   * True when this entry declared no class at all. It does NOT mean the entry
   * holds no conclusion — its prose may well hold an undeclared C or D — which
   * is exactly why none of that prose is projected.
   */
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
  // `currentTruthFor` follows the supersession chain with its own cycle guard.
  // Reusing it is the point: there is one definition of "what corrected this",
  // and a second implementation here would be a second thing to get wrong.
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

/**
 * Is this substantive assertion inheritable as CURRENT INSTRUCTION?
 *
 * Four refusals, and every one of them is a state the Pima case actually passed
 * through. Returns `null` when the claim may be inherited.
 */
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

/**
 * **THE PROJECTION. THIS IS THE METHOD-INHERITANCE READ PATH.**
 *
 * Every consumer that asks "what does this jurisdiction inherit?" calls this and
 * nothing else. `applicableRoutesUnprojected` still exists one layer down
 * because the applicability arithmetic has to live somewhere, and it is named so
 * that reaching for it by accident is not possible.
 */
export function projectMethodFor(k: MethodKnowledge, j: Jurisdiction): MethodProjection {
  const staleIds = new Set(staleDependents(k).map((f) => f.dependent));
  const applicable = new Map(
    applicableRoutesUnprojected(k, j).map((a) => [a.route.id, a]),
  );

  const routes: ProjectedRoute[] = [];
  const withheld: WithheldAssertion[] = [];

  for (const r of k.routes) {
    const claims = r.claims ?? [];

    // A RETIRED ROUTE IS HISTORY, NOT INSTRUCTION. Its substantive claims are
    // named as withheld rather than dropped, so a worker that inherited them
    // yesterday can see why it does not today.
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

/**
 * Every substantive sentence a worker inheriting this projection may act on.
 *
 * One call, so that "what am I being told to believe?" has an answer shorter
 * than a walk of the whole structure — and so a test can assert the whole set
 * rather than a sample of it.
 */
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

/**
 * The routes whose substantive prose nobody has classified, with the named gap.
 *
 * Reported as a population rather than left to a reader to notice: 112 of 116
 * entries are in this state, and the honest thing to do with a number that large
 * is print it.
 */
export function legacyUnclassifiedRoutes(
  p: MethodProjection,
): Array<{ id: string; namedGap: string }> {
  return p.routes
    .filter((r) => r.legacyUnclassified)
    .map((r) => ({ id: r.identity.id, namedGap: r.namedGap as string }));
}

/**
 * **THE PROSE, AND IT IS NOT AUTHORITY.**
 *
 * The reasoning in the store is real and this repository requires a rule to ship
 * with its reasoning, so the paragraphs are reachable — through a function whose
 * name says what they are, returning a value that says `authoritative: false` in
 * a field a program can read.
 *
 * What it is FOR: a human deciding how to classify a legacy entry, a report
 * quoting a route's own words with the label attached, an audit. What it is not
 * for: deriving a coverage claim or a conclusion about a government. Anything
 * that belongs in a later session's reasoning has to be classified first — which
 * is a piece of work somebody does on purpose, not a side effect of a read.
 */
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

/**
 * What a consumer is handed when it asks about ONE assertion by id.
 *
 * A thin, named wrapper over `currentTruthFor` so a consumer never has to know
 * whether the id it holds is current — which is the question a consumer holding
 * an inherited id most needs answered and least often thinks to ask.
 */
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
