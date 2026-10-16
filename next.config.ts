import type { NextConfig } from "next";

// Static geography is still file-backed. Mutable registry, roster, ballot,
// meeting, vote, finance, profile, and outcome facts resolve canonical
// production pointers and must not be forced back into the deployment bundle.
const staticGeographyTrace = [
  "./data/states/*/geo/**/*.geojson",
  "./data/derived/resolver-geometry.json",
  "./public/geo/*.geojson",
];
const stateOfficeTrace = [
  "./data/reference/fec_state_election_offices.csv",
  "./data/reference/state-cf-agencies.csv",
];

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: process.env.WTP_ATTRIBUTION_BUILD === "1",
  // Load a route's server code on its first request instead of every route on cold start.
  experimental: {
    preloadEntriesOnStart: false,
  },
  // Inline the build's commit at build time; Netlify sets COMMIT_REF only in the build environment.
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
    "/api/location/zip": ["./lib/geo/zcta-centroids.json", "./lib/geo/postal-zips.json"],
    // Start many hunts checks each ZIP against the ZIP index's shards (`lib/control-plane/bulk-hunts/zip-state.ts`).
    // The shard name is computed, so the tracer cannot see it; untraced, every ZIP would read as "not a ZIP the site
    // knows" on production while passing every local test.
    "/api/admin/bulk-hunts": ["./data/derived/zip-divisions/*.json"],
    // The country view counts each state's ZIPs and reads the divisions of a district's ZIPs from the same shards, and a
    // district's place score (the Checklist view of a district) reads them too; the shard names are computed, so the tracer cannot see them.
    "/api/admin/v6/{national,place}": ["./data/derived/zip-divisions/*.json"],
    "/api/admin/geography-preview": [
      "./data/derived/place-reference/**",
    ],
    // `/api/warm` resolves one place per published state, so it reads the same geometry the map routes do.
    "/api/{address/resolve,ballot/scope,demand-signal,meetings,reactions,representation/**,speak,votes,voting-sites,warm}": staticGeographyTrace,
    "/{ballot,about-area}": staticGeographyTrace,
    "/api/meetings": [
      ...staticGeographyTrace,
      ...stateOfficeTrace,
      // The ZIP index shards are read from a literal folder, so the tracer finds them itself.
    ],
    // `lib/coverage/zip-tier.ts` builds this path at runtime, so the tracer cannot see it; untraced, every ZIP would silently read as unworked.
    
    // The warm call reads the ZIP index's state map by path, so it is named here.
    "/api/warm": ["./data/derived/zip-divisions/index.json", ...stateOfficeTrace],
    "/ballot": ["./data/derived/zip-coverage-tiers-runtime.json", ...stateOfficeTrace],
    "/about-area": ["./data/derived/zip-coverage-tiers-runtime.json", ...stateOfficeTrace],
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
