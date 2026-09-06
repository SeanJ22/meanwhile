import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  ProductionWriteRefused,
  SANCTIONED_WRITES,
  assertWriteAllowed,
  describeWriteContext,
} from "@/lib/db/write-guard";

const production = "postgres://owner:planted-secret@ep-live-123.example/neondb";
const staging = "postgres://owner:planted-secret@ep-stage-456.example/neondb";
const anchors = {
  WTP_BUILD_PRODUCTION_DATABASE_HOST: "ep-live-123.example",
  WTP_BUILD_STAGING_DATABASE_HOST: "ep-stage-456.example",
  WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST: "ep-control-live-123.example",
  WTP_BUILD_STAGING_CONTROL_PLANE_HOST: "ep-control-stage-456.example",
};
const deploy = (context: string, url: string) => ({
  ...anchors, NODE_ENV: "production", WTP_BUILD_CONTEXT: context, DATABASE_URL: url,
});

test("SISO-3: measured production runtime and production destination preserve writes", () => {
  assert.equal(describeWriteContext(deploy("production", production)).allowed, true);
  assert.doesNotThrow(() => assertWriteAllowed("a reaction", deploy("production", production)));
});

test("SISO-3: a built branch deploy may write to the measured staging destination", () => {
  const context = describeWriteContext(deploy("branch-deploy", staging));
  assert.equal(context.allowed, true);
  assert.equal(context.dbRole, "staging");
  assert.equal(context.isProductionRuntime, false);
});

test("PLANTED SISO-3: a built branch deploy pointed at production refuses loudly", () => {
  for (const url of [production, production.replace("ep-live-123.", "ep-live-123-pooler.")]) {
    const env = deploy("branch-deploy", url);
    assert.equal(describeWriteContext(env).allowed, false);
    assert.throws(() => assertWriteAllowed("a search log event", env), ProductionWriteRefused);
    assert.equal(describeWriteContext({ ...env, WTP_DB_ROLE: "local" }).allowed, false);
    assert.equal(describeWriteContext({
      ...env, WTP_SANCTIONED_WRITE: "intake-limiter-purge", WTP_PRODUCTION_DATABASE_URL_WRITE: url,
    }, "an intake limiter purge").allowed, false);
  }
});

test("SISO-3: unmeasured destinations, contexts and conflicting contexts fail safe", () => {
  for (const env of [
    { NODE_ENV: "production", DATABASE_URL: production },
    { NODE_ENV: "production", WTP_BUILD_CONTEXT: "production", DATABASE_URL: "postgres://owner:secret@unmeasured.example/production" },
    { NODE_ENV: "production", WTP_BUILD_CONTEXT: "production", DATABASE_URL: "postgres://owner:secret@production-unmeasured.example/db" },
    { ...deploy("production", "postgres://owner:secret@production-unmeasured.example/db") },
    { ...anchors, NODE_ENV: "production", DATABASE_URL: production },
    deploy("unexpected", staging),
    deploy("", staging),
    deploy("branch-deploy", "postgres://owner:secret@ep-unmeasured.example/neondb"),
    deploy("branch-deploy", "ep-stage-456.example"),
    deploy("branch-deploy", "https://ep-stage-456.example/neondb"),
    { ...deploy("branch-deploy", staging), WTP_BUILD_PRODUCTION_DATABASE_HOST: "" },
    { ...deploy("branch-deploy", staging), WTP_BUILD_STAGING_DATABASE_HOST: "" },
    { ...deploy("branch-deploy", staging), CONTEXT: "production" },
    { ...deploy("production", production), CONTEXT: "branch-deploy" },
    { ...deploy("production", production), WTP_BUILD_STAGING_DATABASE_HOST: anchors.WTP_BUILD_PRODUCTION_DATABASE_HOST },
    { ...deploy("branch-deploy", staging), NODE_ENV: "development" },
  ]) assert.equal(describeWriteContext(env).allowed, false);
});

test("SISO-3: runtime CONTEXT is usable when build context is unavailable", () => {
  const env = { ...deploy("", staging), CONTEXT: "branch-deploy" };
  assert.equal(describeWriteContext(env).allowed, true);
});

test("SISO-3: control-plane classification measures its own connection and anchors", () => {
  const env = {
    ...deploy("branch-deploy", staging),
    WTP_CONTROL_PLANE_DATABASE_URL: "postgres://owner:secret@ep-control-stage-456.example/controlplane",
  };
  assert.equal(describeWriteContext(env, "a repository mutation", "control-plane").allowed, true);
  assert.equal(describeWriteContext({
    ...env, WTP_CONTROL_PLANE_DATABASE_URL: "postgres://owner:secret@ep-control-live-123-pooler.example/controlplane",
  }, "a repository mutation", "control-plane").allowed, false);
});

test("local writes require both measured loopback destination and local development", () => {
  const env = { NODE_ENV: "development", WTP_DB_ROLE: "local", DATABASE_URL: "postgres://dev:pw@localhost/dev" };
  assert.equal(describeWriteContext(env).allowed, true);
  assert.equal(describeWriteContext({ ...env, DATABASE_URL: production }).allowed, false);
  assert.equal(describeWriteContext({ ...env, NODE_ENV: "production" }).allowed, false);
  assert.equal(describeWriteContext({ ...env, WTP_DB_ROLE: "Local" }).allowed, false);
});

test("a refusal exposes neither connection string nor planted credentials", () => {
  try {
    assertWriteAllowed("a reaction", deploy("branch-deploy", production));
    assert.fail("the planted production collision was allowed");
  } catch (error) {
    assert.ok(error instanceof ProductionWriteRefused);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /planted-secret|postgres:\/\//);
  }
});

/* --------------------------------------------- g13: the named sanction --- */

/*
  2026-08-18: the intake tripwire's daily run was refused. `NODE_ENV` and
  `WTP_DB_ROLE` are both unset in GitHub Actions, so the guard read a
  non-production runtime pointed at the sold store — which is precisely what
  it was. The guard was correct and stayed unchanged; the JOB was taught to
  declare itself.

  These plant every way the declaration can be wrong. A sanction whose refusal
  has never been demonstrated is a comment, and this one has to hold against
  the obvious abuse: copying the declaration into a script that wants to write
  something else.
*/

const PURGE = "an intake limiter purge";
const CONNECTION = "postgres://neondb_owner:pw@ep-dry-river.example/neondb";

/** The workflow's environment, exactly as intake-tripwire.yml sets it. */
const sanctionedEnv = () => ({
  DATABASE_URL: CONNECTION,
  WTP_PRODUCTION_DATABASE_URL_WRITE: CONNECTION,
  WTP_SANCTIONED_WRITE: "intake-limiter-purge",
});

test("g13: the scheduled purge, declared as the workflow declares it, is allowed", () => {
  const context = describeWriteContext(sanctionedEnv(), PURGE);
  assert.equal(context.allowed, true, context.reason);
  assert.equal(context.sanction, "intake-limiter-purge");
  // The runtime has not been reclassified — this is still CI pointed at
  // production, and the context says so. Only the operation was opened.
  assert.equal(context.isProductionRuntime, false);
  assert.equal(context.dbRole, "production");
  assert.doesNotThrow(() => assertWriteAllowed(PURGE, sanctionedEnv()));
});

test("PLANTED g13: the same script WITHOUT the declaration is still refused", () => {
  // The regression that matters most: if the guard ever starts inferring the
  // sanction from the operation, or from CI, this passes silently and the P0
  // is reopened for every writer.
  const env = { DATABASE_URL: CONNECTION, WTP_PRODUCTION_DATABASE_URL_WRITE: CONNECTION };
  const context = describeWriteContext(env, PURGE);
  assert.equal(context.allowed, false, "an undeclared purge was allowed");
  assert.equal(context.sanction ?? null, null);
  assert.throws(() => assertWriteAllowed(PURGE, env), ProductionWriteRefused);
});

test("PLANTED g13: an unrelated script WITH the declaration is still refused", () => {
  // The abuse this scoping exists to stop: the declaration is copied into a
  // job that writes reactions. A sanction opens ONE operation, never a script
  // and never a runtime.
  const context = describeWriteContext(sanctionedEnv(), "a reaction");
  assert.equal(context.allowed, false, "the purge sanction opened a reaction write");
  assert.match(context.reason, /permits/);
  assert.throws(
    () => assertWriteAllowed("a reaction", sanctionedEnv()),
    ProductionWriteRefused,
  );
  // The search log and the feedback store are the other two writers that run
  // anywhere near this job. Neither may ride the purge's declaration.
  for (const other of ["a search log event", "a feedback submission", "an intake limiter counter"]) {
    assert.equal(
      describeWriteContext(sanctionedEnv(), other).allowed,
      false,
      `the purge sanction opened ${other}`,
    );
  }
});

test("PLANTED g13: a sanction nobody has named is refused, and says so", () => {
  const context = describeWriteContext(
    { ...sanctionedEnv(), WTP_SANCTIONED_WRITE: "whatever-i-need" },
    PURGE,
  );
  assert.equal(context.allowed, false);
  assert.match(context.reason, /no such sanction exists/);
});

test("PLANTED g13: the declaration does not stand in for a destination", () => {
  // Without the write variable at all, and with the write variable pointing
  // somewhere other than the connection the process will actually use. Both
  // are a purpose declared over an unnamed destination.
  const missing = { DATABASE_URL: CONNECTION, WTP_SANCTIONED_WRITE: "intake-limiter-purge" };
  assert.equal(describeWriteContext(missing, PURGE).allowed, false);
  assert.match(
    describeWriteContext(missing, PURGE).reason,
    /WTP_PRODUCTION_DATABASE_URL_WRITE is not set/,
  );

  const mismatched = {
    DATABASE_URL: "postgres://neondb_owner:pw@ep-somewhere-else.example/neondb",
    WTP_PRODUCTION_DATABASE_URL_WRITE: CONNECTION,
    WTP_SANCTIONED_WRITE: "intake-limiter-purge",
  };
  assert.equal(describeWriteContext(mismatched, PURGE).allowed, false);
  assert.match(describeWriteContext(mismatched, PURGE).reason, /DATABASE_URL is not/);
});

test("g13: the refusal names the sanctioned path, not only .env.local", () => {
  // The message a scheduled job's log shows. Before g13 it offered exactly one
  // remedy — point DATABASE_URL at a local database — which a CI runner whose
  // whole job is to touch production cannot take. It read as "you are wrong"
  // to a reader who was not.
  let message = "";
  try {
    assertWriteAllowed(PURGE, { NODE_ENV: undefined });
    assert.fail("the undeclared purge was not refused at all");
  } catch (error) {
    assert.ok(error instanceof ProductionWriteRefused);
    message = error.message;
  }
  assert.match(message, /WTP_SANCTIONED_WRITE/);
  assert.match(message, /WTP_PRODUCTION_DATABASE_URL_WRITE/);
  assert.match(message, /NAMED SANCTION/);
});

test("g13: the sanction table is a closed list, and the purge is on it", () => {
  // The table is the audit surface: a reader asking "what may write to
  // production without being production" gets one enumerable answer.
  assert.deepEqual(Object.keys(SANCTIONED_WRITES), ["intake-limiter-purge"]);
  assert.equal(SANCTIONED_WRITES["intake-limiter-purge"], PURGE);
  // And it must match the string the purge actually passes, or the sanction
  // opens nothing and the job stays broken while every test here still passes.
  const limiter = readFileSync("lib/db/intake-limiter.ts", "utf8");
  assert.ok(
    limiter.includes(`assertWriteAllowed("${PURGE}")`),
    "purgeExpiredLimiterState no longer asks for the operation the sanction names",
  );
});

test("g13: the workflow declares exactly what the guard requires", () => {
  // The three pieces live in a YAML file no test would otherwise read. A
  // rename on either side breaks the job at 10:41 UTC and nowhere else.
  const workflow = readFileSync(".github/workflows/intake-tripwire.yml", "utf8");
  assert.match(workflow, /WTP_SANCTIONED_WRITE: intake-limiter-purge/);
  assert.match(workflow, /WTP_PRODUCTION_DATABASE_URL_WRITE: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
});

test("g13 audit: every scheduled workflow that writes carries a sanction", () => {
  /*
    The author's standing rule — a named instance is an example of a class. The
    class here is "scheduled jobs that write to production". Enumerated, with
    what each one does:

      intake-tripwire.yml          WRITES — the limiter purge. Sanctioned here.
      refresh-meetings-snapshot.yml  no DB write; commits a JSON file.
      refresh-fec-snapshot.yml       no DB write; commits a JSON file.
      refresh-dotgov-snapshot.yml    no DB write; commits a JSON file.
      refresh-legiscan-snapshot.yml  no DB write; commits a JSON file.
      build-check.yml                READS, and no DB write — it builds and
                                     reads the build's own output (R51,
                                     2026-08-18). It is also the one workflow
                                     here that is not scheduled: it runs on
                                     push and on pull requests.

                                     ONE STEP GAINED DATABASE ACCESS ON
                                     2026-08-28, and this is the "say so where
                                     it is set" this guard asks for. The schema
                                     shipping gate reads production's applied
                                     migrations before a merge, because 0021
                                     and 0022 shipped ahead of the schema and
                                     the daily tripwire found it the morning
                                     after. It resolves
                                     WTP_PRODUCTION_DATABASE_URL_READONLY — the
                                     read-only role, by name, one SELECT — and
                                     it carries NO sanction, because it must
                                     never be able to write. That is asserted
                                     below rather than described: this workflow
                                     may name the READONLY variable and nothing
                                     else, and may not carry WTP_SANCTIONED_WRITE.

      job-watch.yml                  no DB write; reads the Actions API and
                                     commits a tracker row (RULING 56, NH Hunt
                                     3, 2026-08-21). It holds no database
                                     credential at all, deliberately: what it
                                     watches is job outcomes, not data.

    So: seven workflows, one of which writes to the database. Five commit files
    to the repository and never open a connection, and one writes nothing at
    all. This asserts that split rather than describing it, so a workflow that
    grows a DATABASE_URL later cannot join the class silently.
  */
  const dir = ".github/workflows";
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  // 8 as of NJ Hunt 3 (2026-08-22): `refresh-nj-filing.yml` joined the set. It
  // reads a county clerk's public PDFs and rebuilds a committed JSON file; it
  // touches no database, which is why it appears here only as a count and not
  // in `withDatabase` below.
  // TEN as of 2026-08-29 (NH273): post-deploy-integrity.yml joined the set. It
  // is the SECOND workflow to hold a database credential, and like build-check
  // it holds the READ-ONLY one — it asks production whether it holds the
  // migrations the deployed commit ships, and records the answer. It commits
  // exactly one non-shipping file. It is held to reading below, by the same
  // assertion build-check is, because it runs unattended on every push to
  // `main` and an unattended job is the last place a write-capable string
  // should be reachable.
  //
  // NINE as of 2026-08-24 (RULING 124): the eight below plus refresh-daily.yml,
  // the one orchestrated run that now carries every source's cron.
  assert.equal(workflows.length, 10, `the workflow set changed: ${workflows.join(", ")}`);

  const withDatabase: string[] = [];
  for (const file of workflows) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    if (/DATABASE_URL/.test(source)) withDatabase.push(file);
  }
  assert.deepEqual(
    withDatabase,
    ["build-check.yml", "intake-tripwire.yml", "post-deploy-integrity.yml"],
    "a workflow gained database access — if it writes, it needs its own " +
      "named sanction; if it only reads, say so where it is set",
  );
  assert.match(
    readFileSync(`${dir}/intake-tripwire.yml`, "utf8"),
    /WTP_SANCTIONED_WRITE:/,
    "the one writing workflow lost its sanction",
  );

  /*
   * THE READER IS HELD TO READING (2026-08-28).
   *
   * `build-check.yml` runs on every pull request, so a credential in it is
   * reachable by any change. Its ONE database step must resolve the read-only
   * variable by name and nothing else: no bare `DATABASE_URL`, no
   * `WTP_PRODUCTION_DATABASE_URL_WRITE`, and no sanction — `lib/db/write-handle.ts`
   * refuses the READONLY string for writing, and `scripts/apply-migrations.mts`
   * refuses to run without a sanctioned write variable, so both halves have to
   * stay absent for that refusal to mean anything here.
   */
  const buildCheck = readFileSync(`${dir}/build-check.yml`, "utf8");
  const databaseNames = [...buildCheck.matchAll(/[A-Z_]*DATABASE_URL[A-Z_]*/g)].map((m) => m[0]);
  assert.ok(databaseNames.length > 0, "the reader found no database variable to check at all");
  assert.deepEqual(
    [...new Set(databaseNames)],
    ["WTP_PRODUCTION_DATABASE_URL_READONLY"],
    "build-check.yml runs on every pull request and may name only the READ-ONLY production " +
      "variable. A write-capable string here is reachable from any change.",
  );
  assert.doesNotMatch(
    buildCheck,
    /WTP_SANCTIONED_WRITE/,
    "build-check.yml must carry no write sanction — its database step exists to ask a question",
  );

  /*
   * THE OBSERVER IS HELD TO READING TOO (2026-08-29, NH273).
   *
   * `post-deploy-integrity.yml` is the first workflow to hold a database
   * credential AND run unattended on every push to `main`. `build-check.yml` at
   * least fails in front of a person waiting on a pull request; this one runs
   * while nobody is watching, which is the strongest case in the repository for
   * holding it to exactly one read-only name.
   *
   * It is asserted with the same three clauses rather than a looser pair,
   * because the reason build-check is held this way — a write-capable string in
   * a broadly-reachable workflow — applies here more, not less.
   */
  const observer = readFileSync(`${dir}/post-deploy-integrity.yml`, "utf8");
  const observerNames = [...observer.matchAll(/[A-Z_]*DATABASE_URL[A-Z_]*/g)].map((m) => m[0]);
  assert.ok(observerNames.length > 0, "the observer found no database variable to check at all");
  assert.deepEqual(
    [...new Set(observerNames)],
    ["WTP_PRODUCTION_DATABASE_URL_READONLY"],
    "post-deploy-integrity.yml runs unattended on every push to main and may name only the " +
      "READ-ONLY production variable. It takes a reading; it does not reconcile anything.",
  );
  assert.doesNotMatch(
    observer,
    /WTP_SANCTIONED_WRITE/,
    "post-deploy-integrity.yml must carry no write sanction — the owner's NH273 decision is that " +
      "a red reading marks state DEGRADED and freezes the next release. It never repairs production.",
  );
});
