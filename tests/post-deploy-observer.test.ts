import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  OBSERVER_OUTCOMES,
  POLL_BOUND,
  PRODUCTION_BASE_URL,
  fetchServedCommit,
  pollUntilServed,
  type ServedCommit,
} from "../scripts/post-deploy-observer.mts";

/**
 * Negative controls for the post-deploy observer: each test plants a condition it must not report as a healthy
 * deploy. `probe` and `sleep` are injected, so the timeout branch runs without the network or the real wait.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA_EXPECTED = "de61ff5dfd47ed56dea4c9bf6ae4c90c736bb74e";
const SHA_OLD = "713252470000000000000000000000000000abcd";

/** A probe that always answers with the same served commit. */
const always = (sha: string | null): ((n: number) => Promise<ServedCommit>) =>
  async () => ({
    sha,
    how: sha === null ? "stated failure" : "stated by the test",
    httpStatus: sha === null ? null : 200,
  });

/** Sleeps that never actually sleep — the clock is the thing being avoided. */
const noSleep = async (): Promise<void> => {};

/** ---------------------- 1. the happy path is actually reachable --------- */

test("OB1: the observer sees the expected commit and says which attempt saw it", async () => {
  let seen = 0;
  const r = await pollUntilServed({
    expectedSha: SHA_EXPECTED,
    // The deploy arrives on the third probe, which is the ordinary shape.
    probe: async () => {
      seen += 1;
      return {
        sha: seen < 3 ? SHA_OLD : SHA_EXPECTED,
        how: "stated by the test",
        httpStatus: 200,
      };
    },
    sleep: noSleep,
  });

  assert.equal(r.outcome, "SERVING_EXPECTED");
  assert.equal(r.servedSha, SHA_EXPECTED);
  assert.equal(r.attempts, 3);
  assert.match(r.detail, /attempt 3/);
});

test("OB1b: an abbreviated expectation still matches the full served commit", () => {
  // A short sha is what a person writes down; strict equality would poll to the bound against the watched commit.
  return pollUntilServed({
    expectedSha: SHA_EXPECTED.slice(0, 8),
    probe: always(SHA_EXPECTED),
    sleep: noSleep,
  }).then((r) => {
    assert.equal(r.outcome, "SERVING_EXPECTED");
  });
});

/** ---------------------- 2. the timeout is NOT a pass, and NOT DEGRADED -- */

test("OB2: the bound elapsing while production serves something else is PRODUCTION_BEHIND", async () => {
  const r = await pollUntilServed({
    expectedSha: SHA_EXPECTED,
    probe: always(SHA_OLD),
    sleep: noSleep,
    attempts: 4,
  });

  assert.equal(r.outcome, "PRODUCTION_BEHIND");
  assert.equal(r.servedSha, SHA_OLD);
  assert.equal(r.attempts, 4, "it used its whole allowance before concluding");

  // A deploy that never arrived is a fact about the build, not about production's schema; the outcome words must
  // not let one be read as the other.
  assert.ok(
    !(OBSERVER_OUTCOMES as readonly string[]).includes("DEGRADED"),
    "the observer may not have a DEGRADED outcome — that word belongs to the schema reading",
  );
  assert.doesNotMatch(r.detail, /DEGRADED/);
  assert.match(r.detail, /fact about the build pipeline/i);
  assert.match(r.detail, /no integrity reading is recorded/i);
});

test("OB2b: a production that never ANSWERS is COULD_NOT_TELL, not PRODUCTION_BEHIND", async () => {
  // An older served commit is a measurement; no answer is the absence of one. They are never printed alike.
  const r = await pollUntilServed({
    expectedSha: SHA_EXPECTED,
    probe: always(null),
    sleep: noSleep,
    attempts: 3,
  });

  assert.equal(r.outcome, "COULD_NOT_TELL");
  assert.equal(r.servedSha, null);
  assert.match(r.detail, /not a pass and not a failed deploy/);
});

/** ---------------------- 3. the bound is a ceiling, not a default -------- */

test("OB3: a caller cannot poll longer than the stated bound", async () => {
  const r = await pollUntilServed({
    expectedSha: SHA_EXPECTED,
    probe: always(SHA_OLD),
    sleep: noSleep,
    // Ten times the ceiling, asked for explicitly.
    attempts: POLL_BOUND.maxAttempts * 10,
    intervalSeconds: 9_999,
    maxTotalWaitSeconds: 9_999_999,
  });

  assert.equal(r.attempts, POLL_BOUND.maxAttempts, "the ceiling wins over the request");
  assert.ok(
    r.waitedSeconds <= POLL_BOUND.maxTotalWaitSeconds,
    `waited ${r.waitedSeconds}s, which is past the ${POLL_BOUND.maxTotalWaitSeconds}s bound`,
  );
});

test("OB3b: the total-wait ceiling stops the loop before the attempt ceiling does", async () => {
  const r = await pollUntilServed({
    expectedSha: SHA_EXPECTED,
    probe: always(SHA_OLD),
    sleep: noSleep,
    maxTotalWaitSeconds: 40,
  });
  assert.ok(r.attempts <= 3, `expected the 40s wait ceiling to stop it early, took ${r.attempts} probes`);
  assert.equal(r.outcome, "PRODUCTION_BEHIND");
});

/** ---------------------- 4. reading the endpoint honestly ---------------- */

test("OB4: an `unknown` commit is an ABSENCE, never a served sha", async () => {
  // The build endpoint returns "unknown" when the build carried no commit; that is not a sha to compare against.
  const served = await fetchServedCommit("https://example.invalid", {
    fetchImpl: (async () =>
      new Response(JSON.stringify({ commit: "unknown", commitShort: "unknown" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  });
  assert.equal(served.sha, null);
  assert.match(served.how, /named no commit/);
});

test("OB4b: a non-200 and a refused connection are both `null`, and each says which", async () => {
  const five = await fetchServedCommit("https://example.invalid", {
    fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
  });
  assert.equal(five.sha, null);
  assert.equal(five.httpStatus, 503);
  assert.match(five.how, /HTTP 503/);

  const refused = await fetchServedCommit("https://example.invalid", {
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
  });
  assert.equal(refused.sha, null);
  assert.equal(refused.httpStatus, null);
  assert.match(refused.how, /could not be reached/);
});

test("OB4c: every probe declares itself synthetic", async () => {
  // The build route writes nothing today, but an automated request to production still declares itself.
  let sent: Record<string, string> = {};
  await fetchServedCommit(PRODUCTION_BASE_URL, {
    runId: "a-test-run",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      sent = (init.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ commit: SHA_EXPECTED }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.equal(sent["x-wtp-synthetic-run"], "a-test-run");
});

/** ---------------------- 5. it cannot start a deploy loop ---------------- */

test("OB5: a deploy observation has no Git feedback hop", () => {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "post-deploy-integrity.yml"), "utf8")
    .replace(/^\s*#.*$/gm, "");
  const script = readFileSync(join(ROOT, "scripts", "production-integrity.mts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(workflow, /git\s+(?:add|commit|push)|push-main\.mjs|status:ledger/);
  assert.doesNotMatch(workflow, /^\s*contents:\s*write\s*$/m);
  assert.doesNotMatch(script, /git\s+(?:add|commit|push)|push-main\.mjs/);
  assert.match(script, /appendProductionIntegrity/);
  assert.match(script, /readLatestProductionIntegrity/);
});

/** ---------------------- 6. no rollback, still ---------------------------- */

test("OB6: the observer contains no rollback action of any kind", () => {
  const text = readFileSync(join(ROOT, "scripts", "post-deploy-observer.mts"), "utf8");
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "post-deploy-integrity.yml"), "utf8");
  const ROLLBACK =
    /\b(git\s+revert|git\s+reset\s+--hard|netlify\s+(api\s+)?rollback|restoreDeploy|rollbackDeploy|--rollback)\b/i;

  // Comments stripped: both files explain why nothing rolls back.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const yaml = workflow.replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(code, ROLLBACK, "NH273 forbids automatic rollback");
  assert.doesNotMatch(yaml, ROLLBACK, "and the workflow may not do it either");
  assert.match("await netlify.rollbackDeploy(id)", ROLLBACK, "the detector matches nothing at all");
});

/** ---------------------- 7. it runs the EXISTING gate -------------------- */

test("OB7: the observer spawns the existing reading rather than asking the database itself", () => {
  // The set of files permitted to query `drizzle.__drizzle_migrations` is closed; a second implementation of the
  // migration check would be a second verdict.
  const text = readFileSync(join(ROOT, "scripts", "post-deploy-observer.mts"), "utf8");
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The path is built with `join`, so the match is on the file name, not a separator-bearing string.
  assert.match(code, /"production-integrity\.mts"/, "it must spawn the existing reading");
  assert.doesNotMatch(code, /__drizzle_migrations/, "it may not query the migrations table itself");
  assert.doesNotMatch(code, /drizzle-orm|neon|postgres/i, "it opens no database handle at all");
});

/** ---------------------- 8. the workflow is wired as described ----------- */

test("OB8: the workflow is bounded, exact-head, read-only in Git, and appends canonical outcome", () => {
  const raw = readFileSync(join(ROOT, ".github", "workflows", "post-deploy-integrity.yml"), "utf8");
  // Comments stripped for the negative assertions: the workflow header explains what it does not listen for.
  const w = raw.replace(/^\s*#.*$/gm, "");

  assert.match(w, /\n\s*push:\s*\n\s*branches: \[main\]/, "it must fire on the push that causes the deploy");
  assert.match(w, /workflow_dispatch:/, "and be dispatchable against a named commit");
  assert.doesNotMatch(
    w,
    /deployment_status/,
    "gh api repos/:owner/:repo/deployments returns 0 here — a deployment_status trigger would never fire",
  );
  assert.match(w, /^\s*contents: read\s*$/m, "software-release integrity needs only Git read access");
  assert.doesNotMatch(w, /^\s*contents: write\s*$/m, "it may not mutate the repository");
  assert.match(w, /concurrency:/, "only one observation polls at a time");
  assert.match(w, /cancel-in-progress: true/, "a newer push to main replaces the older observation; Netlify serves the newest commit");
  assert.match(w, /^ {4}timeout-minutes:\s*\d+/m, "the job bounds itself well under the platform's six hours");
  assert.doesNotMatch(w, /push-main\.mjs|git\s+(?:add|commit|push)/, "the retired Git feedback hop cannot return");
  assert.match(w, /--expect=\$\{\{ inputs\.sha \|\| github\.sha \}\}/, "the observer remains exact-head bound");
  assert.match(
    w,
    /ref:\s*\$\{\{ inputs\.sha \|\| github\.sha \}\}/,
    "the observer must execute the exact requested release, not a later moving main checkout",
  );
  assert.doesNotMatch(
    w,
    /^\s*ref:\s*main\s*$/m,
    "a moving main checkout can mix a later release's code/schema with this release receipt",
  );
  assert.match(
    w,
    /WTP_PRODUCTION_DATABASE_URL_READONLY: \$\{\{ secrets\./,
    "the reading needs the read-only credential, which IS a repository secret",
  );
  assert.match(
    w,
    /WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL: \$\{\{ secrets\./,
    "the exact outcome is appended to the existing Admin-consumed control-plane log",
  );
  assert.doesNotMatch(
    w,
    /NETLIFY_AUTH_TOKEN/,
    "NETLIFY_AUTH_TOKEN is not a repository secret here — a workflow depending on it would be a gate that never runs",
  );
});
