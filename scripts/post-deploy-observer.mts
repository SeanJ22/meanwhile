/**
 * `pnpm integrity:observe` — the automatic post-deploy reading. NH273, part 2.
 *
 * ## What was missing, in one sentence
 *
 * `scripts/production-integrity.mts` takes a reading and `scripts/release-freeze-gate.mts`
 * enforces it, and NOTHING RAN THE FIRST ONE. The header of the gate says so in
 * as many words: "It is dispatched by hand against the commit that actually
 * shipped. Nothing runs it automatically yet." A mechanism whose trigger is a
 * person remembering is a mechanism that reports on the days somebody
 * remembered, and the 2026-08-28 drift is what the other days look like.
 *
 * ## Why this is not a `deployment_status` workflow, measured rather than assumed
 *
 * `gh api repos/:owner/:repo/deployments` returns **0**. Netlify creates no
 * GitHub Deployment object for this repository, so no `deployment_status` event
 * has ever fired here and a workflow listening for one would never run — a gate
 * that never executes reports nothing and reads as covered, which is worse than
 * no gate at all. The trigger is therefore the push to `main` that CAUSES the
 * deploy, and the deploy's arrival is OBSERVED rather than subscribed to.
 *
 * ## How the deployed commit is established, with no credential
 *
 * `GET /api/build` returns the commit the running deploy was built from:
 * `next.config.ts` inlines Netlify's build-time `COMMIT_REF` into
 * `WTP_BUILD_COMMIT` and `app/api/build/route.ts` hands it back. **That route
 * writes nothing.** It is a `Response.json` over five build-time constants —
 * no database handle, no `search_log` row, no store of any kind — so polling it
 * cannot put a probe row into the store this product sells. The synthetic-run
 * header travels with every request regardless, because every automated request
 * to production carries it and an exception is how the rule erodes.
 *
 * `NETLIFY_AUTH_TOKEN` is NOT a repository secret here (it lives only in the
 * author's `.env.local`), so the Netlify deploys API is unavailable to CI. This
 * route is the whole reason the observer can exist without one.
 *
 * ## THE BOUND, STATED, AND WHAT A TIMEOUT MEANS
 *
 * At most `POLL_BOUND.maxAttempts` (30) probes, `POLL_BOUND.intervalSeconds`
 * (20) apart, and never longer than `POLL_BOUND.maxTotalWaitSeconds` (600 — ten
 * minutes) in total, whichever comes first. A Netlify build of this repository
 * takes three to five minutes; ten is roughly double the observed worst case and
 * a twentieth of the platform's job ceiling.
 *
 * **A TIMEOUT IS NEVER A PASS AND NEVER A FAILED DEPLOY VERDICT.** If the bound
 * elapses while production still serves some other commit, the outcome is
 * `PRODUCTION_BEHIND` — a statement about our deploy pipeline — and it is
 * deliberately NOT `DEGRADED`, which is a statement about production's schema.
 * Collapsing the two would write a false failure class into a durable record
 * that then freezes releases for a reason that never happened. This matters
 * today rather than hypothetically: NH281 is open, production has failed to
 * deploy application-bearing commits with `exit code: 2`, and the build log is
 * behind the author's Netlify login. The observer must survive that condition
 * telling the truth about it.
 *
 * If production cannot be ASKED at all — a refusal, a non-200, an unparseable
 * body, an `unknown` commit — the outcome is `COULD_NOT_TELL` (RULING 24).
 *
 * ## It runs the EXISTING gate. There is no second implementation.
 *
 * Once the served commit is confirmed, this spawns
 * `scripts/production-integrity.mts --sha=<served> --write`, which itself spawns
 * `scripts/db-shipping-gate.mts`. It contacts no database of its own.
 * `tests/migration-shipping-invariant.test.ts` holds the set of files permitted
 * to query `drizzle.__drizzle_migrations` closed to FOUR, and a fifth would
 * break it — correctly, because two implementations of "does production hold
 * the migrations this commit ships" are two verdicts free to disagree.
 *
 * ## IT NEVER ROLLS ANYTHING BACK, and will not be extended to.
 *
 * The owner's decision of 2026-08-28: a red reading marks integrity DEGRADED,
 * alerts, and blocks the next production-changing release. Production's database
 * may already have advanced, and rolling code back underneath an advanced schema
 * manufactures a second incompatibility on top of the first. There is no rollback
 * call anywhere in this file and `tests/production-integrity.test.ts` sweeps for
 * one.
 *
 * ## It cannot start a deploy loop
 *
 * The record it writes lives at `data/ops/production-integrity.json`, and
 * `data/ops/` is in `NON_SHIPPING_PREFIXES` (`lib/ops/deploy-paths.ts`, commit
 * `6e591077`, "an ops record must not cost a build"). `classifyDeploy` therefore
 * returns `cancel` for a commit carrying only that file: the observer's own
 * output can never trigger the deploy the observer exists to observe.
 * `tests/post-deploy-observer.test.ts` asserts it through `classifyDeploy`.
 *
 *   --expect=<sha>       the commit that should become the served one.
 *                        Defaults to HEAD.
 *   --base-url=<url>     which origin to ask. Defaults to production.
 *   --write              persist the reading. Without it nothing is recorded,
 *                        so the observer is safe to explore.
 *   --attempts=<n>       tighten the poll below the bound. It may never loosen
 *                        it — POLL_BOUND is the ceiling, checked, not a default.
 *
 * Exit codes — distinct, because the four outcomes are four different facts:
 *   0  the served commit is the expected one and integrity HELD (or the commit
 *      is not production-changing, so no reading is owed)
 *   1  integrity REFUSED — production and the committed migrations disagree
 *   2  COULD NOT TELL — production could not be asked, or the gate could not
 *   3  PRODUCTION_BEHIND — the bound elapsed and production serves something
 *      else. A fact about the deploy, never about the schema.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
// RULING 103 — ONE implementation of "do these two strings name the same
// commit?". This file briefly carried a byte-identical private copy called
// `same`, and `pnpm dupes` caught it. The duplicate was not harmless: the freeze
// gate and the observer must agree about what "production serves the expected
// commit" MEANS, and two copies are two things that can drift into disagreeing
// about a seven-character prefix — which is precisely the comparison the whole
// freshness rule turns on.
import { sameCommit } from "../lib/ops/production-integrity.ts";
import { git } from "./production-integrity.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The origin this repository deploys to. `scripts/deploy-live.mjs` names the same host. */
export const PRODUCTION_BASE_URL = PUBLIC_SITE_ORIGIN;

/**
 * The hard bound. A CEILING, not a default: `--attempts` may tighten it and
 * nothing may loosen it, because a bound that the caller can raise is not a
 * bound. Ten minutes is roughly double this repository's observed worst-case
 * Netlify build and a twentieth of the platform's job ceiling.
 */
export const POLL_BOUND = {
  maxAttempts: 30,
  intervalSeconds: 20,
  maxTotalWaitSeconds: 600,
} as const;

/** What production answered when asked which commit it serves. */
export interface ServedCommit {
  /** The served commit, or `null` when production could not be ASKED. Never a guess. */
  readonly sha: string | null;
  /** How it was established, or why it could not be. Printed either way. */
  readonly how: string;
  readonly httpStatus: number | null;
}

/**
 * The four things the observation can find. Each is a different fact and none
 * of them is "the deploy failed" — that verdict needs the build log, which is
 * behind a login this process does not have, and asserting it from a timeout
 * would be inventing a cause.
 */
export const OBSERVER_OUTCOMES = [
  "SERVING_EXPECTED",
  "PRODUCTION_BEHIND",
  "COULD_NOT_TELL",
  "NOT_A_RELEASE",
] as const;
export type ObserverOutcome = (typeof OBSERVER_OUTCOMES)[number];

export interface PollResult {
  readonly outcome: ObserverOutcome;
  readonly servedSha: string | null;
  readonly attempts: number;
  readonly waitedSeconds: number;
  readonly detail: string;
}

/**
 * Ask one origin which commit it serves.
 *
 * ONE IMPLEMENTATION, EXPORTED, because `scripts/release-freeze-gate.mts` asks
 * exactly the same question for rule 4's freshness clause and RULING 103
 * refuses the second copy. Two readers of `/api/build` would be two places for
 * the `"unknown"` handling to drift, and the whole mechanism turns on the
 * difference between "production serves another commit" and "production did not
 * answer".
 */
export async function fetchServedCommit(
  baseUrl: string,
  options: {
    runId?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ServedCommit> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/build`;
  const doFetch = options.fetchImpl ?? fetch;
  const runId = options.runId ?? process.env.WTP_RUN_ID ?? "post-deploy-observer";
  const timeoutMs = options.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      headers: {
        [SYNTHETIC_RUN_HEADER]: runId,
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { sha: null, how: `${url} answered HTTP ${res.status}`, httpStatus: res.status };
    }
    const body = (await res.json()) as { commit?: unknown };
    const commit = typeof body.commit === "string" ? body.commit : null;
    /*
     * `"unknown"` is what the route returns HONESTLY when the build carried no
     * COMMIT_REF. It is an absence, and reading it as a sha would make every
     * comparison below compare against a word.
     */
    /*
     * SHAPE-CHECKED, and that is a security property rather than tidiness.
     * This value arrives over the network and is later passed as a command
     * argument to the reading. Anything that is not a git object id is refused
     * as "no commit" rather than forwarded — the same failure the honest
     * `"unknown"` produces, so there is one path for "production named no
     * commit" and no path at all for "production named something else".
     */
    if (commit === null || !/^[0-9a-f]{7,40}$/.test(commit)) {
      return {
        sha: null,
        how: `${url} answered 200 but named no commit (commit=${String(body.commit)})`,
        httpStatus: res.status,
      };
    }
    return { sha: commit, how: `GET ${url}`, httpStatus: res.status };
  } catch (err) {
    return { sha: null, how: `${url} could not be reached: ${(err as Error).message}`, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Poll until production serves the expected commit, or until the bound.
 *
 * `probe` and `sleep` are handed in, which is what makes every branch here
 * testable without a network or a wall clock — including the timeout, which is
 * the branch that will actually fire on this repository today.
 */
export async function pollUntilServed(input: {
  expectedSha: string;
  probe: (attempt: number) => Promise<ServedCommit>;
  sleep: (ms: number) => Promise<void>;
  attempts?: number;
  intervalSeconds?: number;
  maxTotalWaitSeconds?: number;
}): Promise<PollResult> {
  /* The bound is a CEILING. A caller asking for more gets the ceiling. */
  const maxAttempts = Math.max(1, Math.min(input.attempts ?? POLL_BOUND.maxAttempts, POLL_BOUND.maxAttempts));
  const interval = Math.min(input.intervalSeconds ?? POLL_BOUND.intervalSeconds, POLL_BOUND.intervalSeconds);
  const maxWait = Math.min(
    input.maxTotalWaitSeconds ?? POLL_BOUND.maxTotalWaitSeconds,
    POLL_BOUND.maxTotalWaitSeconds,
  );

  let waited = 0;
  let attempts = 0;
  let last: ServedCommit = { sha: null, how: "no probe was made", httpStatus: null };

  for (let i = 0; i < maxAttempts; i += 1) {
    attempts += 1;
    last = await input.probe(attempts);
    if (sameCommit(last.sha, input.expectedSha)) {
      return {
        outcome: "SERVING_EXPECTED",
        servedSha: last.sha,
        attempts,
        waitedSeconds: waited,
        detail: `production serves ${last.sha} on attempt ${attempts} (${last.how})`,
      };
    }
    if (i === maxAttempts - 1 || waited + interval > maxWait) break;
    await input.sleep(interval * 1000);
    waited += interval;
  }

  /*
   * TWO DIFFERENT ENDINGS, AND THEY MAY NEVER BE PRINTED ALIKE.
   *
   * Production ANSWERED, with another commit  -> PRODUCTION_BEHIND. A fact
   * about our deploy pipeline, already tracked as NH281, and never a claim
   * about production's schema.
   *
   * Production DID NOT ANSWER                 -> COULD_NOT_TELL. RULING 24.
   */
  if (last.sha === null) {
    return {
      outcome: "COULD_NOT_TELL",
      servedSha: null,
      attempts,
      waitedSeconds: waited,
      detail:
        `production could not be asked which commit it serves after ${attempts} attempt(s) over ` +
        `${waited}s: ${last.how}. This is COULD NOT TELL, not a pass and not a failed deploy.`,
    };
  }
  return {
    outcome: "PRODUCTION_BEHIND",
    servedSha: last.sha,
    attempts,
    waitedSeconds: waited,
    detail:
      `after ${attempts} attempt(s) over ${waited}s production still serves ${last.sha}, not ` +
      `${input.expectedSha}. THE DEPLOY HAS NOT ARRIVED. That is a fact about the build pipeline ` +
      "(NH281 is open on exactly this), never a fact about production's schema, and no integrity " +
      "reading is recorded for a commit production does not serve.",
  };
}

/**
 * Is this commit one that could change what production serves?
 *
 * `classifyDeploy` is the authority — the same predicate `scripts/netlify-ignore.mjs`
 * gives Netlify — so the observer and the deploy filter cannot disagree about
 * what a release is. A docs-only close-out is not a release and is owed no
 * post-deploy reading; waiting ten minutes for a deploy Netlify was correctly
 * told to cancel would time out on every quiet day, and an alarm that is wrong
 * on every quiet day is an alarm nobody reads (RULING 115).
 */
export function isRelease(sha: string): { release: boolean; reason: string } {
  const files = git("show", "--name-only", "--format=", sha);
  if (files === null) {
    /*
     * The changed-path list could not be read — a shallow clone with no parent,
     * or an unknown object. `classifyDeploy(null)` answers `cannot-tell`, which
     * BUILDS, so the cautious answer is to observe rather than to skip. A skip
     * we could not justify would be an unobserved deploy.
     */
    const d = classifyDeploy(null);
    return { release: d.verdict !== "cancel", reason: `${d.reason} (the changed-path list could not be read)` };
  }
  const d = classifyDeploy(files.split("\n").filter(Boolean));
  return { release: d.verdict !== "cancel", reason: d.reason };
}

/** ------------------------------------------------------------------ main */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const expected = arg("expect") ?? git("rev-parse", "HEAD");
  const baseUrl = arg("base-url") ?? PRODUCTION_BASE_URL;
  const write = process.argv.includes("--write");
  const attempts = arg("attempts") ? Number(arg("attempts")) : undefined;

  console.log("POST-DEPLOY OBSERVER (NH273)");
  console.log(`  expecting      ${expected ?? "UNKNOWN"}`);
  console.log(`  asking         ${baseUrl}/api/build`);
  console.log(
    `  bound          at most ${POLL_BOUND.maxAttempts} probes, ${POLL_BOUND.intervalSeconds}s apart, ` +
      `${POLL_BOUND.maxTotalWaitSeconds}s total`,
  );
  console.log("  rollback       NONE. This never rolls production back, by the owner's decision.");
  console.log("");

  if (expected === null) {
    console.error("COULD NOT TELL — this checkout could not name HEAD, so there is nothing to expect.");
    process.exitCode = 2;
    return;
  }

  const scope = isRelease(expected);
  if (!scope.release) {
    console.log(`NOT_A_RELEASE — ${scope.reason}`);
    console.log("No deploy is owed for this commit, so no post-deploy reading is owed either.");
    console.log("Nothing was recorded, and the previous reading stands unchanged.");
    process.exitCode = 0;
    return;
  }

  const result = await pollUntilServed({
    expectedSha: expected,
    attempts,
    probe: async (attempt) => {
      const seen = await fetchServedCommit(baseUrl, { runId: process.env.WTP_RUN_ID ?? "post-deploy-observer" });
      console.log(`  probe ${String(attempt).padStart(2)}  ${seen.sha ?? "NO ANSWER"}  ${seen.how}`);
      return seen;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  console.log("");
  console.log(`OUTCOME: ${result.outcome}`);
  console.log(`  ${result.detail}`);

  if (result.outcome === "COULD_NOT_TELL") {
    console.log("");
    console.log("Nothing was recorded. An unreachable production is not a reading, and writing one");
    console.log("would put a fact we do not have into the record the release gate trusts.");
    process.exitCode = 2;
    return;
  }

  if (result.outcome === "PRODUCTION_BEHIND") {
    console.log("");
    console.log("Nothing was recorded, and NOTHING IS DEGRADED. The last reading stands, and the");
    console.log("release-freeze gate will refuse the next production-changing release on its own");
    console.log("terms (PRODUCTION_MOVED or READING_EXPIRED) if it no longer covers what is served.");
    console.log("The deploy itself is the thing to chase: the Netlify build log is behind the");
    console.log("author's login, which is why NH281 is a Needs Sean row rather than a session task.");
    process.exitCode = 3;
    return;
  }

  /*
   * The reading is taken against the SERVED sha rather than against `--expect`.
   * They match here by construction, and taking it against the observed value
   * keeps the record a statement about what was measured rather than about what
   * was asked for.
   */
  const sha = result.servedSha as string;
  console.log("");
  console.log(`Taking the post-deploy reading against ${sha} through the EXISTING gate.`);
  /*
   * SPAWNED THROUGH `node` AND tsx's CLI, WITH NO SHELL.
   *
   * `shell: true` would concatenate rather than escape its arguments, and one
   * of those arguments is a value that arrived over the network. It is
   * shape-checked to a git object id above, so both halves of the defence are
   * present rather than one — and neither is load-bearing alone.
   * `scripts/governance-check.mts` resolves tsx the same way.
   */
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "scripts", "production-integrity.mts"),
      `--sha=${sha}`,
      ...(write ? ["--write"] : []),
    ],
    { cwd: ROOT, encoding: "utf8", stdio: "inherit" },
  );
  const exit = run.status ?? 2;
  if (!write) {
    console.log("\n(--write not given; the reading above was taken and nothing was recorded)");
  }
  process.exitCode = exit === 0 || exit === 1 || exit === 2 ? exit : 2;
}

/*
 * `process.exitCode`, NEVER `process.exit()` — MEASURED, not stylistic.
 *
 * This script makes HTTP requests, and calling `process.exit()` while undici's
 * socket is still open aborts the process on Windows with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94`.
 * The abort DESTROYS THE EXIT CODE: measured on 2026-08-29 against the sibling
 * freeze gate, a frozen run and a permitted run both exited 127. Four distinct
 * outcomes that all report 127 are one outcome, and the whole point of the
 * codes here is that a timeout and a refusal are different facts.
 *
 * NOTHING ABOVE RUNS ON IMPORT. `tests/post-deploy-observer.test.ts` imports
 * the exported halves to drive the timeout branch with no network and no clock;
 * an import that started a ten-minute poll would hang the suite, and a suite
 * that hangs is discovered as a platform timeout with no step named.
 */
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/post-deploy-observer.mts")) {
  await main();
}
