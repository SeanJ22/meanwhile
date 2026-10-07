/** The origins this repository publishes under, each named for what it is, defined once. */

/** The canonical public production origin. */
export const PUBLIC_SITE_ORIGIN = "https://meanwhileusa.com";

/** The staging origin: a separate concept from production, not a mode of it. */
export const STAGING_RENDER_ORIGIN = "https://test.meanwhileusa.com";

/** The owner's control-centre origin: a domain alias on the same site, routed by host and gated by a server-side secret. */
export const ADMIN_ORIGIN = "https://admin.meanwhileusa.com";

/** The former host, kept for its redirect and for reading old records; never a target for new work. */
export const LEGACY_NETLIFY_ORIGIN = "https://sparkwtp.netlify.app";

/** The Netlify site identity, not an origin: the API accepts the default subdomain as the site id, which did not change with the public domain. */
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

/** Which of our origins a URL belongs to, or null; the legacy host is deliberately not one of ours. */
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

/** Whether this URL is the production origin; one comparison for every caller. */
export function isProductionOrigin(url: string): boolean {
  return originRole(url) === "production";
}
