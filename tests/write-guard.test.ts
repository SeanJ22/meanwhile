import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ProductionWriteRefused,
  SANCTIONED_WRITES,
  assertWriteAllowed,
  describeWriteContext,
} from "@/lib/db/write-guard";
import { RuntimeAuthorityRefused } from "@/lib/civic-data/runtime-authority";

/*
  The P0 of 2026-08-17: `pnpm dev` reads .env.local, .env.local carried the
  production DATABASE_URL, and opening a browser at localhost:3000 wrote an
  unmarked ORGANIC row into the store the business sells from.

  These tests pin the DECISION TABLE rather than the implementation, because
  the property that matters is which of the four (runtime x database) pairings
  may write. Every case below is a pairing, and the one that caused the defect
  is asserted by name.
*/

test("the defect that caused this: a dev server pointed at production is refused", () => {
  const context = describeWriteContext({ NODE_ENV: "development" });
  assert.equal(context.allowed, false);
  assert.equal(context.dbRole, "production");
  assert.equal(context.isProductionRuntime, false);
});

test("the production runtime writing to the production database is allowed", () => {
  const context = describeWriteContext({ NODE_ENV: "production" });
  assert.equal(context.allowed, true);
  assert.equal(context.dbRole, "production");
});

test("a local database may be written from a local runtime", () => {
  const context = describeWriteContext({
    NODE_ENV: "development",
    WTP_DB_ROLE: "local",
  });
  assert.equal(context.allowed, true);
  assert.equal(context.dbRole, "local");
});

test("an undeclared database is assumed to be production, not local", () => {
  // The whole design. A new checkout, a forgotten variable, a fresh CI box and
  // a script nobody thought about all land here, and all are refused.
  const context = describeWriteContext({ NODE_ENV: "development" });
  assert.equal(context.dbRole, "production");
  assert.equal(context.allowed, false);
});

test("a typo in WTP_DB_ROLE fails safe rather than opening the gate", () => {
  for (const typo of ["locl", "Local", " local", "LOCAL", "true", ""]) {
    const context = describeWriteContext({ NODE_ENV: "development", WTP_DB_ROLE: typo });
    assert.equal(
      context.dbRole,
      "production",
      `WTP_DB_ROLE=${JSON.stringify(typo)} must not read as local`,
    );
    assert.equal(context.allowed, false);
  }
});

test("NODE_ENV values that are not exactly production do not count as production", () => {
  for (const value of ["Production", "prod", "test", "", undefined]) {
    const context = describeWriteContext({ NODE_ENV: value });
    assert.equal(context.isProductionRuntime, false, `NODE_ENV=${String(value)}`);
    assert.equal(context.allowed, false);
  }
});

test("assertWriteAllowed throws a named error, not a generic one", () => {
  // A refusal must be distinguishable from the database being down: one is a
  // misconfiguration to fix, the other is an outage to wait out.
  assert.throws(
    () => assertWriteAllowed("a reaction", { NODE_ENV: "development" }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionWriteRefused);
      assert.equal((error as ProductionWriteRefused).name, "ProductionWriteRefused");
      assert.match((error as Error).message, /a reaction/);
      assert.match((error as Error).message, /WTP_DB_ROLE=local/);
      assert.equal((error as ProductionWriteRefused).context.allowed, false);
      return true;
    },
  );
});

test("assertWriteAllowed is silent when the pairing is legitimate", () => {
  assert.doesNotThrow(() => assertWriteAllowed("a reaction", { NODE_ENV: "production" }));
  assert.doesNotThrow(() =>
    assertWriteAllowed("a reaction", { NODE_ENV: "development", WTP_DB_ROLE: "local" }),
  );
});

test("the refusal explains itself in words a person can act on", () => {
  const context = describeWriteContext({ NODE_ENV: "development" });
  assert.match(context.reason, /NODE_ENV/);
  assert.match(context.reason, /WTP_DB_ROLE/);
});

/*
  The coverage half. The guard is only worth anything if EVERY write path calls
  it — a new table added next month with no assert is the defect returning
  under a different name. So this reads the source and requires the call,
  rather than trusting that the three known paths stay the only three.
*/
test("every database write path asserts the guard", () => {
  const writePaths = [
    "lib/db/search-log.ts",
    "lib/db/reactions.ts",
    "lib/db/intake-limiter.ts",
    "lib/db/feedback.ts",
    // Prompt D item 6.2: the alarm is a write like any other, and the rule it
    // exists to protect does not exempt it from the rule beside it.
    "lib/db/write-alarm.ts",
    // The questionnaire store (2026-08-23, NH104). A candidate's answer is
    // published civic content rather than reader data, which changes which
    // STORE it lands in and changes nothing about the guard: a write to
    // production from a non-production runtime is refused here exactly as it
    // is everywhere else.
    "lib/db/questionnaire.ts",
  ];
  for (const path of writePaths) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      /assertWriteAllowed\(/,
      `${path} performs writes and must call assertWriteAllowed`,
    );
  }
});

test("no write path outside the guarded set has appeared", () => {
  // Catches the real regression: someone adds lib/db/subscriptions.ts with an
  // .insert() and no guard. Scanning lib/db keeps the list honest instead of
  // letting the test above pass against a stale set.
  const guarded = new Set([
    "search-log.ts",
    "reactions.ts",
    "intake-limiter.ts",
    "feedback.ts",
    "write-alarm.ts",
    "questionnaire.ts",
  ]);
  const unguarded: string[] = [];
  for (const name of readdirSync("lib/db")) {
    if (!name.endsWith(".ts") || guarded.has(name)) continue;
    const source = readFileSync(`lib/db/${name}`, "utf8");
    // `.delete(` and `.update(` also appear on Map and crypto Hash, so the
    // match is anchored on drizzle's builder entry points only.
    if (/\.insert\(|getDb\(\)\s*\n?\s*\.(delete|update)\(/.test(source)) {
      if (!/assertWriteAllowed\(/.test(source)) unguarded.push(name);
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `these lib/db modules write without calling assertWriteAllowed: ${unguarded.join(", ")}`,
  );
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

test("g13/PDC: a correctly scoped purge sanction still requires the admitted standing runtime", () => {
  const context = describeWriteContext(sanctionedEnv(), PURGE);
  assert.equal(context.allowed, true, context.reason);
  assert.equal(context.sanction, "intake-limiter-purge");
  // The runtime has not been reclassified — this is still CI pointed at
  // production, and the context says so. Only the operation was opened.
  assert.equal(context.isProductionRuntime, false);
  assert.equal(context.dbRole, "production");
  assert.throws(() => assertWriteAllowed(PURGE, sanctionedEnv()), RuntimeAuthorityRefused);
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

test("g13: the sanction table is a closed list, and both narrow operations are on it", () => {
  // The table is the audit surface: a reader asking "what may write to
  // production without being production" gets one enumerable answer.
  assert.deepEqual(Object.keys(SANCTIONED_WRITES), [
    "intake-limiter-purge",
    "routine-civic-data-promotion",
  ]);
  assert.equal(SANCTIONED_WRITES["intake-limiter-purge"], PURGE);
  assert.equal(
    SANCTIONED_WRITES["routine-civic-data-promotion"],
    "a routine civic data candidate/version promotion",
  );
  // And it must match the string the purge actually passes, or the sanction
  // opens nothing and the job stays broken while every test here still passes.
  const limiter = readFileSync("lib/db/intake-limiter.ts", "utf8");
  assert.ok(
    limiter.includes(`assertWriteAllowed("${PURGE}")`),
    "purgeExpiredLimiterState no longer asks for the operation the sanction names",
  );
  const routine = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.ok(
    routine.includes('process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion"') &&
      routine.includes('assertWriteAllowed("a routine civic data candidate/version promotion")'),
    "the routine data-plane writer no longer asks for the exact operation its sanction names",
  );
});

test("g13: the standing intake runtime declares exactly what the guard requires", () => {
  const runtime = readFileSync("scripts/intake-tripwire.mts", "utf8");
  assert.match(runtime, /resolveProductionWriteHandle\(\)/);
  assert.match(runtime, /process\.env\.DATABASE_URL = handle\.connection/);
  assert.match(runtime, /process\.env\.WTP_DB_ROLE = "production"/);
  assert.match(runtime, /process\.env\.WTP_SANCTIONED_WRITE = "intake-limiter-purge"/);
  assert.match(runtime, /assertWriteAllowed\("an intake limiter purge"\)/);
  assert.doesNotMatch(runtime, /git\s+(?:add|commit|push)|push-main|docs\/intake-report/);
});

test("g13 audit: GitHub workflows have no production write handle or runtime sanction", () => {
  /*
    Permanent PDC boundary: runtime intake and civic-data writes belong to the
    standing production runner. GitHub holds only software certification and
    post-deploy release verification, both read-only against production.
  */
  const dir = ".github/workflows";
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml")).sort();
  // Both workflows may read production for software-release certification.
  // The post-deploy observer additionally holds one separately named,
  // least-privilege control-plane role that can append/read back the existing
  // software-release outcome log. It cannot write serving data or Git.
  assert.deepEqual(
    workflows,
    ["build-check.yml", "post-deploy-integrity.yml"],
    `GitHub Actions must remain software CI/release infrastructure only: ${workflows.join(", ")}`,
  );

  const withDatabase: string[] = [];
  for (const file of workflows) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    if (/DATABASE_URL/.test(source)) withDatabase.push(file);
  }
  assert.deepEqual(
    withDatabase,
    ["build-check.yml", "post-deploy-integrity.yml"],
    "only software certification and post-deploy release verification may read production",
  );
  for (const file of workflows) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    assert.doesNotMatch(source, /WTP_PRODUCTION_DATABASE_URL_WRITE|WTP_SANCTIONED_WRITE/);
  }

  /*
   * THE READER IS HELD TO READING (2026-08-28).
   *
   * `build-check.yml` runs on every pull request, so a credential in it is
   * reachable by any change. Its early and final database checks must resolve the read-only
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
    [...new Set(databaseNames)].sort(),
    ["WTP_PRODUCTION_DATABASE_URL_READONLY", "WTP_CONTROL_PLANE_DATABASE_URL_READONLY"].sort(),
    "build-check.yml may name only the read-only serving and control-plane variables. " +
      "A write-capable string here is reachable from any change.",
  );
  assert.doesNotMatch(
    buildCheck,
    /WTP_SANCTIONED_WRITE/,
    "build-check.yml must carry no write sanction — its database step exists to ask a question",
  );

  /*
   * THE OBSERVER MAY WRITE ONLY THE RELEASE-OUTCOME PARTITION.
   *
   * `post-deploy-integrity.yml` is the first workflow to hold a database
   * credential AND run unattended on every push to `main`. Serving production
   * remains read-only. Its second role is deliberately named for post-deploy
   * control-plane append/readback and must be provisioned at the database layer
   * with no DDL and no access to any other table.
   */
  const observer = readFileSync(`${dir}/post-deploy-integrity.yml`, "utf8");
  const observerNames = [...observer.matchAll(/[A-Z_]*DATABASE_URL[A-Z_]*/g)].map((m) => m[0]);
  assert.ok(observerNames.length > 0, "the observer found no database variable to check at all");
  assert.deepEqual(
    [...new Set(observerNames)],
    ["WTP_CONTROL_PLANE_DATABASE_URL_READONLY", "WTP_PRODUCTION_DATABASE_URL_READONLY", "WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL"],
    "post-deploy-integrity.yml may read serving production and append only its exact outcome " +
      "through the separately provisioned control-plane role.",
  );
  assert.doesNotMatch(
    observer,
    /WTP_SANCTIONED_WRITE/,
    "post-deploy-integrity.yml must carry no write sanction — the owner's NH273 decision is that " +
      "a red reading marks state DEGRADED and freezes the next release. It never repairs production.",
  );
});
