/**
 * `pnpm release:freeze` — the gate a frozen release cannot get past. NH273.
 *
 * This is the enforcement half. `scripts/production-integrity.mts` durably records what
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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import {
  MAX_READING_AGE_HOURS,
  NEVER_CHECKED,
  classifyEquivalenceRange,
  evaluateReleaseFreeze,
  explainFreeze,
  sameCommit,
  type ApplicationEquivalence,
  type ProductionObservation,
} from "../lib/ops/production-integrity.ts";
import { PRODUCTION_INTEGRITY_LOG_KEY } from "../lib/control-plane/software-release-review.ts";
import {
  CONTROL_PLANE_INTEGRITY_READ_URL_VAR,
  readLatestProductionIntegrity,
  type ProductionIntegrityRead,
} from "../lib/ops/production-integrity-data-plane.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
// `git` comes from the reader beside it rather than being written out again —
// RULING 103. The two copies were identical, and this mechanism turns on the
// difference between "the answer is no" and "there was no answer".
import { git } from "./production-integrity.mts";
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
 * Read the one canonical post-deploy history through a read-only control-plane
 * role. Missing configuration and connection failure remain distinct details,
 * but both produce NEVER_CHECKED for the pure evaluator and therefore freeze a
 * software-bearing release. There is no tracked-file fallback.
 */
async function readIntegrityAuthority(): Promise<ProductionIntegrityRead> {
  const connection = process.env[CONTROL_PLANE_INTEGRITY_READ_URL_VAR]?.trim() ?? "";
  if (connection === "") {
    const detail = `${CONTROL_PLANE_INTEGRITY_READ_URL_VAR} is not set, so the canonical post-deploy outcome log was not read.`;
    return { kind: "STORE_UNREACHABLE", record: { ...NEVER_CHECKED, detail }, detail };
  }
  try {
    const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
    assertDurableRepositories(repos, "release-freeze post-deploy readback");
    return await readLatestProductionIntegrity(repos.softwareReleaseReviews);
  } catch (error) {
    const detail =
      `The canonical post-deploy outcome log could not be opened ` +
      `(${error instanceof Error ? error.name : "error"}).`;
    return { kind: "STORE_UNREACHABLE", record: { ...NEVER_CHECKED, detail }, detail };
  }
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
/**
 * Make a commit reachable in this checkout, deepening rather than
 * unshallowing — the same move `scripts/db-shipping-gate.mts` makes, for the
 * same reason: this repository's pack is 311 MiB, and `actions/checkout`
 * clones at depth 1, so the base of a pull request is simply not here until
 * it is fetched BY SHA.
 */
function ensureCommit(sha: string): boolean {
  if (git("cat-file", "-e", `${sha}^{commit}`) !== null) return true;
  for (const depth of [100, 1000]) {
    spawnSync("git", ["fetch", `--depth=${depth}`, "origin", sha], {
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (git("cat-file", "-e", `${sha}^{commit}`) !== null) return true;
  }
  return false;
}

function changedPaths(): { paths: readonly string[] | null; how: string } {
  const stated = arg("paths");
  if (stated !== undefined) {
    return { paths: stated.split(",").map((p) => p.trim()).filter(Boolean), how: "stated on the command line" };
  }

  /*
   * ON CI THE BASE IS TAKEN FROM THE PLATFORM, NEVER FROM A LOCAL REF.
   * (2026-08-30, measured on Build Check run #463: PR #227 changed four
   * `docs/` files and this gate printed COULD NOT BE READ, because the old
   * code diffed against `origin/main` — a ref a depth-1 `actions/checkout`
   * does not have — so a docs-only pull request classified `cannot-tell`,
   * which is production-changing, and the freeze reached paperwork it is
   * scoped never to reach. `HEAD~1` on a push failed the same way.)
   *
   * `scripts/db-shipping-gate.mts` worked this out first, and this is the
   * same shape: a pull request diffs against `pull_request.base.sha` from the
   * event payload — fetched by sha when absent — and the checkout's
   * `refs/pull/N/merge` HEAD already merges the base, so `diff base HEAD` is
   * exactly the pull request's own changes. A push takes the event's own
   * added/modified/removed lists, which need no history at all. A payload
   * that cannot be read stays `null` — COULD NOT BE READ is still the honest
   * answer when it is true; it just may never be the answer for a readable
   * pull request.
   */
  const event = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (event === "pull_request" || event === "push") {
    if (!eventPath) return { paths: null, how: `a ${event} event named no payload file` };
    try {
      const payload = JSON.parse(readFileSync(eventPath, "utf8")) as {
        commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
        pull_request?: { base?: { sha?: string } };
      };

      if (event === "push" && Array.isArray(payload.commits)) {
        const paths = new Set<string>();
        for (const c of payload.commits) {
          for (const p of [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]) paths.add(p);
        }
        return { paths: [...paths], how: "the push event's own commit list" };
      }

      const base = payload.pull_request?.base?.sha;
      if (event === "pull_request" && base) {
        if (!ensureCommit(base)) {
          return { paths: null, how: `the base ${base.slice(0, 7)} could not be fetched into this checkout` };
        }
        const diff = git("diff", "--name-only", base, "HEAD");
        if (diff !== null) {
          return {
            paths: diff.split("\n").filter(Boolean),
            how: `git diff ${base.slice(0, 7)}..HEAD (the pull request's base, from the event payload)`,
          };
        }
        return { paths: null, how: `the base ${base.slice(0, 7)} could not be diffed against HEAD` };
      }
      return { paths: null, how: `the ${event} payload carried no usable base or commit list` };
    } catch (error) {
      return { paths: null, how: `the event payload could not be read — ${(error as Error).message}` };
    }
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

/**
 * PROVE, OR FAIL TO PROVE, THAT TWO COMMITS CARRY THE SAME APPLICATION — NH289.
 *
 * A later non-shipping commit can sit above the application commit the durable
 * post-deploy reading names. Historically the observer itself created those
 * commits; that Git writer is retired. The proof remains necessary for any
 * human-authored non-shipping descendant. Measured 2026-08-30:
 * `9fb33469` merged at 07:37:09Z, the observer's `5169fa32` landed 62 seconds
 * later, production served `5169fa32`, and the next pull request froze on
 * PRODUCTION_MOVED over a range containing exactly one `data/ops/` file.
 *
 * The proof is git evidence, recomputed every run, and both halves must hold:
 *
 *   1. DESCENT — the recorded release is an ancestor of the served commit.
 *      A served commit that does not descend from the measured release is a
 *      different history, whatever its tree looks like.
 *   2. NON-SHIPPING RANGE — every path changed across recorded..served is
 *      non-shipping under `classifyDeploy`, the exact predicate the deploy
 *      filter runs. One app file, one migration, one anything-shipping in the
 *      range destroys equivalence.
 *
 * There is no input that states the answer. An unreachable commit, a history
 * too shallow to prove descent even after deepening, or an unreadable diff is
 * CANNOT_TELL — and CANNOT_TELL freezes, exactly as an unproven range should.
 */
function proveApplicationEquivalence(recordedSha: string, servedSha: string): ApplicationEquivalence {
  for (const [label, sha] of [["recorded release", recordedSha], ["served commit", servedSha]] as const) {
    if (!ensureCommit(sha)) {
      return {
        verdict: "CANNOT_TELL",
        how: `the ${label} ${sha.slice(0, 7)} could not be fetched into this checkout, so nothing about the range can be proved`,
      };
    }
  }

  // `--is-ancestor` answers with its EXIT CODE — 0 is yes, 1 is no, anything
  // else is "git could not say" — so it is the one git call here that cannot
  // go through the returns-null-on-nonzero helper without collapsing "no"
  // into "unknown", which are different verdicts below.
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", recordedSha, servedSha], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const diff = git("diff", "--name-only", recordedSha, servedSha);
  return classifyEquivalenceRange({
    recordedSha,
    servedSha,
    ancestry: ancestry.status === 0 ? "ancestor" : ancestry.status === 1 ? "not-ancestor" : "unknown",
    rangePaths: diff === null ? null : diff.split("\n").filter(Boolean),
  });
}

async function main(): Promise<void> {
  const authority = await readIntegrityAuthority();
  const record = authority.record;
  const { paths, how } = changedPaths();
  const candidateSha = arg("sha") ?? git("rev-parse", "HEAD");
  const baseUrl = arg("base-url") ?? PRODUCTION_BASE_URL;

  const served = await observeProduction(baseUrl);
  // The equivalence proof is taken only when there is a difference for it to
  // be about, and it is measured here — the pure module consumes it and never
  // runs git itself.
  const equivalence =
    record.deployedSha !== null && served.sha !== null && !sameCommit(record.deployedSha, served.sha)
      ? proveApplicationEquivalence(record.deployedSha, served.sha)
      : null;
  const production: ProductionObservation = {
    servedSha: served.sha,
    how: served.how,
    readingAgeHours: readingAgeHours(record.observedAt, Date.now()),
    // The bound is the exported constant, passed explicitly. There is no
    // environment variable and no flag that can move it (see the module header).
    maxAgeHours: MAX_READING_AGE_HOURS,
    equivalence,
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
  console.log(
    `  authority      ${authority.kind} in cp_log_software_release_reviews/${PRODUCTION_INTEGRITY_LOG_KEY}`,
  );
  console.log("");
  console.log(explainFreeze(verdict));

  if (verdict.frozen) {
    console.log("");
    console.log("There is no skip flag, no environment override and no way to state the served");
    console.log("commit by hand. Clear the freeze by re-reading production:");
    console.log(
      `  pnpm integrity:check --sha=${verdict.servedSha ?? "<the sha /api/build returns>"} --write`,
    );

    /*
     * ======================================================================
     * WHERE A FRESHNESS FREEZE FAILS THE JOB, AND WHERE IT ONLY REPORTS.
     * (2026-08-29, measured on this gate's own first run against `main`.)
     * ======================================================================
     *
     * **THE DEFECT, MEASURED RATHER THAN ANTICIPATED.** The freshness clause
     * shipped, PR #221 merged, and the `gates` job on the merge commit went RED
     * with `PRODUCTION_MOVED`. Nothing was wrong with production: the reading
     * held, the deploy succeeded, and the migrations were all applied.
     *
     * It is red BY CONSTRUCTION, and it would be red after every
     * production-changing merge forever:
     *
     *   1. The merge lands on `main` and Netlify starts building it.
     *   2. The `gates` job checks out THE MERGE COMMIT — which necessarily
     *      carries the integrity record as it stood BEFORE this deploy, because
     *      the reading for this deploy cannot exist until the deploy finishes.
     *   3. Production has meanwhile moved (to this release, or to the observer's
     *      own record commit riding the accumulated Netlify diff).
     *   4. served != recorded -> PRODUCTION_MOVED -> frozen -> `main` is red.
     *
     * A gate that is guaranteed to fail regardless of the truth is not
     * measuring anything, and a permanently red `main` is how a real red stops
     * being read.
     *
     * **THE SPLIT, AND WHY IT WEAKENS NOTHING.** The freeze exists to refuse the
     * NEXT production-changing release while integrity is unproven. On a PULL
     * REQUEST that is exactly the question and it is answerable: the release has
     * not happened, production is serving the previous state, and its reading
     * should be current. **Every protection lives there and every protection is
     * kept — a frozen pull request still cannot merge.**
     *
     * On a PUSH TO `main` the release has ALREADY happened. Failing the job
     * prevents nothing; it only reports, after the fact, on a race whose other
     * half — `post-deploy-integrity.yml` — is already running and will record
     * the reading that clears it. So a FRESHNESS freeze there is printed as a
     * loud warning and does not fail the job.
     *
     * **DEGRADED IS DIFFERENT AND STILL FAILS EVERYWHERE.** `PRODUCTION_MOVED`,
     * `READING_EXPIRED`, `PRODUCTION_UNOBSERVABLE` and `NOT_ASSESSED` all say
     * *we do not currently know*. `DEGRADED` says *we asked, and production and
     * the committed migrations disagree* — an active incident, true whichever
     * event observed it, and exactly the 2026-08-28 drift. A red `main` is the
     * correct response to that, so it is excluded from the split by name rather
     * than by falling through a condition.
     *
     * This is a narrowing of WHERE a verdict fails a job. It is not an escape
     * hatch: there is still no flag, no environment override, and no path by
     * which a pull request carrying an unproven release reaches `main`.
     */
    const onMainPush =
      process.env.GITHUB_EVENT_NAME === "push" &&
      (process.env.GITHUB_REF === "refs/heads/main" || process.env.GITHUB_REF_NAME === "main");
    const freshnessOnly = verdict.state !== "DEGRADED";

    if (onMainPush && freshnessOnly) {
      console.log("");
      console.log(
        "::warning title=Production integrity is not current::" +
          `${verdict.freshness} on a push to main. The release has already happened, so this ` +
          "reports rather than refuses; post-deploy-integrity.yml records the reading that " +
          "clears it. A pull request in this state is REFUSED.",
      );
      console.log(
        "REPORTED, NOT REFUSED — this is a push to `main`. The freeze governs whether a release\n" +
          "MAY PROCEED, and this one already has. The same verdict on a pull request fails the job.",
      );
      process.exitCode = 0;
      return;
    }

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
