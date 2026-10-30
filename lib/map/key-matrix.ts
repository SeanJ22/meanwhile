/** Saved map-key identities and their exact origins. The production build inlines the saved browser key. */

import { PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN } from "../ops/origins.ts";

/** The four questions a key may answer. One each, and never two. */
export type KeyIdentityName =
  | "meanwhile-prod-browser"
  | "meanwhile-staging-browser"
  | "meanwhile-synthetic-provider-smoke"
  | "none";

/** Deploy audiences used for map usage attribution. */
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
  /** Exact permitted origins; no wildcards. */
  readonly allowedOrigins: readonly string[];
  /** The saved key name and the audiences it serves. */
  readonly keyName: string | null;
  readonly contexts: readonly DeployContext[];
}

/** Production map requests use these canonical origins. */
export const PRODUCTION_READER_ORIGINS: readonly string[] = [
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_ORIGIN.replace("https://", "https://www."),
];

/** The staging Reader the owner reviews by hand. */
export const STAGING_READER_ORIGIN = STAGING_RENDER_ORIGIN;

/** The dedicated origin used by the bounded provider check. */
export const SMOKE_ORIGIN = "http://maptiler-smoke.localhost";

/** The matrix. */
export const KEY_MATRIX: readonly KeyIdentity[] = [
  {
    name: "meanwhile-prod-browser",
    answers:
      "How much of the allowance did the public production Reader spend? After MAPQ-1 this is " +
      "public-origin traffic plus any bounded probe named in the source registry's MapTiler row, and nothing else.",
    allowedOrigins: PRODUCTION_READER_ORIGINS,
    keyName: "NEXT_PUBLIC_MAPTILER_KEY",
    contexts: ["production"],
  },
  {
    name: "meanwhile-staging-browser",
    answers:
      "How much did the owner's manual staging review spend? Normal robots still cannot reach " +
      "the provider from a staging build — MAPQ-1 blocks them at the harness, not at the key.",
    allowedOrigins: [STAGING_READER_ORIGIN],
    keyName: "NEXT_PUBLIC_MAPTILER_KEY",
    contexts: ["branch-deploy:staging"],
  },
  {
    name: "meanwhile-synthetic-provider-smoke",
    answers:
      "How much did the one explicit, opted-in, capped provider smoke spend? Its number is " +
      "expected to be small, countable, and attributable to a named command.",
    allowedOrigins: [SMOKE_ORIGIN],
    keyName: "WTP_MAPTILER_SMOKE_KEY",
    contexts: ["synthetic-provider-smoke"],
  },
  {
    name: "none",
    answers:
      "Nothing. Local development, CI and preview deploys carry no browser key at all, so the " +
      "Reader draws its plain-ground fallback basemap and spends nobody's allowance.",
    allowedOrigins: [],
    keyName: null,
    contexts: ["local", "ci", "deploy-preview", "branch-deploy:other"],
  },
];

/** Each deploy audience has exactly one map usage identity. */
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

/** The bounded provider check must use its dedicated saved key. */
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
        "The bounded map test has no saved key. " +
        "Check the Keys box and the existing source decision.",
    };
  }
  if (production !== "" && smoke === production) {
    return {
      ok: false,
      says:
        "REFUSING: the dedicated map test key is the same value as NEXT_PUBLIC_MAPTILER_KEY. " +
        "Check its saved value and dedicated origin in the Keys box.",
    };
  }
  return { ok: true };
}

/** Style URL for the dedicated provider check. */
export function smokeStyleUrl(style: string, key: string): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`;
}
