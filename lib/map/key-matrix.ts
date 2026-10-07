/**
 * One MapTiler key, one question: each browser key serves exactly one
 * population, so usage counted against a key is attributable.
 *
 * A declaration, as data. The app reads one variable,
 * `NEXT_PUBLIC_MAPTILER_KEY`, inlined at build time, so which key a bundle
 * carries is a property of the deploy context. This file holds:
 *
 *   - the identities, their allowed origins and env destinations;
 *   - the invariant that no two identities share a deploy context;
 *   - the invariant that local, CI and preview carry no browser key;
 *   - a runtime refusal, used by `scripts/provider-smoke.mts`, when the smoke
 *     is handed the production key.
 *
 * The restrictions themselves live in the MapTiler account
 * (`docs/maptiler-keys.md`); nothing here is evidence they are configured.
 */

import { PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN } from "../ops/origins.ts";

/** The four questions a key may answer. One each, and never two. */
export type KeyIdentityName =
  | "meanwhile-prod-browser"
  | "meanwhile-staging-browser"
  | "meanwhile-synthetic-provider-smoke"
  | "none";

/**
 * Where a bundle is built. These are Netlify's own deploy contexts plus the
 * two places a browser runs outside Netlify entirely.
 */
export type DeployContext =
  | "production"
  | "branch-deploy:staging"
  | "deploy-preview"
  | "branch-deploy:other"
  | "ci"
  | "local"
  | "synthetic-provider-smoke";

export interface KeyIdentity {
  readonly name: KeyIdentityName;
  /** What this key exists to answer. One sentence, plain. */
  readonly answers: string;
  /**
   * The exact origins the MapTiler account must allow for this key. Exact
   * hosts, never a wildcard, which would merge other subdomains into
   * production's count. Empty means the key does not exist.
   */
  readonly allowedOrigins: readonly string[];
  /** The environment variable, and the deploy contexts it is scoped to. */
  readonly envVar: string | null;
  readonly contexts: readonly DeployContext[];
}

/**
 * Every production Reader host, and nothing else, may spend the production
 * key. Derived from `lib/ops/origins.ts`. The `www` form is listed because it
 * redirects to the apex and still loads the Reader.
 */
export const PRODUCTION_READER_ORIGINS: readonly string[] = [
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_ORIGIN.replace("https://", "https://www."),
];

/** The staging Reader the owner reviews by hand. */
export const STAGING_READER_ORIGIN = STAGING_RENDER_ORIGIN;

/**
 * The origin the bounded smoke runs on: a page `scripts/provider-smoke.mts`
 * fabricates itself, on a `.localhost` name (loopback by specification).
 */
export const SMOKE_ORIGIN = "http://maptiler-smoke.localhost";

/** The matrix. `docs/maptiler-keys.md` is generated from the same facts. */
export const KEY_MATRIX: readonly KeyIdentity[] = [
  {
    name: "meanwhile-prod-browser",
    answers:
      "How much of the allowance did the public production Reader spend? After MAPQ-1 this is " +
      "public-origin traffic plus any bounded probe named in docs/maptiler-keys.md, and nothing else.",
    allowedOrigins: PRODUCTION_READER_ORIGINS,
    envVar: "NEXT_PUBLIC_MAPTILER_KEY",
    contexts: ["production"],
  },
  {
    name: "meanwhile-staging-browser",
    answers:
      "How much did the owner's manual staging review spend? Normal robots still cannot reach " +
      "the provider from a staging build — MAPQ-1 blocks them at the harness, not at the key.",
    allowedOrigins: [STAGING_READER_ORIGIN],
    envVar: "NEXT_PUBLIC_MAPTILER_KEY",
    contexts: ["branch-deploy:staging"],
  },
  {
    name: "meanwhile-synthetic-provider-smoke",
    answers:
      "How much did the one explicit, opted-in, capped provider smoke spend? Its number is " +
      "expected to be small, countable, and attributable to a named command.",
    allowedOrigins: [SMOKE_ORIGIN],
    envVar: "WTP_MAPTILER_SMOKE_KEY",
    contexts: ["synthetic-provider-smoke"],
  },
  {
    name: "none",
    answers:
      "Nothing. Local development, CI and preview deploys carry no browser key at all, so the " +
      "Reader draws its plain-ground fallback basemap and spends nobody's allowance.",
    allowedOrigins: [],
    envVar: null,
    contexts: ["local", "ci", "deploy-preview", "branch-deploy:other"],
  },
];

/**
 * Which identity a deploy context is served by. Exactly one, always: two
 * reachable keys is how usage crosses environments.
 */
export function keyIdentityFor(context: DeployContext): KeyIdentity {
  const matches = KEY_MATRIX.filter((k) => k.contexts.includes(context));
  if (matches.length !== 1) {
    throw new Error(
      `keyIdentityFor(${context}): ${matches.length} identities claim this deploy context. ` +
        "Exactly one may, or a key is reachable from an environment it was not issued for.",
    );
  }
  return matches[0];
}

export type SharedKeyVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly says: string };

/**
 * The smoke refuses to run when the value it was handed is the production
 * key, the one cross-environment mistake detectable here (a machine may hold
 * both). Values are compared, never logged, returned or rendered.
 */
export function refuseSharedKey(input: {
  readonly smokeKey: string | undefined;
  readonly productionKey: string | undefined;
}): SharedKeyVerdict {
  const smoke = (input.smokeKey ?? "").trim();
  const production = (input.productionKey ?? "").trim();
  if (smoke === "") {
    return {
      ok: false,
      says:
        "WTP_MAPTILER_SMOKE_KEY is not set, so there is no key issued to the bounded smoke. " +
        "This is NEEDS OWNER, not a failure of the smoke: see docs/maptiler-keys.md.",
    };
  }
  if (production !== "" && smoke === production) {
    return {
      ok: false,
      says:
        "REFUSING: the key handed to the bounded provider smoke is the same value as " +
        "NEXT_PUBLIC_MAPTILER_KEY. Spending it here would file synthetic requests under the " +
        "production key and make production usage unreadable again, which is the exact defect " +
        "this repair exists to close. Issue meanwhile-synthetic-provider-smoke in the MapTiler " +
        "account, restricted to " + SMOKE_ORIGIN + ", and set WTP_MAPTILER_SMOKE_KEY to it.",
    };
  }
  return { ok: true };
}

/**
 * The style URL the smoke asks for, built the same shape as
 * `lib/map/style.ts` but from a different key variable.
 */
export function smokeStyleUrl(style: string, key: string): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`;
}
