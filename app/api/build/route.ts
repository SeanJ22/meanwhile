/**
 * GET /api/build: which commit is serving this response.
 *
 * Netlify sets `COMMIT_REF` only in the build environment, so the SHA comes from the `WTP_BUILD_*` values
 * `next.config.ts`'s `env` inlines at build time. Absent is reported as `unknown`, never a plausible SHA.
 * `runtime` reports only presence and known-safe values; nothing enumerates `process.env`.
 */

/** An empty string is what the config writes for an absent variable, so it reads as absence. */
const present = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

const COMMIT_REF = present(process.env.WTP_BUILD_COMMIT);
const BRANCH = present(process.env.WTP_BUILD_BRANCH);
const CONTEXT = present(process.env.WTP_BUILD_CONTEXT);
const DEPLOY_ID = present(process.env.WTP_BUILD_DEPLOY_ID);
const NETLIFY = present(process.env.WTP_BUILD_ON_NETLIFY);

export function GET() {
  return Response.json(
    {
      commit: COMMIT_REF ?? "unknown",
      commitShort: COMMIT_REF ? COMMIT_REF.slice(0, 7) : "unknown",
      branch: BRANCH ?? "unknown",
      // Netlify's own deploy context: "production", "deploy-preview",
      // "branch-deploy", or unknown off-platform.
      context: CONTEXT ?? "unknown",
      deployId: DEPLOY_ID ?? "unknown",
      /**
       * Captured at BUILD time. Compare against `runtime` below: if a variable
       * is present here and absent there, it is a build-only variable and the
       * write guard must not depend on it.
       */
      buildEnv: {
        hasCommitRef: COMMIT_REF !== null,
        hasNetlify: NETLIFY !== null,
        hasContext: CONTEXT !== null,
      },
      /**
       * Read per-request, inside the handler, so it reflects the serving
       * process rather than the builder. This is the evidence the write
       * guard's second remainder needs.
       */
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        hasNetlify: process.env.NETLIFY !== undefined,
        hasContext: process.env.CONTEXT !== undefined,
        contextValue: process.env.CONTEXT ?? null,
        hasDeployId: process.env.DEPLOY_ID !== undefined,
        // What lib/db/write-guard.ts concludes from this environment, reported
        // rather than re-derived, so a deploy can be asked what it believes
        // about its own permission to write.
        dbRole: process.env.WTP_DB_ROLE === "local" ? "local" : "production",
      },
    },
    {
      // Never cached: a cached build stamp is precisely the lie this endpoint
      // exists to prevent — it would keep reporting the previous deploy's SHA
      // and a verification would pass against the build it was meant to catch.
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}
