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
      // A ZIP IS AN AREA, on the map too (NJ Hunt 3 item 3.1). This route widens
      // a typed zip to its area so the "Who governs here" card names Rockaway
      // Borough as well as Rockaway Township. Read through process.cwd(), so
      // the tracer cannot see it; untraced, the widening silently does nothing
      // in production and the card goes back to naming one of the two — a
      // regression that looks exactly like honest missing data.
      "./data/derived/zip-division-ids.json",
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
      // A ZIP IS AN AREA (NJ01). Built by `pnpm zip:divisions`, read through
      // `process.cwd()`, so the tracer cannot see it. Absent from the deploy,
      // the ballot silently narrows back to the centroid answer and Rockaway
      // Borough disappears again — a regression that looks exactly like
      // honest missing data, which is why it is named per route.
      "./data/derived/zip-division-ids.json",
      /*
       * STATE, COUNTY AND LOCAL CAMPAIGN MONEY (RULING 126, 2026-08-24).
       *
       * `lib/funding/state-snapshot.ts` reads these through `process.cwd()`, so
       * the tracer has no static reference to follow. Untraced, the read
       * returns nothing, `stateMoneyForTarget` answers with an empty array, and
       * every state, county and local candidate's Campaign money section goes
       * back to rendering NOTHING — which is indistinguishable from the gap
       * this ruling was adopted to close, and would look exactly like honest
       * missing data.
       */
      "./data/funding/*.json",
    ],
    /*
     * THE QUESTIONNAIRE PAGE RESOLVES AN ID TO A NAME, through `process.cwd()`.
     *
     * `lib/questionnaire/candidacy-display.ts` reads the committed ballot files
     * to turn a candidacy id into what the person is actually called. Untraced,
     * the read throws, the catch returns null, and every candidate lands on the
     * neutral fallback — which reads as a deliberate choice rather than as a
     * missing file, and is exactly the failure that made this list necessary.
     */
    "/questionnaire/[token]": ["./data/ballot/*.json"],
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
    /*
     * **THE ONE ASK ENGINE READS FOUR COMMITTED STORES THROUGH `process.cwd()`**
     * (PR #212 follow-up, 2026-08-28).
     *
     * The meetings snapshot, the ballot sets, the derived ZIP tables and the
     * officeholder rosters. None of those paths is statically visible to the
     * tracer, and an untraced read on a serverless host does not error in a way
     * anybody notices — the catch returns null and Ask reports that we hold no
     * such body, no such contest, and nobody to contact. That is
     * INDISTINGUISHABLE FROM HONEST MISSING DATA, which is the exact reason
     * this list exists at all.
     *
     * Named per route that reaches them, as every other entry here is.
     */
    "/api/ask/grounded": [
      "./data/*.json",
      "./data/ballot/*.json",
      "./data/officials/*.json",
      "./data/derived/zip-coverage-tiers-runtime.json",
      "./data/derived/zip-division-ids.json",
      "./lib/registry/*.json",
    ],
    "/api/ask/agenda": ["./data/*.json"],
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
