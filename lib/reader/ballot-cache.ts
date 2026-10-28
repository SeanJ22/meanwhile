export const BALLOT_CACHE_VARY = "query=zip|state|lat|lng|_rsc";

/** Middleware's verdict, sent to the origin as a request header and never taken from the reader's request. */
export const BALLOT_CACHE_HEADER = "x-meanwhile-ballot-cache";
/* Netlify stores what the origin answers; headers middleware adds are applied after the cache. So the origin's own
   response carries the lifetime and the state's purge tag, read from the verdict, and anything without one is never stored. */
const verdict = { type: "header" as const, key: BALLOT_CACHE_HEADER };
export const BALLOT_CACHE_RULES = [
  { source: "/ballot", has: [{ ...verdict, value: "(?<ttl>\\d{1,5});(?<tags>reader-state:[A-Z]{2}(?:,reader-state:[A-Z]{2})*)" }], headers: [
    { key: "Netlify-Vary", value: BALLOT_CACHE_VARY },
    { key: "Netlify-CDN-Cache-Control", value: "public, durable, max-age=:ttl, must-revalidate" },
    { key: "Netlify-Cache-Tag", value: ":tags,reader-national-people,reader-settings" },
  ] },
  { source: "/ballot", missing: [verdict], headers: [
    { key: "Netlify-Vary", value: BALLOT_CACHE_VARY },
    { key: "Netlify-CDN-Cache-Control", value: "no-store" },
  ] },
];
