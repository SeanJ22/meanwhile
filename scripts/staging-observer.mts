/**
 * @freshness-reads-here — `observedAt` is stamped at the moment the staging
 * host is actually read, in the same run that reads it. It measures when the
 * reading happened; it never re-stamps a date carried over from somewhere else,
 * which is the restamping RULING 107 refuses. If this script ever recorded a
 * reading it did not itself take — a cached answer, a copied production
 * record — this declaration would be false, and the staging record would be
 * claiming a freshness it did not earn.
 *
 * `pnpm staging:observe` — **the SECOND observer.** (Lane 5, 2026-09-01.)
 *
 * `scripts/post-deploy-observer.mts` watches what a reader loads. This watches
 * the integration branch's deploy, and it is a separate script rather than a
 * flag on that one for the reason `lib/ops/origins.ts` states in its own words:
 *
 * > The production origin is never overloaded to select staging or admin
 * > behaviour. […] A single `SITE_ORIGIN` that some caller flips to a staging
 * > value is how a staging run gets recorded as a production verification, and
 * > a production verification is the one record in this repository that may
 * > never be approximate.
 *
 * So this file takes {@link STAGING_RENDER_ORIGIN} BY NAME. There is no
 * `--base-url`, no `--record`, and no environment variable that can point it
 * anywhere else — the two things a mistake would have to change are both
 * compile-time constants, and one of them is checked against the production
 * record path before anything else happens.
 *
 * ## IT OPENS NO DATABASE CONNECTION, AND THAT IS LOAD-BEARING
 *
 * `tests/migration-shipping-invariant.test.ts` holds the set of files permitted
 * to query `drizzle.__drizzle_migrations` **closed to four**, because two
 * implementations of "does this database hold the migrations this commit ships"
 * are two verdicts free to disagree with the one branch protection trusts. This
 * script is not a fifth. Exactly like `scripts/production-integrity.mts`, it
 * spawns the existing gate as a subprocess and records what it said.
 *
 * ## WHICH DATABASE THE GATE IS ASKED ABOUT, and why the answer is not obvious
 *
 * `scripts/db-shipping-gate.mts` reads one variable by a fixed name —
 * `WTP_PRODUCTION_DATABASE_URL_READONLY`. Spawned naively from here it would
 * read PRODUCTION'S database and the verdict would be filed as the STAGING
 * deploy's migrations state: a true answer to a question nobody asked,
 * recorded as the answer to one nobody checked. **That is a false claim about
 * a deploy, and it is the exact shape RULING 24 forbids.**
 *
 * So the two cases are handled separately, and only ever in the safe direction:
 *
 * ```
 *   WTP_STAGING_DATABASE_URL_READONLY set    -> SET into the child's env as the
 *                                               variable the gate reads, after
 *                                               the isolation guard has proven
 *                                               it is NOT the production
 *                                               endpoint
 *   not set                                  -> THE GATE IS NOT SPAWNED. No
 *                                               database is contacted at all,
 *                                               and the record says
 *                                               CREDENTIAL_ABSENT
 * ```
 *
 * **The second branch does not delete the production variable and spawn the
 * gate anyway, and the reason is measured.** `scripts/db-shipping-gate.mts`
 * calls `dotenv.config({ path: ".env.local" })`, so a deleted variable is
 * reloaded from the author's own `.env.local` — which holds the PRODUCTION
 * connection. Deleting is not dependable; setting is (dotenv does not override
 * a key already present). A run with no staging credential therefore reads
 * nothing, which is the whole point: **a check that cannot reach its subject
 * must never print like one that did.**
 *
 * That is the branch that runs today — the variable is not provisioned, and a
 * Neon staging branch needs an API key this environment does not have.
 *
 * ## The isolation guard runs FIRST, before a single request
 *
 * If the staging credential resolves to the production endpoint, this refuses
 * and records nothing. `lib/ops/staging-isolation.ts` carries the reasoning;
 * what matters here is the ORDER. Contacting staging first and checking after
 * would mean the run that discovers the misconfiguration has already taken
 * measurements against it.
 *
 *   --expect=<sha>   the commit staging should be serving. Defaults to
 *                    `origin/<integration branch>`, then HEAD.
 *   --write          persist the reading. Without it nothing is recorded.
 *   --attempts=<n>   tighten the poll. It may never loosen it: POLL_BOUND is
 *                    the ceiling, and it is the production observer's own.
 *
 * Exit codes, mirroring the production observer so one vocabulary covers both:
 *   0  staging serves the expected commit and the reading HELD (or the commit
 *      is not a release, so no deploy and no reading are owed)
 *   1  REFUSED — the isolation guard caught a misconfiguration, or the gate did
 *   2  COULD NOT TELL — staging could not be asked, or the gate could not
 *   3  STAGING_BEHIND — the bound elapsed and staging serves something else
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { IntegrityRecord } from "../lib/ops/production-integrity.ts";
import { STAGING_RENDER_ORIGIN } from "../lib/ops/origins.ts";
import { STAGING_BRANCH } from "../lib/ops/staging-promotion.ts";
import {
  BRANCH_DEPLOY_CONTEXT,
  classifyDatabaseUrl,
  evaluateIsolation,
  recordPathCollides,
  sameEndpointIdentity,
  type IsolationVerdict,
} from "../lib/ops/staging-isolation.ts";
import { fetchServedCommit, POLL_BOUND, isRelease, pollUntilServed } from "./post-deploy-observer.mts";
import {
  RETIRED_PRODUCTION_RECORD_PATH,
  STAGING_INTEGRITY_RECORD_PATH,
  git,
  readRecord,
  writeRecord,
} from "./production-integrity.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **The staging record, and it is a constant.**
 *
 * `data/ops/` is in `NON_SHIPPING_PREFIXES` (`lib/ops/deploy-paths.ts`), so a
 * commit carrying only this file classifies as `cancel` and cannot trigger the
 * deploy this observer exists to observe — the same property the production
 * record already relies on.
 */
export const STAGING_RECORD_PATH = STAGING_INTEGRITY_RECORD_PATH;

/** The variable holding a READ-ONLY connection to the staging database. */
export const STAGING_URL_VARIABLE = "WTP_STAGING_DATABASE_URL_READONLY";

/** The variable `scripts/db-shipping-gate.mts` reads, by its fixed name. */
const GATE_URL_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

/** One-line flag reader. Deliberately not another copy of `arg` (RULING 103). */
const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * What this observer adds to the gate's own record.
 *
 * The child writes every field of {@link IntegrityRecord} — it owns the
 * migrations verdict and its failure class, and nothing here re-derives them.
 * This envelope is the part the child cannot know: which origin was observed,
 * what was expected of it, and which database the verdict is actually ABOUT.
 * `migrationsSubject` is the field that stops the record being misread: a
 * COULD_NOT_TELL with `NOT_READ` is a statement that no database was contacted,
 * which is a different fact from a database that would not answer.
 */
export interface StagingIntegrityRecord extends IntegrityRecord {
  readonly observedOrigin: string;
  readonly expectedSha: string | null;
  readonly expectedFrom: string;
  readonly servedSha: string | null;
  readonly observerOutcome: string;
  readonly migrationsSubject: "STAGING" | "NOT_READ";
  readonly isolation: IsolationVerdict;
  readonly note: string;
}

/**
 * The isolation reading, taken with no value ever leaving the pure module.
 *
 * Both connection strings are read here and handed straight in. Nothing in this
 * function or its caller formats, slices, truncates or logs either one; the
 * verdict carries a role name and a sentence, and that is all that comes back.
 */
function readIsolation(): { verdict: IsolationVerdict; stagingUrl: string | null } {
  const stagingUrl = process.env[STAGING_URL_VARIABLE] ?? null;
  const productionUrl = process.env[GATE_URL_VARIABLE] ?? null;

  const role = classifyDatabaseUrl(stagingUrl, {
    productionHostHint: productionUrl,
    stagingHostHint: stagingUrl,
  });
  const productionRole = classifyDatabaseUrl(productionUrl, {
    productionHostHint: productionUrl,
    stagingHostHint: null,
  });
  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role,
    productionRole,
    sameEndpointAsProduction: sameEndpointIdentity(stagingUrl, productionUrl),
  });
  return { verdict, stagingUrl };
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const attempts = flag("attempts") ? Number(flag("attempts")) : undefined;

  console.log("STAGING OBSERVER");
  console.log(`  asking         ${STAGING_RENDER_ORIGIN}/api/build`);
  console.log(`  recording      ${STAGING_RECORD_PATH}`);
  console.log(`  never writes   ${RETIRED_PRODUCTION_RECORD_PATH}`);
  console.log("  values printed NONE — connection strings are classified, never shown");
  console.log("");

  /*
   * **THE STRUCTURAL REFUSAL, FIRST, BEFORE ANYTHING ELSE HAPPENS.**
   *
   * `data/ops/production-integrity.json` is the retired historical production
   * record. Release certification now reads the canonical control-plane log,
   * never this file. The staging observer still cannot overwrite the historical
   * artifact: doing so would erase its provenance and make staging evidence look
   * like an archived production observation. Both constants are compile-time,
   * so this can only fire if somebody edits one, and firing at the top means it
   * fires before a single measurement has been taken.
   */
  if (recordPathCollides(STAGING_RECORD_PATH, RETIRED_PRODUCTION_RECORD_PATH)) {
    console.error(
      "REFUSED — the staging record path resolves to the PRODUCTION integrity record.\n" +
        "Nothing was read and nothing was written. The staging observer may not write the\n" +
        "record the release-freeze gate trusts, whatever the constants now say.",
    );
    process.exitCode = 2;
    return;
  }

  /* -------------------------------------------- the isolation guard, second */

  const { verdict: isolation, stagingUrl } = readIsolation();
  console.log(`ISOLATION: ${isolation.ok ? "ISOLATED" : "NOT ESTABLISHED"} (role ${isolation.role})`);
  console.log(`  ${isolation.reason}`);
  console.log("");

  /*
   * A CREDENTIAL WE DO NOT HAVE IS NOT A MISCONFIGURATION. The refusal that
   * stops this run is the one where the staging variable IS set and resolves to
   * production; an absent variable is the ordinary state today and produces an
   * honest COULD_NOT_TELL from the gate further down, not a refusal here.
   */
  if (stagingUrl !== null && !isolation.ok) {
    console.error(
      `REFUSED — ${STAGING_URL_VARIABLE} is set and the isolation guard did not clear it.\n` +
        `${isolation.reason}\n\n` +
        "Nothing was recorded. A staging run that resolves the production database would write\n" +
        "every probe row into the store this business sells from, so this stops before it asks\n" +
        "staging anything at all.",
    );
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------ what staging should serve */

  const expectArg = flag("expect");
  // DERIVED from the host this observer watches, never typed: on this
  // provider a branch deploy is served at <branch>.<suffix>, so the branch
  // name and the subdomain label are one fact (see STAGING_BRANCH).
  const stagingRemoteRef = `origin/${STAGING_BRANCH}`;
  const fromStagingRef = git("rev-parse", stagingRemoteRef);
  const expected = expectArg ?? fromStagingRef ?? git("rev-parse", "HEAD");
  const expectedFrom = expectArg
    ? "--expect="
    : fromStagingRef
      ? stagingRemoteRef
      : `HEAD (no ${stagingRemoteRef} ref in this checkout)`;

  console.log(`  expecting      ${expected ?? "UNKNOWN"}  (from ${expectedFrom})`);
  console.log(
    `  bound          at most ${POLL_BOUND.maxAttempts} probes, ${POLL_BOUND.intervalSeconds}s apart, ` +
      `${POLL_BOUND.maxTotalWaitSeconds}s total`,
  );
  console.log("");

  if (expected === null) {
    console.error("COULD NOT TELL — this checkout could not name a commit to expect.");
    process.exitCode = 2;
    return;
  }

  /*
   * `isRelease` is the PRODUCTION observer's own, imported rather than
   * re-derived: `classifyDeploy` is the authority on what a release is, and a
   * staging copy of that judgement would be a second answer free to disagree
   * about the same commit (RULING 103). Netlify's ignore step runs the same
   * predicate for the branch deploy, so a commit it cancels there is a commit
   * this must not sit waiting ten minutes for.
   */
  const scope = isRelease(expected);
  if (!scope.release) {
    console.log(`NOT_A_RELEASE — ${scope.reason}`);
    console.log("No branch deploy is owed for this commit, so no reading is owed either.");
    console.log("Nothing was recorded, and the previous reading stands unchanged.");
    process.exitCode = 0;
    return;
  }

  const result = await pollUntilServed({
    expectedSha: expected,
    attempts,
    probe: async (attempt) => {
      const seen = await fetchServedCommit(STAGING_RENDER_ORIGIN, {
        runId: process.env.WTP_RUN_ID ?? "staging-observer",
      });
      console.log(`  probe ${String(attempt).padStart(2)}  ${seen.sha ?? "NO ANSWER"}  ${seen.how}`);
      return seen;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  console.log("");
  console.log(`OUTCOME: ${result.outcome}`);
  console.log(`  ${result.detail}`);
  /*
   * BORROWED VOCABULARY, NAMED. `pollUntilServed` is production's poller and
   * says "production" in its own sentences. It is imported rather than copied
   * (RULING 103) and the URL in its detail line is the staging one, so nothing
   * it prints is false — but a reader skimming a log should not have to work
   * that out, and an unlabelled "production" in a staging record is exactly the
   * kind of thing that gets quoted later as a claim about the live site.
   */
  console.log(
    `  (the line above is the shared poller's wording; every measurement in it was taken ` +
      `against ${STAGING_RENDER_ORIGIN}, and none of it is a claim about the live site.)`,
  );

  if (result.outcome === "COULD_NOT_TELL") {
    console.log("");
    console.log("Nothing was recorded. An unreachable staging deploy is not a reading, and writing");
    console.log("one would put a fact we do not have into a record somebody will read later.");
    process.exitCode = 2;
    return;
  }

  if (result.outcome === "PRODUCTION_BEHIND") {
    /*
     * The shared poller's vocabulary says PRODUCTION_BEHIND because it is
     * production's poller. RENAMED IN THE OUTPUT, never in the type: printing
     * "production" here would be this file making a claim about the site
     * readers load, on evidence taken entirely from another host.
     */
    console.log("");
    console.log("STAGING_BEHIND — the branch deploy has not arrived. Nothing was recorded, and");
    console.log("nothing about production changed or is implied. The deploy itself is the thing");
    console.log("to chase.");
    process.exitCode = 3;
    return;
  }

  const sha = result.servedSha as string;

  /* ------------------------------------------- the reading, through the gate */

  /*
   * **WITH NO STAGING CREDENTIAL, THE GATE IS NOT SPAWNED AT ALL.**
   *
   * The first draft of this deleted `WTP_PRODUCTION_DATABASE_URL_READONLY` from
   * the child's environment and spawned the gate anyway, expecting it to report
   * CREDENTIAL_ABSENT. **That was wrong, and it was measured wrong rather than
   * reasoned wrong:** `scripts/db-shipping-gate.mts` calls
   * `dotenv.config({ path: ".env.local" })` on line 145, so a variable DELETED
   * from the child's environment is immediately reloaded from the author's own
   * `.env.local` — which holds the PRODUCTION connection. The observer would
   * have read production's migrations and filed the answer as the staging
   * deploy's state: a true answer to a question nobody asked, recorded as the
   * answer to one nobody checked.
   *
   * So the no-credential case contacts nothing. The record it writes says
   * CREDENTIAL_ABSENT because the variable is unset — a fact this script knows
   * directly, not one it derived from an exit code, so no second classifier
   * exists here to disagree with the gate's.
   *
   * The other branch is safe for the opposite reason: `dotenv` does NOT
   * override a key that is already present in `process.env` (no `override`
   * option is passed), so a variable SET in the child's environment wins over
   * `.env.local`. Setting is dependable; deleting is not.
   */
  const migrationsSubject: StagingIntegrityRecord["migrationsSubject"] =
    stagingUrl === null ? "NOT_READ" : "STAGING";

  if (stagingUrl === null) {
    console.log("");
    console.log(`COULD NOT TELL — ${STAGING_URL_VARIABLE} is not set, so the schema gate was NOT`);
    console.log("run and NO database was contacted. Staging's migration state is unknown, which is");
    console.log("the absence of a reading rather than a reading of an absence, and it is not a pass.");
    console.log(`Staging serves ${sha}, which is what was expected — that part IS established.`);

    if (write) {
      const record: StagingIntegrityRecord = {
        formatVersion: 1,
        deployedSha: sha,
        mainSha: git("rev-parse", "origin/main"),
        observed: "COULD_NOT_TELL",
        failureClass: "CREDENTIAL_ABSENT",
        detail: `${STAGING_URL_VARIABLE} is not set, so no schema gate was run against staging.`,
        observedAt: new Date().toISOString(),
        moment: null,
        gateExit: null,
        observedOrigin: STAGING_RENDER_ORIGIN,
        expectedSha: expected,
        expectedFrom,
        servedSha: sha,
        observerOutcome: "SERVING_EXPECTED",
        migrationsSubject,
        isolation,
        note:
          `No database was contacted. ${STAGING_URL_VARIABLE} is the missing piece, and until it ` +
          "exists the migrations half of this reading is UNKNOWN. What IS established is which " +
          "commit the staging origin serves.",
      };
      writeRecord(record, STAGING_RECORD_PATH);
      console.log(`\nrecorded: ${STAGING_RECORD_PATH}`);
    } else {
      console.log("\n(--write not given; nothing was recorded)");
    }
    process.exitCode = 2;
    return;
  }

  const childEnv: NodeJS.ProcessEnv = { ...process.env, [GATE_URL_VARIABLE]: stagingUrl };

  console.log("");
  console.log(`Taking the reading against ${sha} through the EXISTING gate.`);
  console.log(`The gate is pointed at ${STAGING_URL_VARIABLE}. Every line it prints below saying`);
  console.log('"production" is that script\'s own fixed vocabulary, not a claim about this run.');
  console.log("");

  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "scripts", "production-integrity.mts"),
      `--sha=${sha}`,
      `--record=${STAGING_RECORD_PATH}`,
      ...(write ? ["--write"] : []),
    ],
    /*
     * NO SHELL. `shell: true` concatenates rather than escapes, and `--sha=` is
     * a value that arrived over the network — shape-checked to a git object id
     * by `fetchServedCommit`, so both halves of the defence are present and
     * neither is load-bearing alone.
     */
    { cwd: ROOT, encoding: "utf8", env: childEnv },
  );
  const childOutput = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  for (const line of childOutput.split("\n")) console.log(`  child | ${line}`);
  const exit = run.status ?? 2;

  if (!write) {
    console.log("\n(--write not given; the reading above was taken and nothing was recorded)");
    process.exitCode = exit === 0 || exit === 1 || exit === 2 ? exit : 2;
    return;
  }

  /*
   * The child owns the migrations verdict and has just written it. Reading it
   * back and re-writing it with the envelope keeps ONE owner per field: nothing
   * here re-derives `observed`, `failureClass` or `detail` from an exit code,
   * which would be a second classifier free to disagree with the one that
   * actually ran the gate.
   */
  const written = readRecord(STAGING_RECORD_PATH);
  const record: StagingIntegrityRecord = {
    ...written,
    observedOrigin: STAGING_RENDER_ORIGIN,
    expectedSha: expected,
    expectedFrom,
    servedSha: sha,
    observerOutcome: "SERVING_EXPECTED",
    migrationsSubject,
    isolation,
    note: `The migrations verdict above is about the STAGING database, read through ${STAGING_URL_VARIABLE}.`,
  };
  writeRecord(record, STAGING_RECORD_PATH);
  console.log(`\nrecorded: ${STAGING_RECORD_PATH}`);
  console.log(`  migrations subject: ${migrationsSubject}`);

  process.exitCode = exit === 0 || exit === 1 || exit === 2 ? exit : 2;
}

/*
 * `process.exitCode`, never `process.exit()` — this script makes HTTP requests,
 * and exiting with undici's socket open aborts the process on Windows and
 * DESTROYS the exit code, which is the whole reason there are four of them.
 * Nothing above runs on import, so the suite can drive the exported halves.
 */
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/staging-observer.mts")) {
  await main();
}
