/**
 * **ONE RESOURCE-GOVERNED RUNTIME ACROSS EVERY SCARCE PROVIDER.**
 * (FCP-7, 2026-09-07.)
 *
 * ## Why this is one policy and not five
 *
 * Two resource overruns landed in one week and each was repaired on its own
 * terms:
 *
 * ```
 *   2026-09-05  hosted Actions minutes  bookkeeping commits buying full CI
 *   2026-09-07  MapTiler requests       synthetic browsers spending the map
 *                                       provider's allowance
 * ```
 *
 * Both repairs are correct and neither generalises. A third scarce provider —
 * a paid model fallback, an API key's daily quota, a deploy minute — would
 * arrive with no policy at all and be discovered the same way: by running out.
 *
 * > **The point is to prevent the next resource-overrun class, not only
 * > today's two.**
 *
 * So a work item DECLARES which scarce resources it may spend, and an attempt
 * to spend an undeclared one is refused BEFORE the request is made. Refusing at
 * the point of spend is what makes this different from a budget that is read
 * after the money is gone. `lib/control-plane/budget.ts` already governs
 * politeness toward one host; this governs entitlement across providers, and
 * the two compose — a request must be both entitled here and polite there.
 *
 * ## The default for runtime freshness, which FCP-7 states outright
 *
 * ```
 *   local compute              ALLOWED
 *   hosted GitHub Actions      FORBIDDEN as a retry mechanism
 *   MapTiler                   FORBIDDEN unless the proof is the bounded
 *                              provider-smoke class
 *   paid model fallback        FORBIDDEN unless separately authorized
 * ```
 *
 * ## Direction of every unknown
 *
 * An unrecognised resource is REFUSED, not allowed. A grant that cannot be read
 * is refused. An execution class that is not named is refused. A policy engine
 * whose unknowns default open is a policy engine that documents spending rather
 * than bounding it.
 *
 * PURE. Nothing here reads a clock, an environment or a network.
 */

export const RESOURCE_POLICY_FORMAT_VERSION = 1;

/**
 * Every scarce provider the runtime can spend against.
 *
 * FCP-7 names five. `neon-compute` and `external-source-requests` are here
 * because they are the two the repository has already had to reason about —
 * the Neon circuit breaker and the per-host request budgets exist — and a
 * policy that omitted them would be a policy with a hole exactly where the
 * evidence already is.
 */
export const SCARCE_RESOURCES = [
  "local-compute",
  "local-production-build",
  "hosted-actions-minutes",
  "maptiler-requests",
  "paid-model-fallback",
  "external-source-requests",
  "neon-compute",
  "production-deploy",
] as const;
export type ScarceResource = (typeof SCARCE_RESOURCES)[number];

/**
 * What a work item IS. The class decides the default grant, so a new work item
 * inherits a bound rather than inheriting everything.
 */
export const EXECUTION_CLASSES = [
  /** Ordinary runtime freshness: acquire, certify, coalesce. The common case. */
  "RUNTIME_FRESHNESS",
  /** A retry of something that failed. Deliberately the tightest grant. */
  "LOCAL_RETRY",
  /** The nightly promotion window's own work. */
  "PROMOTION_WINDOW",
  /** The bounded map-provider smoke test, and nothing else, may touch MapTiler. */
  "PROVIDER_SMOKE",
  /** Code shipping: the one hosted certification a shipping transaction buys. */
  "SHIPPING_CERTIFICATION",
  /** A model worker walking an ungraduated route under a stated ceiling. */
  "BOUNDED_MODEL_RESEARCH",
] as const;
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];

export interface ResourceGrant {
  readonly executionClass: ExecutionClass;
  readonly allowed: readonly ScarceResource[];
  /** One line per class. Why this grant and not a wider one. */
  readonly why: string;
}

/**
 * The grant table. Allowlist-shaped, in the same direction and for the same
 * reason as `NON_SHIPPING_PREFIXES` and `OPS_ONLY_ARTIFACTS`: a resource is
 * spendable only when it is named.
 */
export const RESOURCE_GRANTS: readonly ResourceGrant[] = [
  {
    executionClass: "RUNTIME_FRESHNESS",
    allowed: ["local-compute", "external-source-requests", "neon-compute"],
    why:
      "acquiring from a publisher and recording the result. It reaches the source and the control " +
      "plane and nothing else: no hosted minutes, because FCP-5 makes GitHub Actions CI rather " +
      "than the runtime loop, and no map provider, because no acquisition reads a tile",
  },
  {
    executionClass: "LOCAL_RETRY",
    allowed: ["local-compute", "external-source-requests"],
    why:
      "the tightest grant in the table, deliberately. A retry is where an unbounded system spends " +
      "most: FCP-5 forbids hosted retries by name, and a retry that could reach a paid model would " +
      "turn one transient failure into a bill",
  },
  {
    executionClass: "PROMOTION_WINDOW",
    allowed: [
      "local-compute",
      "local-production-build",
      "neon-compute",
      "production-deploy",
    ],
    why:
      "the one door that may cause a deploy (RULING 268), and the only class that may. It builds " +
      "locally because RULING 266 verifies against a local production build",
  },
  {
    executionClass: "PROVIDER_SMOKE",
    allowed: ["local-compute", "maptiler-requests"],
    why:
      "the ONLY class that may spend the map provider's allowance, and the exception FCP-3 names " +
      "when it says normal certification must not depend on MapTiler. Bounded by the provider's own " +
      "quota policy, not by this table",
  },
  {
    executionClass: "SHIPPING_CERTIFICATION",
    allowed: ["hosted-actions-minutes", "local-compute", "local-production-build", "neon-compute"],
    why:
      "the one hosted certification per shipping transaction FCP-9B budgets. It is the ONLY class " +
      "granted hosted minutes, which is what makes 'GitHub Actions is CI, not the runtime control " +
      "loop' a refusal rather than a convention",
  },
  {
    executionClass: "BOUNDED_MODEL_RESEARCH",
    allowed: ["local-compute", "external-source-requests", "paid-model-fallback", "neon-compute"],
    why:
      "a bounded worker walking an ungraduated route. The paid fallback is granted HERE and nowhere " +
      "else, and remains subject to the spend ceiling in current-decisions.md — a grant is " +
      "permission to spend a budget, never a budget",
  },
] as const;

export interface SpendDecision {
  readonly allowed: boolean;
  readonly resource: string;
  readonly executionClass: string;
  readonly reason: string;
}

/**
 * May this work item spend this resource?
 *
 * Both unknowns refuse, and they refuse differently so a report can tell an
 * unrecognised resource (probably a typo, or a provider nobody added to the
 * table) from an unrecognised class (a work item that declared nothing).
 */
export function maySpend(
  executionClass: string,
  resource: string,
): SpendDecision {
  const grant = RESOURCE_GRANTS.find((g) => g.executionClass === executionClass);
  if (!grant) {
    return {
      allowed: false,
      resource,
      executionClass,
      reason:
        `${JSON.stringify(executionClass)} is not one of the ${EXECUTION_CLASSES.length} execution ` +
        "classes; work that declares no class is refused rather than granted a default, because a " +
        "default grant is how the next overrun class arrives",
    };
  }
  if (!(SCARCE_RESOURCES as readonly string[]).includes(resource)) {
    return {
      allowed: false,
      resource,
      executionClass,
      reason:
        `${JSON.stringify(resource)} is not a known scarce resource; an unrecognised provider is ` +
        "refused so that adding a provider is a decision rather than a discovery",
    };
  }
  if (!grant.allowed.includes(resource as ScarceResource)) {
    return {
      allowed: false,
      resource,
      executionClass,
      reason:
        `${executionClass} may spend ${grant.allowed.join(", ")} and this is ${resource}. ` +
        grant.why,
    };
  }
  return {
    allowed: true,
    resource,
    executionClass,
    reason: `${executionClass} declares ${resource}`,
  };
}

/**
 * **THE COST LAW, AS A PREDICATE.**
 *
 * FCP-5's non-negotiables, stated so the contract test can assert them rather
 * than a session claiming them:
 *
 * ```
 *   a quiet freshness day                    0 hosted freshness runs
 *   N source retries                         0 additional hosted runs
 *   N source changes in one window          <= 1 shipping-triggered hosted path
 * ```
 *
 * `hostedRunsFor` answers the first two directly from the grant table: no
 * freshness class holds `hosted-actions-minutes`, so the count is zero for any
 * number of sources and any number of retries. That is the point of computing
 * it from the table instead of writing the three numbers down — the numbers
 * cannot drift away from the policy that produces them.
 */
export function hostedRunsFor(work: readonly { readonly executionClass: string }[]): number {
  return work.filter((w) => maySpend(w.executionClass, "hosted-actions-minutes").allowed).length;
}

/** Every class that may spend hosted minutes. Exactly one, and the test says so. */
export function classesWithHostedMinutes(): readonly ExecutionClass[] {
  return RESOURCE_GRANTS.filter((g) => g.allowed.includes("hosted-actions-minutes")).map(
    (g) => g.executionClass,
  );
}

/**
 * Did a run cross an execution-class boundary?
 *
 * FCP-7 asks Admin to show this. A crossing is not automatically wrong — a
 * promotion window legitimately follows a freshness cycle — but an
 * unannounced crossing is how one class's grant quietly becomes another's.
 */
export function crossedBoundary(
  declared: string,
  spent: readonly string[],
): readonly SpendDecision[] {
  return spent.map((r) => maySpend(declared, r)).filter((d) => !d.allowed);
}
