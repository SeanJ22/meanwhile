import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";

/**
 * Structural guarantees of the persistence schema — asserted on the schema
 * objects themselves, so they hold for every row any future code could
 * write, not just rows a test happened to insert.
 *
 * 1. **The vintage pairing (§0e).** A division identifier without the
 *    dataset vintage it was resolved against is a silent wrong-match
 *    waiting for the next redistricting cycle — it joins successfully and
 *    reports something, which is worse than nothing. Every table that
 *    carries an `ocd_id` must carry a NOT NULL `division_vintage`, and the
 *    identifier itself must be NOT NULL.
 *
 * 2. **The search log is identifier-free (two stores that never join).**
 *    No column that could name a person or a device, and no foreign key to
 *    anything. The table is honest to aggregate and sell only because it
 *    cannot be resolved to anyone; this test is that property in
 *    executable form. When a subscription store lands, this test grows the
 *    complementary assertion (no behavioral columns there, no shared key).
 */

const tables = Object.entries(schema).filter(
  ([, value]) => typeof value === "object" && value !== null && "getSQL" in (value as object),
);

test("the schema exports tables at all — this suite is not vacuous", () => {
  assert.ok(tables.length >= 3, `expected at least 3 tables, found ${tables.length}`);
});

test("every table carrying a division identifier carries a NOT NULL vintage", () => {
  let carriers = 0;
  for (const [name, table] of tables) {
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    const byName = new Map(config.columns.map((c) => [c.name, c]));
    const ocd = byName.get("ocd_id");
    if (!ocd) continue;
    carriers++;

    assert.ok(ocd.notNull, `${name}: ocd_id must be NOT NULL`);
    const vintage = byName.get("division_vintage");
    assert.ok(vintage, `${name}: carries ocd_id but no division_vintage column`);
    assert.ok(vintage.notNull, `${name}: division_vintage must be NOT NULL`);
  }
  // The mechanism check: this test must actually have inspected something.
  assert.ok(carriers >= 2, `expected at least 2 ocd-carrying tables, found ${carriers}`);
});

test("search_log also pairs its division identifiers with a vintage", () => {
  const config = getTableConfig(schema.searchLog);
  const byName = new Map(config.columns.map((c) => [c.name, c]));
  assert.ok(byName.get("ocd_ids")?.notNull, "ocd_ids must be NOT NULL");
  assert.ok(
    byName.get("division_vintage")?.notNull,
    "division_vintage must be NOT NULL",
  );
});

/**
 * Column-name fragments that would mean the search log can be resolved to a
 * person or a device. `session` and `token` cover the survives-the-session
 * key CLAUDE.md forbids; `zip` is allowed only as approximate_location.
 */
const FORBIDDEN_FRAGMENTS = [
  "user",
  "account",
  "email",
  "device",
  "fingerprint",
  "ip_",
  "session",
  "subscriber",
  "token",
  "cookie",
  "phone",
  "address_line",
];

test("the search log carries no identifier of any kind and no foreign keys", () => {
  const config = getTableConfig(schema.searchLog);

  for (const column of config.columns) {
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      assert.ok(
        !column.name.toLowerCase().includes(fragment),
        `search_log.${column.name} matches forbidden fragment "${fragment}" — ` +
          "the log records what was asked and where, never who",
      );
    }
  }

  assert.equal(
    config.foreignKeys.length,
    0,
    "search_log must not reference any other table — the two stores never join",
  );
});

test("no table sneaks in a ranking or recommendation column", () => {
  // CLAUDE.md: no candidate or measure record may grow a score/rank/... key.
  // Meetings are not candidates, but the guard is cheap and the failure mode
  // (a 'relevance' column that becomes an ordering) is the same shape.
  const forbidden = /score|rank|rating|match|fit|grade|alignment|recommend/;
  for (const [name, table] of tables) {
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    for (const column of config.columns) {
      assert.ok(
        !forbidden.test(column.name.toLowerCase()),
        `${name}.${column.name} matches the forbidden ranking vocabulary`,
      );
    }
  }
});

test("a generated migration exists and creates every schema table", () => {
  // db:generate ran and its output is committed — hand-written SQL is the
  // thing the repo rule forbids, and a schema change without its migration
  // is a deploy that cannot happen.
  const dir = join(process.cwd(), "lib", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 1, "no migration files in lib/db/migrations");

  const sql = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  for (const tableName of ["meetings", "agenda_documents", "search_log"]) {
    assert.ok(
      sql.includes(`CREATE TABLE "${tableName}"`),
      `no migration creates "${tableName}"`,
    );
  }
});
