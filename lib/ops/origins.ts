/**
 * **THE THREE ORIGINS, EACH NAMED FOR WHAT IT IS.**
 * (Session C final, ITEM F, 2026-09-01.)
 *
 * ## What went wrong
 *
 * The production host was a STRING LITERAL — `https://sparkwtp.netlify.app` —
 * repeated across the post-deploy observer, the walk, a dozen probe and shoot
 * scripts, a bot user-agent, two workflow comments and a test's notion of "our
 * own origin". Thirty-odd copies of one fact. When the site moved to
 * `meanwhileusa.com` every one of them became a claim about a host the product
 * no longer serves from, and the failure mode is the quiet kind: an observer
 * polling the OLD host still gets a 200 (Netlify keeps answering on the site's
 * default subdomain), so it reports HELD about a host no reader visits.
 *
 * **A fact repeated thirty times is thirty facts that can disagree.**
 *
 * ## The rule this file exists to enforce
 *
 * Three origins, three names, and they are NEVER interchangeable:
 *
 * | Constant | Host | What it means |
 * | --- | --- | --- |
 * | `PUBLIC_SITE_ORIGIN` | `meanwhileusa.com` | what a reader loads |
 * | `STAGING_RENDER_ORIGIN` | `test.meanwhileusa.com` | the integration branch's deploy |
 * | `ADMIN_ORIGIN` | `admin.meanwhileusa.com` | the owner's control centre |
 *
 * **The production origin is never overloaded to select staging or admin
 * behaviour.** Observer and render-target code receives the origin it is meant
 * to read, BY NAME, passed explicitly. A single `SITE_ORIGIN` that some caller
 * flips to a staging value is how a staging run gets recorded as a production
 * verification, and a production verification is the one record in this
 * repository that may never be approximate.
 *
 * ## What is deliberately NOT an origin
 *
 * `NETLIFY_SITE_ID_DEFAULT` is the site's IDENTITY on the Netlify API, not a
 * public address. The deploy-record reader asks Netlify `/sites/<id>/deploys`
 * and that `<id>` is still the site's default subdomain, because renaming the
 * public domain does not rename the site. Keeping the two apart is the point:
 * the deploy reader must keep working if the public domain moves again.
 *
 * `LEGACY_NETLIFY_ORIGIN` is retained for exactly two jobs — the 301 that
 * forwards the old host to the new one, and reading historical records that
 * were written against it. It is not a fallback and nothing new may target it.
 */

/**
 * **The canonical public production origin.** What a reader types, what
 * canonical/OG URLs are built from, what the production-integrity observer
 * polls, and what a `PRODUCTION_RENDER` suite run targets.
 *
 * Live on Netlify DNS with a Let's Encrypt wildcard for `*.meanwhileusa.com`;
 * `www` 301s to the apex.
 */
export const PUBLIC_SITE_ORIGIN = "https://meanwhileusa.com";

/**
 * **The staging origin.** The `staging` branch's Netlify branch deploy, against
 * the Neon staging branch. A `STAGING_RENDER` suite run targets this.
 *
 * It is a SEPARATE CONCEPT from production, not a mode of it (R-C10).
 */
export const STAGING_RENDER_ORIGIN = "https://test.meanwhileusa.com";

/**
 * **The owner's control-centre origin.** A domain alias on the same Netlify
 * site, routed by host in middleware, gated by a server-side secret. Every
 * admin route 404s on {@link PUBLIC_SITE_ORIGIN}'s host.
 */
export const ADMIN_ORIGIN = "https://admin.meanwhileusa.com";

/**
 * The host the site served from before 2026-09-01. Kept for the 301 and for
 * reading records written against it. **Never a target for new work.**
 */
export const LEGACY_NETLIFY_ORIGIN = "https://sparkwtp.netlify.app";

/**
 * The Netlify SITE identity — not an origin. `scripts/deploy-live.mjs` and
 * `scripts/handoff.mjs` ask the Netlify API about this site; the API accepts
 * the default subdomain as an id, and that id did not change when the public
 * domain did.
 */
export const NETLIFY_SITE_ID_DEFAULT = "sparkwtp.netlify.app";

/** Every origin this repository publishes under, keyed by its role. */
export const ORIGINS = {
  production: PUBLIC_SITE_ORIGIN,
  staging: STAGING_RENDER_ORIGIN,
  admin: ADMIN_ORIGIN,
} as const;

/** The role names a render target may carry. */
export type OriginRole = keyof typeof ORIGINS;

/** The bare host of an origin, with no scheme and no trailing slash. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/**
 * Which of our origins does this URL belong to, if any?
 *
 * Returns `null` for anything else — including the legacy host, which is
 * deliberately NOT one of ours any more: a run that reaches
 * `sparkwtp.netlify.app` has targeted the wrong place and should be told so
 * rather than quietly accepted.
 */
export function originRole(url: string): OriginRole | null {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  for (const [role, origin] of Object.entries(ORIGINS) as [
    OriginRole,
    string,
  ][]) {
    if (hostOf(origin) === host) return role;
  }
  return null;
}

/**
 * Is this URL the production origin? The observer, the freeze gate and the
 * walk's production branch all turn on this question, and they must all answer
 * it the same way (RULING 103 — one implementation of one comparison).
 */
export function isProductionOrigin(url: string): boolean {
  return originRole(url) === "production";
}
