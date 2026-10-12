import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = readFileSync(join(ROOT, "app", "api", "build", "route.ts"), "utf8");
const CONFIG = readFileSync(join(ROOT, "next.config.ts"), "utf8");

/** The build stamp: next.config.ts env inlines the build metadata, and the route must read only those names, so the agreement between the two files is asserted. */

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
  // A direct module-scope read of process.env.COMMIT_REF answers "unknown" on every request. Scoped to the module-scope constants: the runtime block reads the serving process's environment on purpose.
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
  // These runtime reads are load-bearing evidence of which signals a Netlify function gets.
  for (const name of ["NETLIFY", "CONTEXT", "DEPLOY_ID"]) {
    assert.match(
      ROUTE,
      new RegExp(`runtime[\\s\\S]*process\\.env\\.${name}`),
      `the runtime block no longer reports ${name} — that reading is the evidence, not noise`,
    );
  }
});

test("an absent variable renders as absence, never as a seven-character SHA", () => {
  // next.config.ts writes "" for an absent variable, so "" must read as null here.
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
