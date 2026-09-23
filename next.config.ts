import type { NextConfig } from "next";

// Static geography is still file-backed. Mutable registry, roster, ballot,
// meeting, vote, finance, profile, and outcome facts resolve canonical
// production pointers and must not be forced back into the deployment bundle.
const staticGeographyTrace = [
  "./data/states/*/geo/**/*.geojson",
  "./data/derived/resolver-geometry.json",
  "./public/geo/*.geojson",
];

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: process.env.WTP_ATTRIBUTION_BUILD === "1",
  /**
   * The build's own identity, inlined at BUILD time — the fix for a premise
   * that turned out to be false (R22, corrected 2026-08-17).
   *
   * `app/api/build/route.ts` read `process.env.COMMIT_REF` at module scope on
   * the stated understanding that Next inlines a statically-visible env
   * reference into the server bundle. It does not: server code keeps the
   * reference as a RUNTIME read, and the built chunk was checked and still
   * contains the literal text `process.env.COMMIT_REF??null`. Netlify sets
   * COMMIT_REF in the BUILD environment and not in the function runtime, so
   * the endpoint read undefined on every request and answered "unknown"
   * forever — which is precisely the quiet failure its own header warned
   * about, arriving through the other door.
   *
   * `env` here is the mechanism that actually inlines: Next substitutes these
   * into the bundle at build. The values are build metadata only — a SHA, a
   * branch name, a deploy context — and never a secret, because anything
   * inlined here is readable by anyone who can read the bundle.
   *
   * Empty string, not "unknown": the route decides how absence renders, and a
   * config that invents a display value would be putting the render default
   * where nobody looks for it.
   */
  env: {
    WTP_BUILD_COMMIT: process.env.COMMIT_REF ?? "",
    WTP_BUILD_BRANCH: process.env.BRANCH ?? "",
    WTP_BUILD_CONTEXT: process.env.CONTEXT ?? "",
    WTP_BUILD_DEPLOY_ID: process.env.DEPLOY_ID ?? "",
    WTP_BUILD_ON_NETLIFY: process.env.NETLIFY ?? "",
  },
  // Only static geography/schema inputs remain file-backed in production.
  // `readdir`/dynamic paths defeat Next's static tracing, so those inputs are
  // named per consuming route. Tracked civic-data first seeds are deliberately
  // absent: production resolves the canonical store and fails closed when its
  // pointer has not been recorded.
  outputFileTracingIncludes: {
    "/api/{address/resolve,ballot/scope,demand-signal,meetings,reactions,representation/**,speak,votes,voting-sites}": staticGeographyTrace,
    "/{ballot,about-area}": staticGeographyTrace,
    "/api/meetings": [
      ...staticGeographyTrace,
      // The coverage-tier ledger (RULING 6, Prompt B item 8). `/api/meetings`
      // reaches it because every GET writes a search-log row and that row
      // carries the tier.
      "./data/derived/zip-coverage-tiers-runtime.json",
      // A ZIP IS AN AREA, on the map too (NJ Hunt 3 item 3.1). This route widens
      // a typed zip to its area so the "Who governs here" card names Rockaway
      // Borough as well as Rockaway Township. Read through process.cwd(), so
      // the tracer cannot see it; untraced, the widening silently does nothing
      // in production and the card goes back to naming one of the two — a
      // regression that looks exactly like honest missing data.
      "./data/derived/zip-divisions/*.json",
    ],
    /*
     * THE LEDGER IS READ THROUGH `process.cwd()`, WHICH NEXT CANNOT SEE.
     *
     * `lib/coverage/zip-tier.ts` builds its path at runtime, so the tracer has
     * no static reference to follow and the file would simply not be in the
     * deploy. The read would throw, the catch would return null, and every zip
     * on production would render "we have not worked this ZIP code out yet"
     * while every sold row was stamped UNKNOWN.
     *
     * That failure is worse than a crash because it is INDISTINGUISHABLE FROM
     * HONEST MISSING DATA: the surface's own gap wording is what a broken
     * deploy would produce, so nothing would look wrong. Named here per route
     * that reaches it.
     *
     * Only the 666 KB runtime file is traced. The 18 MB audit file stays in the
     * repo and out of every function bundle.
     */
    /*
     * RULING 26 (Prompt D item 1, 2026-08-20) removed the hunt-state read from
     * the ballot page: collection state never governs display, and no render
     * path may even import the work queue. `candidate-hunt-state.json` is
     * therefore no longer traced here — it is read by scripts and tests only.
     */
    "/ballot": [
      "./data/derived/zip-coverage-tiers-runtime.json",
      // A ZIP IS AN AREA (NJ01). The national index, one shard per ZIP3, built by `pnpm zip:divisions` and read through
      // `process.cwd()`, so the tracer cannot see it. Absent from the deploy,
      // the ballot silently narrows back to the centroid answer and Rockaway
      // Borough disappears again — a regression that looks exactly like
      // honest missing data, which is why it is named per route.
      "./data/derived/zip-divisions/*.json",
    ],
    "/about-area": ["./data/derived/zip-coverage-tiers-runtime.json"],
    "/api/reactions": ["./data/derived/zip-coverage-tiers-runtime.json"],
    "/api/log": ["./data/derived/zip-coverage-tiers-runtime.json"],
    /*
     * **The schema gate's journal** (Prompt D item 6.1). `readJournal()` reads
     * `lib/db/migrations/meta/_journal.json` through `process.cwd()`, and a
     * file read that way is absent from a Netlify deploy unless the tracer is
     * told. Untraced, the route would throw on every request and answer 500 —
     * a gate that reports its own absence as an outage, which is a better
     * failure than a silent pass and still not one anybody should ship.
     */
    "/api/schema": ["./lib/db/migrations/meta/_journal.json"],
    // Ask still needs the static geographic indexes used to resolve an area.
    // Its civic facts come from promoted pointers and are intentionally not
    // deployment-traced from tracked first-seed JSON.
    "/api/ask/grounded": [
      ...staticGeographyTrace,
      "./data/derived/zip-coverage-tiers-runtime.json",
      "./data/derived/zip-divisions/*.json",
    ],
    // Admin places registered bodies on ZIP codes with the same national
    // index (`app/(admin)/_mw/data/geography.ts`, `load-bodies.ts`), read one
    // shard at a time through process.cwd().
    "/admin/**": ["./data/derived/zip-divisions/*.json"],
    "/readiness/**": ["./data/derived/zip-divisions/*.json"],
    "/api/admin/geography-preview": ["./data/derived/zip-divisions/*.json"],
  },
  // The demo is unlisted. Platform-level visibility is the access control;
  // this keeps every route out of search indexes regardless of what a crawler
  // reaches. public/robots.txt and the netlify.toml header rule say the same
  // thing at their own layers. Remove all three together at public launch.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
