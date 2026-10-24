/**
 * A route's assertions as four classes, each its own record with its own retraction, so a false coverage claim or
 * derived conclusion never deletes a valid route. Coverage claims and derived conclusions propagate to later work as
 * reasons to stop looking, so they require provenance.
 */

/** The four classes. Ordered A, B, C, D. */
export const CLAIM_CLASSES = [
  "ROUTE_EXISTENCE",
  "ROUTE_OUTCOME",
  "COVERAGE_CLAIM",
  "DERIVED_CONCLUSION",
] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];

/** The brief's letters, for reports. The stored value is always the name. */
export const CLAIM_CLASS_LETTER: Record<ClaimClass, "A" | "B" | "C" | "D"> = {
  ROUTE_EXISTENCE: "A",
  ROUTE_OUTCOME: "B",
  COVERAGE_CLAIM: "C",
  DERIVED_CONCLUSION: "D",
};

/**
 * The classes that can propagate a substantive conclusion into a later
 * session's reasoning, and therefore the classes whose provenance is required.
 */
export const PROVENANCE_REQUIRED_CLASSES: readonly ClaimClass[] = [
  "COVERAGE_CLAIM",
  "DERIVED_CONCLUSION",
];

export function requiresProvenance(c: ClaimClass): boolean {
  return PROVENANCE_REQUIRED_CLASSES.includes(c);
}

/** What a route's walk did. Same closed set as `RouteOutcome.outcome`. */
export const CLAIM_DISPOSITIONS = ["YIELDED", "ZERO", "FAILED", "BLOCKED"] as const;
export type ClaimDisposition = (typeof CLAIM_DISPOSITIONS)[number];

/** Enough to audit a claim back to evidence. */
export interface ClaimProvenance {
  /** The source artifact: a URL, a record reference, or a committed file path. */
  artifact: string;
  /** The canonical route id whose walk produced the observation. */
  observedVia: string;
  /** The route disposition that produced it. A ZERO is evidence too. */
  disposition: ClaimDisposition;
  /** Where the claim applies. A claim naming no jurisdiction claims everywhere. */
  jurisdictions: string[];
  /** Vendor platforms the claim applies to. Empty is legitimate and must be SAID. */
  vendors: string[];
  /** ISO date, from `pnpm stamp`. An agent does not know today's date. */
  observedOn: string;
  /**
   * The Attempt that produced the observation: the identifier the audit chain joins on. Optional; an absent id is
   * reported as a named gap, never back-filled.
   */
  attemptId?: string;
}

/** Whether anything independent has confirmed the claim; `UNVALIDATED` is honest, silence is refused. */
export const CLAIM_VALIDATION_STATES = [
  "UNVALIDATED",
  "VALIDATED",
  "REVALIDATED_AFTER_UPSTREAM_RETRACTION",
  "CONTRADICTED",
] as const;
export type ClaimValidationState = (typeof CLAIM_VALIDATION_STATES)[number];

export interface ClaimValidation {
  state: ClaimValidationState;
  /** ISO date the validation state was set. */
  on: string;
  /** What did the validating: a route id, a claim id, or a named instrument. */
  by: string;
  note?: string;
}

/** A retraction. The claim stays in the store; only the consumer read path stops offering it as current. */
export const RETRACTION_KINDS = [
  "RETRACTED",
  "SUPERSEDED",
  "CORRECTED",
  "REOPENED",
  "CONTRADICTED",
] as const;
export type RetractionKind = (typeof RETRACTION_KINDS)[number];

export interface ClaimRetraction {
  kind: RetractionKind;
  /** ISO date, from `pnpm stamp`. */
  on: string;
  /** Why it is wrong, in evidence rather than in apology. */
  why: string;
  /**
   * The claim or route id carrying the corrected current truth. `null` when a
   * claim is withdrawn with nothing replacing it — in which case `survives`
   * carries the whole of what is left standing.
   */
  supersededBy: string | null;
  /** What remains true. Required, so a correction never eats the route underneath it. */
  survives: string;
}

/** One assertion the method store makes. */
export interface MethodClaim {
  /** Canonical and referenceable. Convention: `<routeId>#<slug>`. */
  id: string;
  class: ClaimClass;
  /** What is asserted, in one sentence a later session can act on. */
  statement: string;
  /** Claim and route ids this assertion rests on: declared, never inferred from text. */
  restsOn: string[];
  /** REQUIRED for `COVERAGE_CLAIM` and `DERIVED_CONCLUSION`. */
  provenance?: ClaimProvenance;
  /** REQUIRED for `COVERAGE_CLAIM` and `DERIVED_CONCLUSION`. */
  validation?: ClaimValidation;
  /** Set when the claim is withdrawn. The claim itself is never removed. */
  retraction?: ClaimRetraction;
}

/** The minimum shape needed from the store, declared structurally so this module never imports `knowledge.ts`. */
export interface ClaimBearingRoute {
  id: string;
  claims?: MethodClaim[];
  retiredOn?: string;
}
export interface ClaimStore {
  routes: readonly ClaimBearingRoute[];
}

export interface LocatedClaim {
  routeId: string;
  claim: MethodClaim;
}

export function allClaims(k: ClaimStore): LocatedClaim[] {
  const out: LocatedClaim[] = [];
  for (const r of k.routes) for (const c of r.claims ?? []) out.push({ routeId: r.id, claim: c });
  return out;
}

export function findClaim(k: ClaimStore, id: string): LocatedClaim | null {
  return allClaims(k).find((c) => c.claim.id === id) ?? null;
}

export interface DependencyFlag {
  /** The retracted claim id, or the retired route id. */
  upstream: string;
  upstreamKind: RetractionKind | "ROUTE_RETIRED";
  /** ISO date the upstream stopped being current. */
  upstreamOn: string;
  /** The claim that rests on it, NAMED. */
  dependent: string;
  dependentRoute: string;
  dependentClass: ClaimClass;
  /** `STALE`: still taught as current while what it rests on has been withdrawn. */
  status: "STALE" | "DISPOSITIONED";
  why: string;
}

/**
 * Every claim that named a withdrawn assertion (or retired route) in `restsOn`, by id. A dependent is dispositioned only
 * when retracted or revalidated on or after the upstream retraction's own date.
 */
export function findDependencyFlags(k: ClaimStore): DependencyFlag[] {
  const located = allClaims(k);
  const withdrawn = new Map<string, { kind: RetractionKind | "ROUTE_RETIRED"; on: string }>();

  for (const { claim } of located) {
    if (claim.retraction) {
      withdrawn.set(claim.id, { kind: claim.retraction.kind, on: claim.retraction.on });
    }
  }
  for (const r of k.routes) {
    if (r.retiredOn) withdrawn.set(r.id, { kind: "ROUTE_RETIRED", on: r.retiredOn });
  }

  const flags: DependencyFlag[] = [];
  for (const { routeId, claim } of located) {
    for (const dep of claim.restsOn ?? []) {
      const up = withdrawn.get(dep);
      if (!up) continue;
      if (dep === claim.id) continue;

      const revalidated =
        claim.validation?.state === "REVALIDATED_AFTER_UPSTREAM_RETRACTION" &&
        claim.validation.on >= up.on;
      const status = claim.retraction || revalidated ? "DISPOSITIONED" : "STALE";

      flags.push({
        upstream: dep,
        upstreamKind: up.kind,
        upstreamOn: up.on,
        dependent: claim.id,
        dependentRoute: routeId,
        dependentClass: claim.class,
        status,
        why:
          status === "STALE"
            ? `${claim.id} rests on ${dep}, which was ${up.kind} on ${up.on}, and ${claim.id} has neither been withdrawn nor revalidated since — it is still teaching`
            : `${claim.id} rests on ${dep} (${up.kind} ${up.on}) and has been dispositioned: ` +
              (claim.retraction
                ? `withdrawn ${claim.retraction.on}`
                : `revalidated ${claim.validation?.on}`),
      });
    }
  }
  return flags;
}

export function staleDependents(k: ClaimStore): DependencyFlag[] {
  return findDependencyFlags(k).filter((f) => f.status === "STALE");
}

export interface CurrentTruth {
  asked: string;
  status: "CURRENT" | "SUPERSEDED" | "WITHDRAWN" | "UNKNOWN_ID";
  /** The claim to act on. Never a superseded one when a successor exists. */
  claim: MethodClaim | null;
  /** The claim as originally written, when it was superseded. Kept, never erased. */
  superseded: MethodClaim | null;
  why: string;
}

/** A withdrawn claim's id resolves to what corrected it, with the retracted text kept beside it. Cycles are guarded. */
export function currentTruthFor(k: ClaimStore, id: string): CurrentTruth {
  const start = findClaim(k, id);
  if (!start) {
    const route = k.routes.find((r) => r.id === id);
    return route
      ? {
          asked: id,
          status: route.retiredOn ? "WITHDRAWN" : "CURRENT",
          claim: null,
          superseded: null,
          why: route.retiredOn
            ? `${id} is a route retired on ${route.retiredOn}`
            : `${id} is a route, not a claim, and it is not retired`,
        }
      : { asked: id, status: "UNKNOWN_ID", claim: null, superseded: null, why: `no claim or route ${id}` };
  }
  if (!start.claim.retraction) {
    return { asked: id, status: "CURRENT", claim: start.claim, superseded: null, why: "not retracted" };
  }

  const seen = new Set<string>([id]);
  let hop = start.claim;
  const trail: string[] = [id];
  for (;;) {
    const next = hop.retraction?.supersededBy;
    if (!next || seen.has(next)) break;
    seen.add(next);
    trail.push(next);
    const located = findClaim(k, next);
    if (!located) break;
    hop = located.claim;
    if (!hop.retraction) {
      return {
        asked: id,
        status: "SUPERSEDED",
        claim: hop,
        superseded: start.claim,
        why: `${trail.join(" -> ")}; the retracted text is retained and is NOT current`,
      };
    }
  }
  return {
    asked: id,
    status: "WITHDRAWN",
    claim: null,
    superseded: start.claim,
    why:
      `${id} was ${start.claim.retraction.kind} on ${start.claim.retraction.on} and no current successor claim ` +
      `resolves${start.claim.retraction.supersededBy ? ` from ${start.claim.retraction.supersededBy}` : ""}. ` +
      `WHAT SURVIVES: ${start.claim.retraction.survives}`,
  };
}

export interface RouteClaimView {
  routeId: string;
  /** A retracted claim never retires its route. */
  routeUsable: boolean;
  /** Declared, un-retracted claims. What a consumer may act on. */
  current: MethodClaim[];
  /** Withdrawn claims, kept, each pointing at what corrected it. */
  retracted: Array<{ claim: MethodClaim; correctedBy: MethodClaim | null }>;
  /** Predates claim classes and nobody declared its class; never read as class A. */
  classification: "CLASSIFIED" | "UNCLASSIFIED_LEGACY";
}

/** The whole store as a consumer sees it: corrected current truth, history kept. */
export function readCurrentMethod(k: ClaimStore): RouteClaimView[] {
  return k.routes.map((r) => {
    const claims = r.claims ?? [];
    return {
      routeId: r.id,
      routeUsable: !r.retiredOn,
      current: claims.filter((c) => !c.retraction),
      retracted: claims
        .filter((c) => c.retraction)
        .map((c) => ({
          claim: c,
          correctedBy: c.retraction?.supersededBy
            ? (findClaim(k, c.retraction.supersededBy)?.claim ?? null)
            : null,
        })),
      classification: claims.length > 0 ? "CLASSIFIED" : "UNCLASSIFIED_LEGACY",
    };
  });
}

/** How much of the store has ever declared a class. Reported, never rounded. */
export function classificationCoverage(k: ClaimStore): {
  routes: number;
  classified: number;
  unclassified: number;
  claims: number;
  byClass: Record<ClaimClass, number>;
  retracted: number;
} {
  const byClass = Object.fromEntries(CLAIM_CLASSES.map((c) => [c, 0])) as Record<ClaimClass, number>;
  let claims = 0;
  let retracted = 0;
  for (const { claim } of allClaims(k)) {
    claims += 1;
    if (CLAIM_CLASSES.includes(claim.class)) byClass[claim.class] += 1;
    if (claim.retraction) retracted += 1;
  }
  const classified = k.routes.filter((r) => (r.claims?.length ?? 0) > 0).length;
  return {
    routes: k.routes.length,
    classified,
    unclassified: k.routes.length - classified,
    claims,
    byClass,
    retracted,
  };
}

export interface ClaimIssue {
  id: string;
  rule: string;
  detail: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: unknown): boolean {
  return typeof s === "string" && ISO_DATE.test(s);
}

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** Everything the validator refuses about claims. */
export function validateClaims(k: ClaimStore): ClaimIssue[] {
  const out: ClaimIssue[] = [];
  const bad = (id: string, rule: string, detail: string) => out.push({ id, rule, detail });

  const routeIds = new Set(k.routes.map((r) => r.id));
  const claimIds = new Set<string>();
  const located = allClaims(k);

  for (const { routeId, claim } of located) {
    const at = `${routeId} / ${claim.id}`;

    if (!nonEmpty(claim.id)) bad(routeId, "claim-without-id", "a claim must carry a referenceable id");
    if (claimIds.has(claim.id)) {
      bad(claim.id, "claim-id-duplicate", `claim id appears more than once (${at})`);
    }
    claimIds.add(claim.id);

    if (!CLAIM_CLASSES.includes(claim.class)) {
      bad(
        claim.id,
        "claim-class-off-the-closed-set",
        `class is ${JSON.stringify(claim.class)}, which is none of ${CLAIM_CLASSES.join(", ")}`,
      );
      continue;
    }
    if (!nonEmpty(claim.statement)) {
      bad(claim.id, "claim-without-statement", "a claim that does not say what it asserts cannot be audited");
    }
    if (!Array.isArray(claim.restsOn)) {
      bad(claim.id, "claim-rests-on-missing", "restsOn is the declared dependency edge and is always present, even when empty");
    }

    if (requiresProvenance(claim.class)) {
      const p = claim.provenance;
      const missing: string[] = [];
      if (!p) {
        missing.push("provenance");
      } else {
        if (!nonEmpty(p.artifact)) missing.push("artifact");
        if (!nonEmpty(p.observedVia)) missing.push("observedVia");
        else if (!routeIds.has(p.observedVia)) {
          bad(
            claim.id,
            "claim-provenance-route-unknown",
            `provenance.observedVia names ${p.observedVia}, which project knowledge does not hold`,
          );
        }
        if (!CLAIM_DISPOSITIONS.includes(p.disposition)) missing.push("disposition");
        if (!Array.isArray(p.jurisdictions) || p.jurisdictions.length === 0) missing.push("jurisdictions");
        if (!Array.isArray(p.vendors)) missing.push("vendors");
        if (!isIsoDate(p.observedOn)) missing.push("observedOn");
        // `attemptId` is optional; a present but blank one is refused, since it reads as a join key that resolves to nothing.
        if (p.attemptId !== undefined && !nonEmpty(p.attemptId)) {
          bad(
            claim.id,
            "claim-provenance-attempt-blank",
            "provenance.attemptId is present and empty — declare the Attempt that produced the " +
              "observation, or omit the field so the traversal reports the gap by name",
          );
        }
      }
      if (missing.length > 0) {
        bad(
          claim.id,
          "claim-provenance-required",
          `a ${claim.class} (class ${CLAIM_CLASS_LETTER[claim.class]}) propagates into later sessions and REQUIRES ` +
            `structured provenance; missing or invalid: ${missing.join(", ")}`,
        );
      }

      const v = claim.validation;
      if (!v || !CLAIM_VALIDATION_STATES.includes(v.state)) {
        bad(
          claim.id,
          "claim-validation-state-required",
          `a ${claim.class} states its validation — one of ${CLAIM_VALIDATION_STATES.join(", ")} — ` +
            `because silence reads to a later session as though it had been checked`,
        );
      } else if (!isIsoDate(v.on) || !nonEmpty(v.by)) {
        bad(claim.id, "claim-validation-unattributed", "a validation state carries the date it was set and what set it");
      }

      if (Array.isArray(claim.restsOn) && claim.restsOn.length === 0) {
        bad(
          claim.id,
          "claim-rests-on-nothing",
          `a ${claim.class} always rests on something — at minimum the route outcome it was read off — ` +
            `and the edge is declared so the flagging can be derived rather than guessed`,
        );
      }
    }

    for (const dep of claim.restsOn ?? []) {
      if (!routeIds.has(dep) && !located.some((c) => c.claim.id === dep)) {
        bad(
          claim.id,
          "claim-rests-on-unknown-id",
          `restsOn names ${dep}, which is neither a route nor a claim in project knowledge`,
        );
      }
    }

    const r = claim.retraction;
    if (r) {
      if (!RETRACTION_KINDS.includes(r.kind)) {
        bad(
          claim.id,
          "retraction-kind-off-the-closed-set",
          `retraction.kind is ${JSON.stringify(r.kind)}, which is none of ${RETRACTION_KINDS.join(", ")}`,
        );
      }
      const gaps: string[] = [];
      if (!isIsoDate(r.on)) gaps.push("on");
      if (!nonEmpty(r.why)) gaps.push("why");
      if (!nonEmpty(r.survives)) gaps.push("survives");
      if (gaps.length > 0) {
        bad(
          claim.id,
          "retraction-incomplete",
          `a retraction records the date, the evidence, and WHAT SURVIVES it; missing: ${gaps.join(", ")}`,
        );
      }
      if (r.supersededBy && !routeIds.has(r.supersededBy) && !located.some((c) => c.claim.id === r.supersededBy)) {
        bad(
          claim.id,
          "retraction-successor-unknown",
          `retraction.supersededBy names ${r.supersededBy}, which project knowledge does not hold`,
        );
      }
    }
  }

  // A withdrawn assertion whose dependents are still being taught.
  for (const f of staleDependents(k)) {
    bad(f.dependent, "stale-dependent-assertion", f.why);
  }

  return out;
}

/** The minimum needed from a control-plane `Attempt`, declared structurally so the dependency runs one way. */
export interface AuditableAttempt {
  readonly id: string;
  readonly routeTaskId: string;
  readonly artifactIds: readonly string[];
  /** The method-store version this Attempt inherited. An audit needs it. */
  readonly methodVersion?: number;
}

/** The minimum this module needs from a control-plane `RouteTask`. */
export interface AuditableRouteTask {
  readonly id: string;
  readonly routeId: string;
  readonly disposition: { readonly artifactIds: readonly string[] } | null;
}

/** Every hop of the chain, named, so a broken one says WHICH hop broke. */
export const AUDIT_HOPS = [
  "CLAIM",
  "METHOD_ASSERTION_ROUTE",
  "ATTEMPT",
  "ROUTE_TASK",
  "ARTIFACTS",
] as const;
export type AuditHop = (typeof AUDIT_HOPS)[number];

export interface AuditTrail {
  readonly claimId: string;
  /** True only when every hop resolved by IDENTIFIER. */
  readonly complete: boolean;
  /** The hops that resolved, in order. */
  readonly resolved: readonly AuditHop[];
  /** The route the assertion is attached to. */
  readonly routeId: string | null;
  /** The route id the provenance says produced the observation. */
  readonly observedViaRouteId: string | null;
  readonly attemptId: string | null;
  readonly routeTaskId: string | null;
  readonly artifactIds: readonly string[];
  /** The prose reference, carried for a human and never joined on. */
  readonly proseArtifactNotAJoin: string | null;
  /** Where the chain stopped, by name. Empty when `complete` is true. */
  readonly gaps: readonly string[];
  readonly why: string;
}

/**
 * Walk claim -> assertion -> attempt -> route task -> artifacts on identifiers only, never substituting the prose
 * `artifact`. A broken chain names the hop that broke. The route task must name the same route the provenance names.
 */
export function auditTrailFor(
  k: ClaimStore,
  claimId: string,
  attempts: readonly AuditableAttempt[],
  tasks: readonly AuditableRouteTask[],
): AuditTrail {
  const resolved: AuditHop[] = [];
  const gaps: string[] = [];
  const empty = {
    claimId,
    complete: false,
    resolved: [] as AuditHop[],
    routeId: null,
    observedViaRouteId: null,
    attemptId: null,
    routeTaskId: null,
    artifactIds: [] as string[],
    proseArtifactNotAJoin: null,
    gaps,
    why: "",
  };

  const located = findClaim(k, claimId);
  if (!located) {
    return { ...empty, gaps: [`CLAIM: project knowledge holds no claim ${claimId}`], why: `no claim ${claimId}` };
  }
  resolved.push("CLAIM");

  const { routeId, claim } = located;
  const prose = claim.provenance?.artifact ?? null;
  const observedVia = claim.provenance?.observedVia ?? null;
  if (observedVia) resolved.push("METHOD_ASSERTION_ROUTE");
  else gaps.push("METHOD_ASSERTION_ROUTE: the claim carries no provenance.observedVia route id");

  const attemptId = claim.provenance?.attemptId ?? null;
  if (!attemptId) {
    gaps.push(
      "ATTEMPT: provenance.attemptId is absent — this claim predates attempt-bound provenance, " +
        "so the ONLY link to evidence is the prose artifact string, and a prose reference is not a join",
    );
    return {
      ...empty,
      resolved,
      routeId,
      observedViaRouteId: observedVia,
      proseArtifactNotAJoin: prose,
      gaps,
      why: `${claimId} cannot be audited by identifier; the chain stops at ATTEMPT`,
    };
  }

  const attempt = attempts.find((a) => a.id === attemptId) ?? null;
  if (!attempt) {
    gaps.push(`ATTEMPT: provenance names attempt ${attemptId}, which the control plane does not hold`);
    return {
      ...empty,
      resolved,
      routeId,
      observedViaRouteId: observedVia,
      attemptId,
      proseArtifactNotAJoin: prose,
      gaps,
      why: `${claimId} names an Attempt nobody can produce`,
    };
  }
  resolved.push("ATTEMPT");

  const task = tasks.find((t) => t.id === attempt.routeTaskId) ?? null;
  if (!task) {
    gaps.push(
      `ROUTE_TASK: attempt ${attemptId} names RouteTask ${attempt.routeTaskId}, which the control plane does not hold`,
    );
    return {
      ...empty,
      resolved,
      routeId,
      observedViaRouteId: observedVia,
      attemptId,
      routeTaskId: attempt.routeTaskId,
      proseArtifactNotAJoin: prose,
      gaps,
      why: `${claimId} reaches an Attempt whose RouteTask is missing`,
    };
  }
  resolved.push("ROUTE_TASK");

  if (observedVia && task.routeId !== observedVia) {
    gaps.push(
      `ROUTE_TASK: provenance.observedVia says ${observedVia} but RouteTask ${task.id} walked ` +
        `${task.routeId} — two identifiers that both resolve and disagree`,
    );
  }

  // Artifacts from the Attempt AND from the disposition it wrote. An Attempt
  // preserves artifacts even when it aborts, so the union is the honest set.
  const artifactIds = [
    ...new Set([...attempt.artifactIds, ...(task.disposition?.artifactIds ?? [])]),
  ];
  if (artifactIds.length === 0) {
    gaps.push(
      `ARTIFACTS: neither attempt ${attemptId} nor RouteTask ${task.id} recorded an artifact id — ` +
        "there is nothing to re-read, and the claim rests on a report of a fetch rather than the fetch",
    );
  } else {
    resolved.push("ARTIFACTS");
  }

  const complete = gaps.length === 0;
  return {
    claimId,
    complete,
    resolved,
    routeId,
    observedViaRouteId: observedVia,
    attemptId,
    routeTaskId: task.id,
    artifactIds,
    proseArtifactNotAJoin: prose,
    gaps,
    why: complete
      ? `${claimId} -> ${observedVia} -> ${attemptId} -> ${task.id} -> ${artifactIds.length} artifact(s), ` +
        "every hop joined on an identifier and none on the prose reference"
      : `${claimId} is not auditable end to end: ${gaps.length} hop(s) unresolved`,
  };
}

/** Every claim whose evidence chain is walkable, and every one that is not. */
export function auditCoverage(
  k: ClaimStore,
  attempts: readonly AuditableAttempt[],
  tasks: readonly AuditableRouteTask[],
): { total: number; auditable: number; trails: AuditTrail[] } {
  const trails = allClaims(k)
    .filter(({ claim }) => requiresProvenance(claim.class))
    .map(({ claim }) => auditTrailFor(k, claim.id, attempts, tasks));
  return { total: trails.length, auditable: trails.filter((t) => t.complete).length, trails };
}

/** Attach claims to a route, additively: a claim id already on the route is left exactly as it is. */
export function attachClaims<T extends ClaimBearingRoute>(
  routes: readonly T[],
  routeId: string,
  claims: readonly MethodClaim[],
): { routes: T[]; added: string[]; already: string[]; missingRoute: boolean } {
  const idx = routes.findIndex((r) => r.id === routeId);
  if (idx < 0) return { routes: [...routes], added: [], already: [], missingRoute: true };

  const existing = routes[idx].claims ?? [];
  const have = new Set(existing.map((c) => c.id));
  const added: string[] = [];
  const already: string[] = [];
  const next = [...existing];
  for (const c of claims) {
    if (have.has(c.id)) already.push(c.id);
    else {
      next.push(c);
      added.push(c.id);
    }
  }
  const out = [...routes];
  out[idx] = { ...routes[idx], claims: next };
  return { routes: out, added, already, missingRoute: false };
}

/** Withdraw a claim, which is kept. Refuses an unknown id and a re-retraction, so an amendment is idempotent. */
export function retractClaim<T extends ClaimBearingRoute>(
  routes: readonly T[],
  claimId: string,
  retraction: ClaimRetraction,
): { routes: T[]; retracted: boolean; reason: string } {
  for (let i = 0; i < routes.length; i += 1) {
    const claims = routes[i].claims ?? [];
    const j = claims.findIndex((c) => c.id === claimId);
    if (j < 0) continue;
    if (claims[j].retraction) {
      return { routes: [...routes], retracted: false, reason: `already retracted: ${claimId}` };
    }
    const nextClaims = [...claims];
    nextClaims[j] = { ...claims[j], retraction };
    const out = [...routes];
    out[i] = { ...routes[i], claims: nextClaims };
    return {
      routes: out,
      retracted: true,
      reason: `${retraction.kind} ${claimId} on ${retraction.on} -> ${retraction.supersededBy ?? "no successor"}`,
    };
  }
  return { routes: [...routes], retracted: false, reason: `no claim ${claimId} in project knowledge` };
}
