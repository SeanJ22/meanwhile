/**
 * **THE FOUR CLAIM CLASSES, AND WHY A ROUTE IS NOT ONE CLAIM.** (2026-08-28.)
 *
 * Canonical method knowledge is INHERITED BY FUTURE WORKERS. That is the whole
 * value of the store and it is also the whole of its danger: a sentence written
 * here is read by every later session as settled, and none of them re-derives
 * it. So a wrong sentence does not cost one session — it costs every session
 * after it, and it arrives pre-argued.
 *
 * The Pima case is the worked example and it is exact. A session measured
 * `webapi.legistar.com/v1/pima/events` correctly, reconciled the adapter's
 * denominators correctly, and then wrote down that Pima County publishes its
 * September sittings only as a recurring rule. All three sittings were
 * individually published on the county's own portal at that moment. The
 * measurement was true; the conclusion drawn from it was false; and both were
 * stored in the same prose field, at the same authority, on the same route.
 *
 * ## Correcting the prose was necessary and insufficient
 *
 * A store that holds one undifferentiated blob per route has exactly two moves
 * when part of it turns out to be wrong: rewrite the blob, or delete the route.
 * Rewriting loses the history. Deleting throws away a route that was never
 * wrong — and a deleted route is one a later session rediscovers as new
 * (RULING 63). Neither is available if the false part and the true part are
 * separable, and here they always are:
 *
 *   A. `ROUTE_EXISTENCE`     — "this public route exists"
 *   B. `ROUTE_OUTCOME`       — "it yielded / zeroed / failed / was blocked in
 *                              jurisdiction X on date Y"
 *   C. `COVERAGE_CLAIM`      — "this route appears complete or incomplete for
 *                              field or class X"
 *   D. `DERIVED_CONCLUSION`  — "the public record universe contains, or does
 *                              not contain, X"
 *
 * **A FALSE C OR D MUST NOT CAUSE A VALID A TO BE DELETED.** That is the
 * structural property this module exists to hold, and it is held by giving each
 * assertion its own record with its own retraction, rather than by asking a
 * future worker to be careful with a paragraph.
 *
 * ## Why the values are named rather than lettered
 *
 * `MethodRoute.tier` is already `A0 | A1 | B | C`. A claim class stored as
 * `"A"`, `"B"`, `"C"` or `"D"` would collide with it in every grep, every log
 * line and every reader's eye, and a class that is *sometimes* the tier is a
 * defect waiting for a hurry. The letters survive as a derived label
 * (`CLAIM_CLASS_LETTER`) for reports that want to speak the brief's language.
 *
 * ## Provenance is REQUIRED for C and D, and that is the point
 *
 * A route's existence and a route's outcome are self-evidencing: the id is the
 * route, and an outcome already carries its jurisdiction and its date. A
 * coverage claim and a derived conclusion are not. They are the two classes
 * that PROPAGATE — a later session inherits them as reasons to stop looking —
 * so each one must be auditable back to the artifact that evidenced it, the
 * route disposition that produced it, the jurisdictions and vendors it covers,
 * and the date it was observed on.
 *
 * **A coverage claim or a derived conclusion may not become inherited authority
 * merely because the worker that wrote it believed it.** The validator refuses
 * it, and `tests/method-claims.test.ts` plants one to prove the refusal fires.
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

/**
 * Enough to audit a claim back to evidence, and no more.
 *
 * Every field here answers a question a later session actually asks before
 * trusting an inherited conclusion: *what did you look at, how did you get it,
 * where does it apply, and when?*
 */
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
}

/**
 * Whether anything independent has confirmed the claim.
 *
 * `UNVALIDATED` is a permitted, honest value — most claims start there. What is
 * refused is SILENCE: a coverage claim or a derived conclusion that never says
 * whether it was checked reads to a later session as though it had been.
 */
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

/**
 * A retraction. **History is preserved; nothing is ever erased.**
 *
 * The claim stays in the store carrying this record, exactly as a failed
 * inherited route stays as a sub-branch (RULING 60). What changes is that the
 * consumer read path stops offering it as current and starts offering what
 * superseded it.
 */
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
  /**
   * **WHAT SURVIVES.** Required, and it is the field that stops a correction
   * eating the route underneath it. A retraction that cannot name what remains
   * true is a retraction nobody has thought through.
   */
  survives: string;
}

/**
 * One assertion the method store makes.
 *
 * A route carries several: it exists (A), it did something somewhere (B), and
 * sometimes it was read as saying something about coverage (C) or about the
 * public record (D). Separating them is what lets the third and fourth be
 * withdrawn while the first and second stand.
 */
export interface MethodClaim {
  /** Canonical and referenceable. Convention: `<routeId>#<slug>`. */
  id: string;
  class: ClaimClass;
  /** What is asserted, in one sentence a later session can act on. */
  statement: string;
  /**
   * **THE DEPENDENCY EDGE, DECLARED.** Claim ids and route ids this assertion
   * rests on.
   *
   * It is declared rather than inferred on purpose. Inferring dependence by
   * matching text would be a guess wearing a mechanism's clothes: it would miss
   * the dependency that is phrased differently and invent the one that shares a
   * word. An entry names what it rests on, and the flagging is derived from
   * what it named.
   */
  restsOn: string[];
  /** REQUIRED for `COVERAGE_CLAIM` and `DERIVED_CONCLUSION`. */
  provenance?: ClaimProvenance;
  /** REQUIRED for `COVERAGE_CLAIM` and `DERIVED_CONCLUSION`. */
  validation?: ClaimValidation;
  /** Set when the claim is withdrawn. The claim itself is never removed. */
  retraction?: ClaimRetraction;
}

/**
 * The minimum shape this module needs from the store.
 *
 * Declared structurally so `claims.ts` never imports `knowledge.ts` — the
 * dependency runs one way, and `MethodKnowledge` satisfies this by being what
 * it already is.
 */
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

export function isRetracted(c: MethodClaim): boolean {
  return Boolean(c.retraction);
}

/* ------------------------------------------------------------ DEPENDENCY FLAGGING */

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
  /**
   * `STALE` means this assertion is still being taught as current while what it
   * rests on has been withdrawn. That is the failure mode the whole mechanism
   * exists to make impossible to miss.
   */
  status: "STALE" | "DISPOSITIONED";
  why: string;
}

/**
 * **WHAT A RETRACTION MECHANICALLY FLAGS.**
 *
 * Every claim that NAMED the withdrawn assertion in `restsOn` is surfaced, by
 * id, with the reason. Nobody has to notice. A dependent counts as
 * DISPOSITIONED only when it has itself been retracted, or has been explicitly
 * revalidated on or after the upstream retraction's own date — a revalidation
 * stamped BEFORE the retraction revalidated something else and does not count.
 *
 * A retired route flags the claims resting on it for the same reason, which is
 * the case where the ground itself is withdrawn rather than a sentence about it.
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

/* ------------------------------------------------------------ THE CONSUMER READ PATH */

export interface CurrentTruth {
  asked: string;
  status: "CURRENT" | "SUPERSEDED" | "WITHDRAWN" | "UNKNOWN_ID";
  /** The claim to act on. Never a superseded one when a successor exists. */
  claim: MethodClaim | null;
  /** The claim as originally written, when it was superseded. Kept, never erased. */
  superseded: MethodClaim | null;
  why: string;
}

/**
 * **WHAT A FUTURE SESSION IS HANDED WHEN IT ASKS.**
 *
 * Ask by the id of a claim that has since been withdrawn and you receive the
 * one that corrected it, with the retracted text kept beside it and clearly
 * labelled as retracted. That is the property the whole exercise is for: a
 * superseded conclusion must never be surfaced as current, and the history must
 * never be lost.
 *
 * The chain is followed with a cycle guard, because two claims that supersede
 * each other are a data defect and must not become an infinite loop in a
 * consumer.
 */
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
  /**
   * **A RETRACTED CLAIM NEVER RETIRES ITS ROUTE.** This is `true` for every
   * route that is not itself retired, including one whose coverage claim or
   * derived conclusion has just been withdrawn.
   */
  routeUsable: boolean;
  /** Declared, un-retracted claims. What a consumer may act on. */
  current: MethodClaim[];
  /** Withdrawn claims, kept, each pointing at what corrected it. */
  retracted: Array<{ claim: MethodClaim; correctedBy: MethodClaim | null }>;
  /**
   * `UNCLASSIFIED_LEGACY` means the entry predates claim classes and NOBODY
   * DECLARED ITS CLASS. It does not mean the entry contains no conclusion —
   * its prose may well carry an undeclared C or D — and a consumer must not
   * read the absence of a declared class as a declaration of class A.
   */
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

/* ------------------------------------------------------------------- VALIDATION */

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

/**
 * Everything the validator refuses about claims.
 *
 * The load-bearing two are `claim-provenance-required` — which is what stops a
 * belief becoming inherited authority — and `stale-dependent-assertion`, which
 * is what stops a withdrawn conclusion quietly continuing to teach through
 * something that rested on it.
 */
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

  // THE LOAD-BEARING ONE. A withdrawn assertion whose dependents are still
  // being taught is exactly the Pima failure, one level up.
  for (const f of staleDependents(k)) {
    bad(f.dependent, "stale-dependent-assertion", f.why);
  }

  return out;
}

/* --------------------------------------------------------------------- MUTATION */

/**
 * Attach claims to a route. **Additive only.**
 *
 * A claim id already on the route is left exactly as it is — replacing it would
 * be a silent mutation of somebody else's observation, which is the same rule
 * `learnBatch` applies to `effort`. That is also what makes an amendment script
 * safe to re-run.
 */
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

/**
 * Withdraw a claim. **The claim is kept; only its currency changes.**
 *
 * Refuses an unknown id, and refuses to re-retract — so an amendment script is
 * idempotent and a second run cannot overwrite the first run's reasoning with
 * a differently worded version of it.
 */
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
