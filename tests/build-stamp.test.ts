import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = readFileSync(join(ROOT, "app", "api", "build", "route.ts"), "utf8");
const CONFIG = readFileSync(join(ROOT, "next.config.ts"), "utf8");

/**
 * The build stamp (R22), guarded — 2026-08-17.
 *
 * WHAT WENT WRONG, because the guard only makes sense against it. The route
 * read `process.env.COMMIT_REF` at module scope, documented as being inlined
 * by Next at build time. It is not: server code keeps the reference as a
 * RUNTIME read, and Netlify sets COMMIT_REF in the build environment only. So
 * the endpoint answered `"commit":"unknown"` on every request of every deploy,
 * and it did so with a 200 — a deploy-verification instrument that could never
 * verify a deploy, reporting healthily.
 *
 * The mechanism that actually inlines is `env` in `next.config.ts`. What can
 * silently rot is the AGREEMENT between the two files: a name added to one and
 * not the other reads as an absent variable, which the route honestly renders
 * as "unknown" — the same wrong answer as before, wearing the correct
 * behaviour's clothes. So the agreement is what is asserted.
 *
 * This is a source scan on purpose. Proving the inlining EMPIRICALLY needs a
 * production build with COMMIT_REF set and a request against the built server,
 * which is a two-minute operation, not a unit test. That proof was run once by
 * hand — `COMMIT_REF=deadbeefcafe1234 pnpm build`, then the built chunk
 * checked for the literal (present) and for `process.env.WTP_BUILD_COMMIT`
 * (absent, so it was substituted), then `next start` answered
 * `{"commit":"deadbeefcafe1234","commitShort":"deadbee",...}`. What this file
 * keeps is the wiring that proof depended on.
 */

/** The build-metadata names, and the Netlify variable each one carries. */
const INLINED = [
  ["WTP_BUILD_COMMIT", "COMMIT_REF"],
  ["WTP_BUILD_BRANCH", "BRANCH"],
  ["WTP_BUILD_CONTEXT", "CONTEXT"],
  ["WTP_BUILD_DEPLOY_ID", "DEPLOY_ID"],
  ["WTP_BUILD_ON_NETLIFY", "NETLIFY"],
] as const;

test("next.config.ts inlines every build-metadata name the route reads", () => {
  for (const [inlined, source] of INLINED) {
    assert.match(
      CONFIG,
      new RegExp(`${inlined}:\\s*process\\.env\\.${source}`),
      `next.config.ts no longer inlines ${inlined} from ${source} — the route would read undefined ` +
        `and report "unknown" forever, which is the defect this file exists for`,
    );
    assert.match(
      ROUTE,
      new RegExp(`process\\.env\\.${inlined}`),
      `the build route no longer reads ${inlined}`,
    );
  }
});

test("no BUILD constant is assigned from a Netlify variable directly", () => {
  // The original defect, by shape: `const COMMIT_REF = process.env.COMMIT_REF`.
  // A direct read compiles, type-checks, ships, and answers "unknown" on every
  // request — there is no louder symptom.
  //
  // Scoped to the module-scope constants, NOT to the file. The `runtime` block
  // reads process.env.NETLIFY, CONTEXT and DEPLOY_ID on purpose: reporting what
  // the SERVING process can see is that block's entire job, and it is the
  // evidence the write guard's second remainder needs. Banning those reads
  // outright would delete the finding to satisfy the guard.
  for (const [, source] of INLINED) {
    assert.ok(
      !new RegExp(`^const\\s+\\w+\\s*=\\s*process\\.env\\.${source}\\b`, "m").test(ROUTE),
      `app/api/build/route.ts assigns a module-scope constant from process.env.${source}. ` +
        `Netlify sets it at BUILD time only, and server code keeps the reference as a runtime ` +
        `read, so this returns undefined on every deploy. Route it through next.config.ts's env.`,
    );
  }
});

test("the runtime block still reports what the serving process sees", () => {
  // The other half of the scoping above: these reads are load-bearing evidence
  // (R34's second remainder — which signals a Netlify function actually gets),
  // and the live answer as of 2026-08-17 is that it gets none of them. Losing
  // them would erase the measurement rather than the assumption.
  for (const name of ["NETLIFY", "CONTEXT", "DEPLOY_ID"]) {
    assert.match(
      ROUTE,
      new RegExp(`runtime[\\s\\S]*process\\.env\\.${name}`),
      `the runtime block no longer reports ${name} — that reading is the evidence, not noise`,
    );
  }
});

test("an absent variable renders as absence, never as a seven-character SHA", () => {
  // next.config.ts writes "" for an absent variable, so `""` must read as null
  // here. Without that, commitShort would slice "" to "" and the endpoint would
  // report a blank SHA as though it were one — a render default manufacturing
  // a claim, in the one place whose whole job is to be trustworthy about which
  // commit is serving.
  assert.match(
    ROUTE,
    /value === undefined \|\| value === ""/,
    "the empty-string guard is gone — an unset build variable would render as a value",
  );
  assert.match(ROUTE, /\?\? "unknown"/, "absence no longer renders as an honest unknown");
});

test("the stamp is never cached", () => {
  assert.match(
    ROUTE,
    /cache-control["']?\s*:\s*["']no-store/,
    "a cached build stamp reports the previous deploy's SHA — the lie this endpoint prevents",
  );
});
