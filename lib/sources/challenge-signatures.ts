/**
 * Bot-challenge signatures, in a pure leaf (no imports, no network) so the access-control rule in
 * `lib/hunt/access-control.ts` can judge a challenge page without importing the adapter transport. A
 * challenge is an access control: it is recognised so a fetcher records a wall instead of a document,
 * never so it can be solved or evaded.
 */

/**
 * The size floor is per signature. A signature naming a vendor's own challenge machinery cannot appear in
 * a real article, so it gets no floor; only loose prose signatures keep one (a long article that quotes
 * "Checking your browser" is a page, not a wall).
 */
export const CHALLENGE_SIGNATURES: readonly {
  name: string;
  test: RegExp;
  /** Bytes above which this signature is not trusted. Absent means any size. */
  maxBytes?: number;
}[] = [
  { name: "Fastly/Imperva client challenge", test: /<title>\s*Client Challenge\s*<\/title>/i },
  { name: "Cloudflare 'just a moment'", test: /<title>\s*Just a moment\.\.\.\s*<\/title>/i },
  // The modern managed challenge, and the three marks that are unambiguous: `window._cf_chl_opt`, the
  // Turnstile widget host, and the prose line.
  // The Turnstile host counts only as a script the page loads; a resource hint (`rel="preconnect"`) on a
  // real page is not a challenge.
  {
    name: "Cloudflare managed challenge",
    test: /window\._cf_chl_opt|<script\b[^>]*challenges\.cloudflare\.com|Performing security verification/i,
  },
  { name: "Cloudflare attention-required", test: /Attention Required!\s*\|\s*Cloudflare/i },
  { name: "Imperva/Incapsula", test: /_Incapsula_Resource|Incapsula incident ID/i },
  { name: "PerimeterX", test: /px-captcha|PerimeterX/i },
  // A bare CAPTCHA page. Neither mark occurs in a real government page.
  { name: "CAPTCHA page", test: /<title>\s*captcha\s*<\/title>|JavaScript is required to complete this challenge/i },
  // The two that keep the floor. `cdn-cgi/challenge-platform` is not a challenge marker on its own:
  // Cloudflare injects `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into ordinary pages as a beacon.
  {
    name: "Cloudflare interstitial",
    test: /cdn-cgi\/challenge-platform|cf-browser-verification/i,
    maxBytes: 20_000,
  },
  { name: "browser check", test: /Checking your browser before accessing/i, maxBytes: 20_000 },
];

/** The named wall, or null when the body is a real page. */
export function challengeIn(text: string): string | null {
  return (
    CHALLENGE_SIGNATURES.find(
      (s) => (s.maxBytes === undefined || text.length <= s.maxBytes) && s.test.test(text),
    )?.name ?? null
  );
}
