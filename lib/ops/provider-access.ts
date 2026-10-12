/** Our robots do not spend a third party's quota: provider hosts are blocked by default for synthetic runs. */

/** The providers this module knows how to bound. One, for now, and named. */
export const MAPTILER = "maptiler";
export type ExternalProvider = typeof MAPTILER;

/** The MapTiler hosts the app can reach; a test asserts every one is blocked by default. */
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

/** How many provider requests one opted-in run may make, sized for a bounded smoke and nothing larger. */
export const DEFAULT_PROVIDER_CEILING = 25;

/** The hardest ceiling any run may ask for. A ceiling nobody can raise is the point. */
export const MAX_PROVIDER_CEILING = 200;

export type ProviderPolicyMode =
  /** The default, and the state of every ordinary synthetic run. */
  | "BLOCKED"
  /** Both gates open: this run may spend, up to `ceiling`. */
  | "ALLOWED_BOUNDED"
  /** The call site asked to spend and the environment never allowed it; blocked, and named so the smoke fails with the reason. */
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

/** The policy for one run from both gates, code and environment; neither alone opens the door. */
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

/** Which provider a URL belongs to, or null; only http and https can carry a request to a provider. */
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

/** Decide one request; `spentSoFar` counts across every context of one browser. */
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

/** What one run actually did; `spent` is the only number that costs money. */
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
