/**
 * **OUR ROBOTS DO NOT SPEND A THIRD PARTY'S QUOTA** — MAPQ-1 and MAPQ-2,
 * 2026-09-07.
 *
 * ## The measurement that produced this file
 *
 * The first MapTiler billing period closed at **101,863 requests against a
 * 100,000-request free allowance**, while the public readership was tiny. The
 * strongest correlation in the repository is dated: the guarded Playwright
 * harness was repaired on 2026-08-22 so that synthetic browser sessions could
 * once again reach MapTiler — `lib/ops/origin-confinement.ts` records that
 * repair in full — and provider traffic rose sharply from there. Before that
 * repair every capture and every walk was accidentally offline at MapTiler,
 * because our own run-marker header was breaking its CORS preflight. The bill
 * is what a fixed instrument looks like when nobody bounded it.
 *
 * A local browser test carrying the real public key spends the real allowance.
 * **"Local" is not evidence of "offline"**, and a deployed origin is not
 * evidence of a human. Attribution has to be built, not assumed.
 *
 * ## What this module decides, and what it deliberately does not
 *
 * It is a PURE function over `(requestUrl, policy, spentSoFar)`, for the same
 * reason `confine` is one: four lines inside a harness are remembered rather
 * than enforced — nothing fails when they are deleted, and nothing can test
 * them without launching a browser. `scripts/browser.mts` calls this and
 * `tests/provider-access.test.ts` asserts that it does, so removing the call
 * fails the build.
 *
 * It decides nothing about the map. The Reader's provider, style and visuals
 * are untouched: `lib/map/style.ts` already falls through to a no-key
 * `FALLBACK_STYLE`, and `components/map/map-canvas.tsx` already drops to it on
 * a failed style request and says so. A blocked request therefore produces the
 * behaviour the app already has for a reader with no basemap — the plain
 * ground, the pins, the panels and the notice — which is what keeps the visual
 * suite testable while the quota stays ours.
 *
 * ## Fail closed, and closed by default
 *
 * Two gates, and BOTH must be open before one request leaves:
 *
 *   1. the process declares `WTP_PROVIDER_ACCESS=maptiler`, and
 *   2. the launch itself asks for it, in code, at the call site.
 *
 * One alone is not enough, and that is the point of two. An environment
 * variable exported once in a shell would otherwise be inherited by every
 * sweep started in it — `pnpm walk:all`, a capture run, a performance probe —
 * and a broad sweep silently spending quota is the exact failure this file
 * exists to make impossible. A launch option alone would put the decision
 * where a script author can forget it.
 *
 * ## The host rule is a domain rule
 *
 * The two hosts the brief names — `api.maptiler.com` and `tiles.maptiler.com`
 * — are asserted BY NAME in the test, because a stated denominator is the
 * difference between a guard and a guard-shaped comment. But the matcher is
 * the whole registrable domain, so a subdomain nobody has thought of yet is
 * blocked on the day it appears rather than on the day someone remembers to
 * add it. Over-blocking costs a fallback basemap in a capture. Under-blocking
 * costs money and destroys the attribution this repair is for. Those are not
 * symmetrical.
 */

/** The providers this module knows how to bound. One, for now, and named. */
export const MAPTILER = "maptiler";
export type ExternalProvider = typeof MAPTILER;

/**
 * **The MapTiler hosts the app can reach.**
 *
 * Not decorative: `tests/provider-access.test.ts` walks every one and asserts
 * it is blocked by default, so the guard has a stated denominator rather than
 * one example. `api` and `tiles` are the two the brief names and the two
 * `lib/map/style.ts` and a MapLibre style document actually reach; `service`
 * and `cloud` are the analytics and account hosts, named here so that a
 * BROWSER can never reach them either — the usage read in
 * `lib/control-plane/maptiler/` is a server-side fetch with a service token,
 * and a page has no business holding one.
 *
 * **Append-only.** A host that stops being used costs nothing to keep
 * asserting about, and removing one is how a later leak goes unnoticed.
 */
export const MAPTILER_HOSTS: readonly string[] = [
  "api.maptiler.com",
  "tiles.maptiler.com",
  "service.maptiler.com",
  "cloud.maptiler.com",
];

/** The registrable domains, one per provider. The matcher, rather than the list above. */
const PROVIDER_DOMAINS: ReadonlyArray<{ readonly provider: ExternalProvider; readonly domain: string }> = [
  { provider: MAPTILER, domain: "maptiler.com" },
];

/** The one canonical flag. There is no second way to ask, and no ad-hoc env check. */
export const PROVIDER_ACCESS_VAR = "WTP_PROVIDER_ACCESS";
/** The per-run ceiling, when the operator wants one tighter than the default. */
export const PROVIDER_CEILING_VAR = "WTP_PROVIDER_REQUEST_CEILING";

/**
 * How many provider requests one opted-in run may make before it is refused.
 *
 * Twenty-five is sized for what the bounded smoke actually needs — a style
 * document, its sprite and glyph ranges, and a tile or two — and for nothing
 * else. A number large enough to let a Reader regression suite through would
 * make the ceiling decorative.
 */
export const DEFAULT_PROVIDER_CEILING = 25;

/** The hardest ceiling any run may ask for. A ceiling nobody can raise is the point. */
export const MAX_PROVIDER_CEILING = 200;

export type ProviderPolicyMode =
  /** The default, and the state of every ordinary synthetic run. */
  | "BLOCKED"
  /** Both gates open: this run may spend, up to `ceiling`. */
  | "ALLOWED_BOUNDED"
  /**
   * The call site asked to spend and the environment never said it could.
   * Blocked exactly as `BLOCKED` is — named separately so a smoke can fail
   * with the reason rather than with a silent zero.
   */
  | "REFUSED_NOT_OPTED_IN";

export interface ProviderPolicy {
  readonly mode: ProviderPolicyMode;
  /** Which provider this policy is about, when it is about one. */
  readonly provider: ExternalProvider | null;
  /** Requests this run may make. Zero unless `ALLOWED_BOUNDED`. */
  readonly ceiling: number;
  /** One line, for a human and for a report. Never a key, never a token. */
  readonly says: string;
}

export const BLOCKED_BY_DEFAULT: ProviderPolicy = {
  mode: "BLOCKED",
  provider: null,
  ceiling: 0,
  says:
    "External map-provider access is BLOCKED. This run cannot reach MapTiler and spends none of " +
    "its quota; the app draws its plain-ground fallback basemap.",
};

function ceilingFrom(raw: string | undefined): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROVIDER_CEILING;
  return Math.min(parsed, MAX_PROVIDER_CEILING);
}

/**
 * The policy for one run, from BOTH gates.
 *
 * `requested` is what the launch asked for, in code. `env` is what the process
 * declared. Neither alone opens the door, and the asymmetry between the two
 * refusals is deliberate: a run that asked and was refused gets told which
 * variable would have let it through, because that run has a person waiting on
 * it. A run that never asked gets the plain default, because that run is every
 * other run in the repository and a warning on each of them is noise.
 */
export function resolveProviderPolicy(input: {
  readonly requested?: ExternalProvider | null;
  readonly env?: { readonly [PROVIDER_ACCESS_VAR]?: string; readonly [PROVIDER_CEILING_VAR]?: string };
}): ProviderPolicy {
  const requested = input.requested ?? null;
  if (requested === null) return BLOCKED_BY_DEFAULT;

  const env = input.env ?? {};
  const declared = (env[PROVIDER_ACCESS_VAR] ?? "").trim().toLowerCase();
  if (declared !== requested) {
    return {
      mode: "REFUSED_NOT_OPTED_IN",
      provider: requested,
      ceiling: 0,
      says:
        `This run asked to spend ${requested} quota and ${PROVIDER_ACCESS_VAR} does not say ` +
        `${requested}, so it is BLOCKED. Opting in is deliberate and both halves are required: ` +
        `set ${PROVIDER_ACCESS_VAR}=${requested} for the one command that means to spend.`,
    };
  }

  const ceiling = ceilingFrom(env[PROVIDER_CEILING_VAR]);
  return {
    mode: "ALLOWED_BOUNDED",
    provider: requested,
    ceiling,
    says:
      `THIS RUN SPENDS EXTERNAL ${requested.toUpperCase()} QUOTA. Both gates are open ` +
      `(${PROVIDER_ACCESS_VAR}=${requested} and the launch asked for it). At most ${ceiling} ` +
      "request(s) will be allowed to leave, and asking for one more fails the run.",
  };
}

/**
 * Which provider a URL belongs to, or null.
 *
 * Only `http:` and `https:` can carry a request to a provider, so every other
 * scheme — `data:`, `blob:`, `about:`, and anything unparseable — is not a
 * provider host. That is not a fail-open: a `data:` URL cannot reach MapTiler,
 * so blocking it would cost the app its own inline resources and buy nothing.
 */
export function providerOf(requestUrl: string): ExternalProvider | null {
  let host: string;
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  for (const { provider, domain } of PROVIDER_DOMAINS) {
    // `endsWith("." + domain)` and never `includes(domain)`:
    // `maptiler.com.example.net` is somebody else's host.
    if (host === domain || host.endsWith(`.${domain}`)) return provider;
  }
  return null;
}

export type ProviderVerdict =
  /** Not a provider host at all. The overwhelming majority of requests. */
  | "NOT_A_PROVIDER"
  /** A provider host, and this run may not talk to it. */
  | "BLOCKED_BY_DEFAULT"
  /** A provider host, both gates open, and the run is still under its ceiling. */
  | "ALLOWED_UNDER_CEILING"
  /** A provider host, both gates open, and the ceiling is spent. The run has failed. */
  | "REFUSED_CEILING_EXCEEDED";

export interface ProviderDecision {
  readonly verdict: ProviderVerdict;
  readonly provider: ExternalProvider | null;
  /** What to tell the operator, when there is anything to tell. */
  readonly says: string | null;
}

/**
 * Decide one request.
 *
 * `spentSoFar` is how many provider requests this RUN has already been allowed
 * — counted across every context of one browser, because a ceiling that reset
 * per context would be a ceiling a caller could raise by opening another one.
 */
export function decideProviderRequest(
  requestUrl: string,
  policy: ProviderPolicy,
  spentSoFar: number,
): ProviderDecision {
  const provider = providerOf(requestUrl);
  if (provider === null) return { verdict: "NOT_A_PROVIDER", provider: null, says: null };

  if (policy.mode !== "ALLOWED_BOUNDED" || policy.provider !== provider) {
    return {
      verdict: "BLOCKED_BY_DEFAULT",
      provider,
      says:
        `Blocked a ${provider} request. Ordinary automation may not spend this provider's ` +
        "quota; the app falls through to its plain-ground basemap.",
    };
  }

  if (spentSoFar >= policy.ceiling) {
    return {
      verdict: "REFUSED_CEILING_EXCEEDED",
      provider,
      says:
        `CEILING EXCEEDED: this run was allowed ${policy.ceiling} ${provider} request(s) and ` +
        "asked for another. Every further request is refused and the run fails.",
    };
  }

  return { verdict: "ALLOWED_UNDER_CEILING", provider, says: null };
}

/**
 * **What one run actually did**, which is the number a report may quote.
 *
 * `blocked` is the interesting one after this repair lands: on a normal run it
 * is the count of requests the app WOULD have sent and did not, and on an
 * opted-in run it should be zero. `spent` is the only number that costs money.
 */
export interface ProviderLedger {
  readonly policy: ProviderPolicy;
  /** Requests allowed out. This is the quota this run consumed. */
  spent: number;
  /** Requests refused because this run may not spend. */
  blocked: number;
  /** Requests refused because the ceiling was already spent. */
  refused: number;
  /** True once `refused` is non-zero. A run that ends true has failed. */
  exceeded: boolean;
  /** The distinct provider hosts this run touched, for a report. Never a full URL with a key in it. */
  readonly hosts: Set<string>;
}

export function newProviderLedger(policy: ProviderPolicy): ProviderLedger {
  return { policy, spent: 0, blocked: 0, refused: 0, exceeded: false, hosts: new Set<string>() };
}

/** The host of a provider URL, for the ledger. Never the query string — that carries the key. */
export function providerHostOf(requestUrl: string): string {
  try {
    return new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return "unparseable";
  }
}

/** One line naming what a finished run spent and refused. */
export function describeLedger(ledger: ProviderLedger): string {
  const hosts = [...ledger.hosts].sort().join(", ") || "none";
  return (
    `provider access: ${ledger.policy.mode} — ${ledger.spent} request(s) spent, ` +
    `${ledger.blocked} blocked, ${ledger.refused} refused over ceiling ` +
    `${ledger.policy.ceiling}; hosts touched: ${hosts}`
  );
}
