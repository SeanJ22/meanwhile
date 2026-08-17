/**
 * GET /api/build — which commit is actually serving this response.
 *
 * ## Why this exists
 *
 * A deploy that does not land is invisible. The g6 session verified a fix by
 * polling an API route until its behaviour changed, which works only when the
 * change alters observable behaviour — for a doc-only or internal change there
 * is nothing to poll, and "the deploy went green" is not the same claim as
 * "the deploy is serving my commit". The author ruled: an endpoint returning
 * the commit SHA the deploy was built from, so a deploy is verifiable even
 * when it has no visible output.
 *
 * ## Where the SHA comes from, and why it is read at module scope
 *
 * Netlify sets `COMMIT_REF` in the BUILD environment. Next inlines a
 * `process.env.X` reference it can see at build time into the server bundle,
 * so reading it here — at module scope, with the full property access written
 * out literally rather than destructured or looked up dynamically — captures
 * the value of the build rather than of the request. A dynamic read
 * (`process.env[name]`) would defeat that inlining and return undefined at
 * runtime, which is the quiet way this endpoint would end up reporting nothing
 * forever.
 *
 * `unknown` is returned honestly when the variable is absent — a local `next
 * build` has no COMMIT_REF, and inventing a plausible SHA would make this
 * endpoint worse than not having it. Absence is never dressed as a value.
 *
 * ## The runtime-environment block
 *
 * `runtime` reports what the SERVER process can see about itself when the
 * request arrives, which is a different question from what the build saw.
 * It exists because `lib/db/write-guard.ts` has a named remainder: `NODE_ENV`
 * cannot tell the production deployment apart from a local production build,
 * and closing that needs a signal only the real deployment has. Which
 * variables Netlify actually exposes at function runtime is a fact nobody here
 * could check without deploying and looking — so this reports presence, and a
 * later session tightens the guard on evidence instead of assumption.
 *
 * Only PRESENCE and known-safe values are reported. Nothing enumerates
 * `process.env`, because that is how a token ends up in a public JSON body.
 */

// Read at module scope so the build-time value is what gets inlined.
const COMMIT_REF = process.env.COMMIT_REF ?? null;
const BRANCH = process.env.BRANCH ?? null;
const CONTEXT = process.env.CONTEXT ?? null;
const DEPLOY_ID = process.env.DEPLOY_ID ?? null;
const NETLIFY = process.env.NETLIFY ?? null;

export function GET() {
  return Response.json(
    {
      // The whole point of the endpoint.
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
