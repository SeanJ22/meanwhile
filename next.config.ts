import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
