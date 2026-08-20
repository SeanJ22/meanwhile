import type { NextConfig } from "next";

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
  // The API route reads committed data files off the filesystem at runtime —
  // the boundary GeoJSON, the registry, the officeholder rosters, and the
  // meetings snapshot. `readdir`/dynamic paths defeat Next's static tracing,
  // so on a serverless host the files would silently be absent from the
  // function bundle without this. Locally it changes nothing.
  outputFileTracingIncludes: {
    "/api/meetings": [
      "./public/geo/**",
      "./lib/registry/*.json",
      "./data/*.json",
      // The coverage-tier ledger (RULING 6, Prompt B item 8). `/api/meetings`
      // reaches it because every GET writes a search-log row and that row
      // carries the tier.
      "./data/derived/zip-coverage-tiers-runtime.json",
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
     * RULING 18's hunt states (Prompt C item 2). Named explicitly rather than
     * left to the tracer, because the failure mode is the worst kind: an
     * unreadable file reads as "nothing has been hunted", which withholds
     * EVERY contest on the ballot behind the equal-depth gate — and a ballot
     * page that withholds everything looks exactly like a ballot page doing
     * its job. The other data/ballot files are traced today by the tracer's
     * static read of a literal join(); this one does not rely on that.
     */
    "/ballot": [
      "./data/derived/zip-coverage-tiers-runtime.json",
      "./data/ballot/candidate-hunt-state.json",
    ],
    "/about-area": ["./data/derived/zip-coverage-tiers-runtime.json"],
    "/api/reactions": ["./data/derived/zip-coverage-tiers-runtime.json"],
    "/api/log": ["./data/derived/zip-coverage-tiers-runtime.json"],
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
