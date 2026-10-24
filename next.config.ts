import type { NextConfig } from "next";
import { BALLOT_CACHE_RULES } from "./lib/reader/ballot-cache.ts";

// Static geography is file-backed; mutable civic facts resolve production pointers.
const staticGeographyTrace = [
  // State geometry is read from the reader edge store; only its manifest is packed (lib/geo/state-geometry.ts).
  "./data/derived/state-geometry.json",
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
      // The selected remote provider serves the existing portrait URLs.
      beforeFiles: ["officials", "candidates"].map(family => ({
        source: `/${family}/:path*`, destination: `/api/portraits/${family}/:path*`,
      })),
      afterFiles: [], fallback: [],
    };
  },
  // Computed paths need explicit traces for static geography and schema inputs.
  // Mutable civic facts resolve the canonical store instead of bundled first seeds.
  // No function packs state geometry: the reader edge store serves each file (lib/geo/state-geometry.ts).
  outputFileTracingExcludes: { "/*": ["./data/states/*/geo/**"] },
  outputFileTracingIncludes: {
    "/api/reader/state": stateOfficeTrace,
    // The geography preview uses generated source references; readers query the place map.
    "/api/admin/geography-preview": [
      "./data/derived/place-reference/**",
    ],
    "/api/{address/resolve,ballot/scope,demand-signal,meetings,reactions,representation/**,speak,votes,voting-sites}": staticGeographyTrace,
    "/{ballot,about-area}": staticGeographyTrace,
    "/api/meetings": [
      ...staticGeographyTrace,
      ...stateOfficeTrace,
    ],
    // The coverage tier path is computed at runtime, so static tracing cannot discover it.
    "/ballot": ["./data/derived/zip-coverage-tiers-runtime.json", ...stateOfficeTrace],
    "/about-area": ["./data/derived/zip-coverage-tiers-runtime.json", ...stateOfficeTrace],
    "/api/reactions": ["./data/derived/zip-coverage-tiers-runtime.json"],
    "/api/log": ["./data/derived/zip-coverage-tiers-runtime.json"],
    // The schema gate resolves its journal through process.cwd().
    "/api/schema": ["./lib/db/migrations/meta/_journal.json"],
  },
  // The unlisted demo stays out of search indexes alongside robots.txt and Netlify headers.
  async headers() {
    return [
      ...BALLOT_CACHE_RULES,
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
