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
   * A cold server loads the route it was asked for, not every route (C21,
   * 2026-09-24: a load over 3 s is not a win).
   *
   * Netlify's runtime (`@netlify/plugin-nextjs` 5.16.0) starts Next as a full
   * server through `getRequestHandlers`, not in minimal mode, and passes this
   * config through unchanged. Next's default `preloadEntriesOnStart: true`
   * therefore requires EVERY route's server code before a new function
   * instance answers its first request, and on serverless each burst of
   * traffic after idle lands on new instances.
   *
   * Measured 2026-09-24: ten concurrent `/api/build` requests after idle took
   * 5.35-5.91 s end to end, of which the function logs put 3.2-3.8 s inside
   * the handler (warm: 10-280 ms). On a local standalone build, spawn to first
   * `/api/build` answer took 745-814 ms with the preload and 496-500 ms
   * without it, three runs each.
   *
   * Off, an instance loads a route's code on that route's first request, so
   * a route pays for itself and nothing else.
   */
  experimental: {
    preloadEntriesOnStart: false,
  },
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
  async rewrites() {
    if (process.env.WTP_VAULT_PROVIDER !== "netlify") return [];
    return {
      // Use the selected remote provider even while retained public originals
      // still exist. Enable it in the destination project's build settings
      // after the transfer; existing URLs remain the same.
      beforeFiles: ["officials", "candidates"].map(family => ({
        source: `/${family}/:path*`, destination: `/api/portraits/${family}/:path*`,
      })),
      afterFiles: [], fallback: [],
    };
  },
  // Only static geography/schema inputs remain file-backed in production.
  // `readdir`/dynamic paths defeat Next's static tracing, so those inputs are
  // named per consuming route. Tracked civic-data first seeds are deliberately
  // absent: production resolves the canonical store and fails closed when its
  // pointer has not been recorded.
  outputFileTracingIncludes: {
    "/{api/ask/grounded,ballot,api/warm}": ["./data/states/*/funding/source-registration.json"],
    // Start many hunts checks each ZIP against the ZIP index's shards (`lib/control-plane/bulk-hunts/zip-state.ts`).
    // The shard name is computed, so the tracer cannot see it; untraced, every ZIP would read as "not a ZIP the site
    // knows" on production while passing every local test.
    "/api/admin/bulk-hunts": ["./data/derived/zip-divisions/*.json"],
    // The country view counts each state's ZIPs and reads the divisions of a district's ZIPs from the same shards, and a
    // district's place score (the Checklist view of a district) reads them too; the shard names are computed, so the tracer cannot see them.
    "/api/admin/v6/{national,place}": ["./data/derived/zip-divisions/*.json"],
    "/api/admin/geography-preview": [
      "./data/derived/place-reference/**",
      "./lib/control-plane/expansion/reference/az-fire-district-territory.json",
    ],
    // `/api/warm` resolves one place per published state on each instance it
    // warms (C21, 2026-09-25), so it reads the same committed geometry the map
    // routes do; untraced, that priming would fail on production and warm
    // nothing while passing every local test.
    "/api/{address/resolve,ballot/scope,demand-signal,meetings,reactions,representation/**,speak,votes,voting-sites,warm}": staticGeographyTrace,
    "/{ballot,about-area}": staticGeographyTrace,
    "/api/meetings": [
      ...staticGeographyTrace,
      // The coverage-tier ledger is NOT traced here any more (C21, 2026-09-25).
      // This route reached it only through its search-log row, and that row
      // moved to the client's `/api/log` beacon (PDC-9; `/api/log` still
      // traces the ledger below). Nothing this route imports reads it now —
      // tests/coverage-tier.test.ts asserts that. The file still ships for the
      // routes below, which share this site's one server function.
      //
      // A ZIP IS AN AREA, on the map too (NJ Hunt 3 item 3.1): this route
      // widens a typed zip to its area with the national ZIP index. Its shards
      // are read from a literal folder (`lib/geo/zip-division-index.ts`), so the
      // tracer follows them itself; naming them here too would list each twice.
      // The postbuild reader-trace check fails the build if one is missing —
      // untraced, the widening would silently do nothing, which looks exactly
      // like honest missing data.
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
    // A ZIP IS AN AREA (NJ01): the ballot widens a ZIP with the national
    // index, traced by the tracer from its literal folder and proved present
    // by the postbuild reader-trace check (see `/api/meetings`).
    // The warm call picks each state's place from the ZIP index's state map
    // (`lowestZipByDivision`), read by path; named so the postbuild
    // reader-trace check can hold it present (C21).
    "/api/warm": ["./data/derived/zip-divisions/index.json"],
    "/ballot": ["./data/derived/zip-coverage-tiers-runtime.json"],
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
    // The ZIP index's shards are named for Ask because its declared ZIP-area
    // requirement (`lib/holdings/reader-trace.ts`) includes them while its
    // import graph does not reach the index, so the tracer alone would not.
    "/api/ask/grounded": [
      ...staticGeographyTrace,
      "./data/derived/zip-coverage-tiers-runtime.json",
      "./data/derived/zip-divisions/*.json",
    ],
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
