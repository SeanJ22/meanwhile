import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ProductionWriteRefused,
  SANCTIONED_WRITES,
  assertWriteAllowed,
  describeWriteContext,
} from "@/lib/db/write-guard";

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
  const guarded = new Set(["search-log.ts", "reactions.ts", "intake-limiter.ts", "feedback.ts"]);
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

    So: five scheduled workflows, one of which writes to the database. The
    other four commit files to the repository and never open a connection.
    This asserts that split rather than describing it, so a workflow that
    grows a DATABASE_URL later cannot join the class silently.
  */
  const dir = ".github/workflows";
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  assert.equal(workflows.length, 5, `the workflow set changed: ${workflows.join(", ")}`);

  const withDatabase: string[] = [];
  for (const file of workflows) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    if (/DATABASE_URL/.test(source)) withDatabase.push(file);
  }
  assert.deepEqual(
    withDatabase,
    ["intake-tripwire.yml"],
    "a scheduled workflow gained database access — if it writes, it needs its own " +
      "named sanction; if it only reads, say so where it is set",
  );
  assert.match(
    readFileSync(`${dir}/intake-tripwire.yml`, "utf8"),
    /WTP_SANCTIONED_WRITE:/,
    "the one writing workflow lost its sanction",
  );
});
