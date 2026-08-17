import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ProductionWriteRefused,
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
