/**
 * **ONE KEY, ONE QUESTION** — MAPQ-3, 2026-09-07.
 *
 * ## Why a bill of 101,863 requests could not be read
 *
 * The first MapTiler billing period overran a 100,000-request free allowance
 * while public readership was tiny, and nothing in the account could say which
 * requests were readers and which were ours, because **one public browser key
 * served every environment**: production, staging, preview deploys, local
 * `next dev`, and every Playwright capture and walk that carried `.env.local`.
 * A single number cannot answer a question about four populations.
 *
 * MAPQ-1 stops our automation reaching the provider at all. That removes the
 * traffic. This file removes the AMBIGUITY, which is the part that survives:
 * after it, a request counted against the production key came from a
 * production Reader origin, and a request counted against any other key came
 * from the one place that key is installed.
 *
 * ## What this file is and is not
 *
 * It is a DECLARATION, and it is deliberately data rather than behaviour. The
 * app reads exactly one variable — `NEXT_PUBLIC_MAPTILER_KEY` — and always
 * has; Next inlines it at BUILD time, so which key a bundle carries is a
 * property of the deploy context that built it, not of anything this code can
 * decide at runtime. Inventing a second secret system to route between keys
 * would put a second source of truth beside Netlify's scoped environment
 * variables, which is the thing the brief forbids.
 *
 * So the enforcement this file can honestly carry is:
 *
 *   - the identities, their allowed origins and their env destinations, in one
 *     place a test can walk and a report can quote;
 *   - the invariant that no two identities share a deploy context, so a key
 *     cannot be reached from an environment it was not issued for;
 *   - the invariant that local, CI and preview carry NO browser key, so the
 *     fallback basemap is the expected local picture;
 *   - a runtime refusal, used by `scripts/provider-smoke.mts`, when the value
 *     handed to the bounded smoke is the same string as the production key —
 *     which is the one cross-environment mistake a machine here can actually
 *     detect, because it is the only moment both values are in one process.
 *
 * **The restrictions themselves live in the MapTiler account**, and this file
 * does not claim they exist. `docs/maptiler-keys.md` carries the owner-action
 * card with the exact names and origins; nothing here may be read as evidence
 * that the account has been configured.
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
   * The exact origins the MapTiler account must allow for this key.
   *
   * **Exact hosts, never a wildcard.** A wildcard across our own domain would
   * be convenient and would merge admin, staging and any future subdomain into
   * production's number — which is precisely the ambiguity that made the first
   * bill unreadable. Empty means the key does not exist, so no origin allows it.
   */
  readonly allowedOrigins: readonly string[];
  /** The environment variable, and the deploy contexts it is scoped to. */
  readonly envVar: string | null;
  readonly contexts: readonly DeployContext[];
}

/**
 * Every production Reader host, and nothing else, may spend the production key.
 *
 * Derived from `lib/ops/origins.ts` rather than written again: that module is
 * the single place this repository names its own hosts, and
 * `tests/origins.test.ts` refuses a second copy. The `www` form is listed
 * because Netlify's certificate covers it and it 301s to the apex — a redirect
 * still loads the Reader afterwards, and a key restricted only to the apex
 * would fail for anyone who typed `www`. If `www` ever stops serving the
 * Reader, it comes out of the MapTiler allowlist and out of here together.
 */
export const PRODUCTION_READER_ORIGINS: readonly string[] = [
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_ORIGIN.replace("https://", "https://www."),
];

/** The staging Reader the owner reviews by hand. */
export const STAGING_READER_ORIGIN = STAGING_RENDER_ORIGIN;

/**
 * The origin the bounded smoke actually runs on.
 *
 * `scripts/provider-smoke.mts` fabricates this page itself rather than needing
 * a server, so the origin is narrow by construction and belongs to nothing
 * else. It is a `.localhost` name, which resolves to the loopback interface by
 * specification and which MapTiler's key restrictions accept as an origin.
 */
export const SMOKE_ORIGIN = "http://maptiler-smoke.localhost";

/**
 * **THE MATRIX.** `tests/maptiler-key-matrix.test.ts` walks it, and
 * `docs/maptiler-keys.md` is generated from the same facts.
 */
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
 * Which identity a deploy context is served by. Exactly one, always.
 *
 * A context that matched two identities would be a context from which two keys
 * are reachable, and two reachable keys is how usage crosses environments.
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
 * **THE ONE CROSS-ENVIRONMENT MISTAKE A MACHINE HERE CAN CATCH.**
 *
 * Which key a deployed bundle carries is decided by Netlify's scoped
 * variables, and no code in this repository can read another environment's
 * value to compare against. But the bounded smoke runs on a machine that may
 * hold BOTH — `.env.local` carries the production browser key today — and at
 * that moment the comparison is real and cheap.
 *
 * So the smoke refuses to run when the value it was handed is the production
 * value. Refusing costs a smoke run; not refusing costs the attribution this
 * whole repair is for, because smoke traffic would land in production's number
 * and the panel would report robot requests as public-site usage.
 *
 * Values are compared, never logged, never returned, and never rendered.
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
 * The style URL the smoke asks for, built the way `lib/map/style.ts` builds it.
 *
 * Deliberately the same shape rather than the same function: `resolveBasemap`
 * reads `process.env.NEXT_PUBLIC_MAPTILER_KEY`, and the entire point of the
 * smoke is that it uses a DIFFERENT key. Sharing the constructor would mean
 * sharing the key, and `tests/maptiler-key-matrix.test.ts` asserts the two
 * agree on everything except which variable the key came from.
 */
export function smokeStyleUrl(style: string, key: string): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`;
}
