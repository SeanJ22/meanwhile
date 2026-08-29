/**
 * `pnpm release:freeze` — the gate a frozen release cannot get past. NH273.
 *
 * This is the enforcement half. `scripts/production-integrity.mts` records what
 * production said; this refuses the next production-changing release while that
 * record is DEGRADED.
 *
 * IT LIVES IN THE `gates` JOB, and that placement is the design.
 * `.github/workflows/build-check.yml`'s `gates` job is the required context
 * branch protection names, it already runs on every pull request and on every
 * push to `main`, and it is where `pnpm gates` and the schema shipping gate
 * already live. A tenth workflow would be a second shipping verdict — and a
 * `deployment_status` one would be worse than that, because
 * `gh api repos/:owner/:repo/deployments` returns 0 for this repository and
 * such a workflow would never fire at all.
 *
 * SCOPED, so paperwork is not punished for the database's condition. The freeze
 * reaches only changes that could alter what production serves, and
 * `classifyDeploy` — the same predicate `scripts/netlify-ignore.mjs` gives
 * Netlify — is the authority on that. A docs-only close-out follows ordinary
 * shipping law and is never treated as a production release.
 *
 * THERE IS NO SKIP FLAG. An escape hatch on a gate is how a gate stops meaning
 * anything, and this one exists because three green checks once said nothing
 * false while production served a schema the deployed code did not have.
 *
 * ## THIS IS THE HALF THAT READS THE CLOCK AND THE NETWORK (2026-08-29)
 *
 * `lib/ops/production-integrity.ts` is PURE and stays pure. Rule 4 there — a
 * healthy reading must still cover the production it is about — needs two
 * measurements that a pure module may not take: WHAT PRODUCTION SERVES RIGHT
 * NOW, and HOW OLD the reading is. Both are taken here and passed in.
 *
 * The served commit comes from `GET /api/build`, which needs NO CREDENTIAL:
 * `next.config.ts` inlines Netlify's build-time `COMMIT_REF` into
 * `WTP_BUILD_COMMIT` and `app/api/build/route.ts` returns it. That route writes
 * nothing — no database handle, no search-log row, no store of any kind; it is
 * a `Response.json` over five build-time constants — so this gate cannot
 * contaminate the sold store however often it runs. The synthetic-run header
 * goes with the request anyway, because every automated request to production
 * carries it and an exception is how the rule erodes.
 *
 * A REFUSED OR UNPARSEABLE OBSERVATION IS `null`, NEVER A GUESS. It reaches the
 * evaluator as PRODUCTION_UNOBSERVABLE and freezes a production-changing
 * release, which is the deliberate decision: "we could not ask production
 * anything" is the exact blindness of 2026-08-28.
 *
 *   --paths=a,b,c   state the changed-path list explicitly
 *   --sha=<commit>  the commit whose release is being considered
 *   --base-url=<u>  ask a different origin what it serves (a local production
 *                   build, a deploy preview). NOT an escape hatch: whatever it
 *                   points at must still answer with a real commit, and there
 *                   is no flag anywhere that STATES the served sha or skips the
 *                   age bound.
 *
 * Exit codes:
 *   0  permitted (with the integrity state always printed, green or not)
 *   1  FROZEN
 */

import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import {
  MAX_READING_AGE_HOURS,
  evaluateReleaseFreeze,
  explainFreeze,
  type ProductionObservation,
} from "../lib/ops/production-integrity.ts";
// `git` comes from the reader beside it rather than being written out again —
// RULING 103. The two copies were identical, and this mechanism turns on the
// difference between "the answer is no" and "there was no answer".
import { git, readRecord } from "./production-integrity.mts";
// ONE reader of `/api/build` (RULING 103). The observer's copy is the copy.
import { PRODUCTION_BASE_URL, fetchServedCommit } from "./post-deploy-observer.mts";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * Ask production what it serves, with a small bounded retry.
 *
 * THE RETRY IS NOT LENIENCY. A single dropped connection would otherwise read
 * as PRODUCTION_UNOBSERVABLE and freeze a release for a reason that was never
 * true — a false refusal, which is the failure direction that gets gates
 * switched off. Three attempts over roughly twenty seconds separates a hiccup
 * from a wall, and a wall still freezes. There is no attempt count at which a
 * refusal becomes a pass.
 */
async function observeProduction(baseUrl: string): Promise<{ sha: string | null; how: string }> {
  let last = { sha: null as string | null, how: "no probe was made" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const seen = await fetchServedCommit(baseUrl, {
      runId: process.env.WTP_RUN_ID ?? "release-freeze-gate",
      timeoutMs: 10_000,
    });
    last = { sha: seen.sha, how: `${seen.how} on attempt ${attempt}` };
    if (seen.sha !== null) return last;
    if (attempt < 3) await new Promise((r) => setTimeout(r, 10_000));
  }
  return last;
}

/**
 * How old the reading is, in hours, measured HERE.
 *
 * `null` is the absence of a measurement — a record with no `observedAt`, or one
 * whose stamp does not parse — and `evaluateReleaseFreeze` treats that as
 * expired rather than as young. A reading that cannot be aged is a reading that
 * cannot be trusted to be recent.
 */
function readingAgeHours(observedAt: string | null, now: number): number | null {
  if (!observedAt) return null;
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * The changed-path list, or `null`.
 *
 * `null` means the list could not be computed, and it is deliberately NOT an
 * empty list: an empty list is a real measurement and `null` is the absence of
 * one. Both `classifyDeploy` and `touchesSchemaContract` read `null` as the
 * cautious answer, so a gate that cannot see what changed refuses rather than
 * waves through.
 */
function changedPaths(): { paths: readonly string[] | null; how: string } {
  const stated = arg("paths");
  if (stated !== undefined) {
    return { paths: stated.split(",").map((p) => p.trim()).filter(Boolean), how: "stated on the command line" };
  }

  const event = process.env.GITHUB_EVENT_NAME;
  if (event === "pull_request" || event === "push") {
    const base = event === "pull_request" ? "origin/main" : "HEAD~1";
    const diff = git("diff", "--name-only", `${base}...HEAD`) ?? git("diff", "--name-only", base, "HEAD");
    if (diff !== null) {
      return { paths: diff.split("\n").filter(Boolean), how: `git diff against ${base}` };
    }
    return { paths: null, how: "the diff could not be read on this checkout" };
  }

  const diff = git("diff", "--name-only", "origin/main...HEAD");
  const status = git("status", "--porcelain");
  if (diff === null && status === null) {
    return { paths: null, how: "neither the branch diff nor the working tree could be read" };
  }
  const fromStatus = (status ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p));
  const all = new Set([...(diff ?? "").split("\n").filter(Boolean), ...fromStatus]);
  return { paths: [...all], how: "origin/main...HEAD plus the working tree" };
}

async function main(): Promise<void> {
  const record = readRecord();
  const { paths, how } = changedPaths();
  const candidateSha = arg("sha") ?? git("rev-parse", "HEAD");
  const baseUrl = arg("base-url") ?? PRODUCTION_BASE_URL;

  const served = await observeProduction(baseUrl);
  const production: ProductionObservation = {
    servedSha: served.sha,
    how: served.how,
    readingAgeHours: readingAgeHours(record.observedAt, Date.now()),
    // The bound is the exported constant, passed explicitly. There is no
    // environment variable and no flag that can move it (see the module header).
    maxAgeHours: MAX_READING_AGE_HOURS,
  };

  const verdict = evaluateReleaseFreeze({ record, candidateSha, changedPaths: paths, production });

  console.log("RELEASE FREEZE GATE (NH273)");
  console.log(`  candidate      ${candidateSha ?? "UNKNOWN"}`);
  console.log(
    `  production     ${served.sha ?? "COULD NOT BE OBSERVED"}  (${served.how})`,
  );

  // RULING 159: the changed-path count is FLOORED, and the floor reports the
  // split rather than a bare total — how many of the paths are production-
  // bearing is the number the freeze actually turns on. A commit that genuinely
  // touched nothing states that as its reason; a list that could not be READ is
  // a different answer entirely and is printed as one.
  if (paths === null) {
    console.log(`  changed paths  COULD NOT BE READ (${how})`);
  } else {
    const split = classifyDeploy(paths);
    const count = floored(
      "changed paths that are production-bearing",
      how,
      paths.length,
      split.shipping.length,
      paths.length === 0 ? "the commit changed no files at all" : undefined,
    );
    console.log(
      count.outcome === "MEASURED"
        ? `  changed paths  ${count.matched} of ${count.denominator} are production-bearing (${how})`
        : `  changed paths  COULD NOT ASSERT — ${count.reason}`,
    );
  }
  console.log(`  last reading   ${record.observed}${record.failureClass ? ` (${record.failureClass})` : ""}`);
  console.log(`                 taken ${record.observedAt ?? "never"} against ${record.deployedSha ?? "no commit"}`);
  console.log("");
  console.log(explainFreeze(verdict));

  if (verdict.frozen) {
    console.log("");
    console.log("There is no skip flag, no environment override and no way to state the served");
    console.log("commit by hand. Clear the freeze by re-reading production:");
    console.log(
      `  pnpm integrity:check --sha=${verdict.servedSha ?? "<the sha /api/build returns>"} --write`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

/*
 * `process.exitCode` AND A NATURAL EXIT, NEVER `process.exit()` — MEASURED.
 *
 * This gate makes an HTTP request now, and calling `process.exit()` while
 * undici's socket is still open aborts the process on Windows:
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94
 *
 * The abort DESTROYS THE EXIT CODE. Measured on 2026-08-29: the frozen run and
 * the permitted run both exited **127**, so the gate would have reported FAIL
 * identically whether it refused a release or waved it through — an instrument
 * whose two verdicts are indistinguishable, which is worse than no gate. Setting
 * the code and letting the loop drain keeps the verdict readable.
 */
await main();
