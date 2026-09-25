/**
 * **BOT-CHALLENGE SIGNATURES, IN A PURE LEAF.** (Moved out of `lib/sources/http.ts`
 * on 2026-09-25 so the access-control rule in `lib/hunt/access-control.ts` can
 * judge a challenge page without importing the adapter transport.)
 *
 * A challenge is an access control: it is recognised so a fetcher records a
 * WALL instead of a document, never so it can be solved or evaded.
 *
 * PURE: no imports, no network.
 */

/**
 * **THE SIZE FLOOR IS PER-SIGNATURE, NOT GLOBAL** (NH Hunt, 2026-08-20).
 *
 * The floor exists for exactly one signature: a real 260 KB article that
 * quotes "Checking your browser" is a page, not a wall. It was applied to all
 * seven, and that is what let a challenge page through — Cloudflare's current
 * interstitial is **29,809 bytes**, comfortably over the 20 KB floor, so a
 * KEARSARGE REGIONAL SCHOOL DISTRICT board-roster page served as a challenge
 * was handed to the extractor as a document. Layer 5 read the challenge page's
 * own table, found no person in it, and reported `ZERO_ROWS` — a finding about
 * the district's page, when the truth was that we never saw the district's
 * page at all.
 *
 * That is the wall-rendered-as-an-emptiness shape the transparency mandate
 * forbids by name, and it was one line of arithmetic.
 *
 * A signature that names a vendor's own machinery — `cdn-cgi/challenge-platform`,
 * `<title>Just a moment...</title>`, `_Incapsula_Resource` — cannot appear in a
 * real article by accident, so it needs no floor and gets none. Only the loose
 * PROSE signature keeps one.
 */
export const CHALLENGE_SIGNATURES: readonly {
  name: string;
  test: RegExp;
  /** Bytes above which this signature is not trusted. Absent means any size. */
  maxBytes?: number;
}[] = [
  { name: "Fastly/Imperva client challenge", test: /<title>\s*Client Challenge\s*<\/title>/i },
  { name: "Cloudflare 'just a moment'", test: /<title>\s*Just a moment\.\.\.\s*<\/title>/i },
  /*
   * The modern managed challenge, and the three marks that are UNAMBIGUOUS.
   *
   * `window._cf_chl_opt` is the challenge's own options object, the Turnstile
   * widget host is only loaded by a challenge, and the prose line appears
   * nowhere else. Verified against this repo's two `schedulepage` fixtures,
   * which are real pages from a Cloudflare-fronted host: all three are absent
   * from both, and all three are present in the 29,809-byte interstitial
   * Kearsarge served on 2026-08-20.
   */
  /*
   * The Turnstile host counts only as a script the page loads. A resource hint
   * is not a challenge: Chandler, AZ's real City Clerk page (2026-09-24, 210 KB,
   * 33 sittings) carries `<link rel="preconnect" href="https://challenges.cloudflare.com">`
   * for its forms, and reading the bare host as a wall marked it refused.
   */
  {
    name: "Cloudflare managed challenge",
    test: /window\._cf_chl_opt|<script\b[^>]*challenges\.cloudflare\.com|Performing security verification/i,
  },
  { name: "Cloudflare attention-required", test: /Attention Required!\s*\|\s*Cloudflare/i },
  { name: "Imperva/Incapsula", test: /_Incapsula_Resource|Incapsula incident ID/i },
  { name: "PerimeterX", test: /px-captcha|PerimeterX/i },
  /*
   * A bare CAPTCHA page. www.mojeek.com answered its search path with one on 2026-09-25 (HTTP 200, 5,513 bytes,
   * `<title>Captcha</title>`, "JavaScript is required to complete this challenge"). Neither mark occurs in a real
   * government page.
   */
  { name: "CAPTCHA page", test: /<title>\s*captcha\s*<\/title>|JavaScript is required to complete this challenge/i },
  /*
   * The two that KEEP the floor, and why — corrected the same day the floor
   * was made per-signature, because the first version of that change removed
   * it from this one and broke two tests immediately.
   *
   * `cdn-cgi/challenge-platform` is NOT a challenge marker on its own:
   * Cloudflare injects `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into
   * ORDINARY pages as its JS-detections beacon, and both recorded
   * `schedulepage` fixtures — real Morris Hills pages that parse into real
   * meetings — carry it. Reading it as a wall at any size would have marked a
   * working source refused, which is the same defect pointed the other way.
   * The floor is what keeps it usable: an 82 KB agenda page is a page.
   */
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
