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

/**
 * The n-stores rule (CLAUDE.md): the collection stores — search log,
 * reactions, and the future subscription store — never join. No shared
 * identifying key, no foreign keys across them, and the reaction continuity
 * key exists on the reactions table only.
 */
const COLLECTION_STORES = ["searchLog", "reactions", "feedback"] as const;

test("every collection store is identifier-free and joins nothing", () => {
  for (const storeName of COLLECTION_STORES) {
    const table = (schema as Record<string, unknown>)[storeName];
    assert.ok(table, `collection store ${storeName} missing from the schema`);
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);

    for (const column of config.columns) {
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        assert.ok(
          !column.name.toLowerCase().includes(fragment),
          `${storeName}.${column.name} matches forbidden fragment "${fragment}"`,
        );
      }
    }
    assert.equal(
      config.foreignKeys.length,
      0,
      `${storeName} must not reference any other table — the stores never join`,
    );
  }
});

test("the collection stores share no joinable column", () => {
  const columnsOf = (table: unknown) =>
    new Set(
      getTableConfig(table as Parameters<typeof getTableConfig>[0]).columns.map(
        (c) => c.name,
      ),
    );

  /*
   * Context columns that carry no per-person value and cannot join rows:
   *
   * - `id` — a random uuid primary key, different in every store.
   * - `occurred_at` / `received_at` — timestamps.
   * - `ocd_ids` / `division_vintage` — the division context, identical for
   *   every reader looking at the same place.
   * - `run_class` / `run_id` (R40, 2026-08-17) — the C05 declaration. It is
   *   NULL on every ORGANIC row by construction, so it can never relate two
   *   readers' rows; on a synthetic row it relates a ROBOT's rows to the
   *   robot, which is the whole point of the column and the opposite of the
   *   thing this test exists to stop.
   * - `suspect_reason` — a two-value quarantine enum. A column that can hold
   *   "VELOCITY" cannot single anyone out.
   */
  const allowedShared = new Set([
    "id",
    "occurred_at",
    "received_at",
    "ocd_ids",
    "division_vintage",
    "run_class",
    "run_id",
    "suspect_reason",
  ]);

  // EVERY PAIR, not one pair. Three stores make three pairs, and a fourth
  // store would make six — a hand-written pair was how the check would have
  // silently stopped covering the new one.
  for (let i = 0; i < COLLECTION_STORES.length; i++) {
    for (let j = i + 1; j < COLLECTION_STORES.length; j++) {
      const [a, b] = [COLLECTION_STORES[i], COLLECTION_STORES[j]];
      const aCols = columnsOf((schema as Record<string, unknown>)[a]);
      const bCols = columnsOf((schema as Record<string, unknown>)[b]);
      for (const name of aCols) {
        if (!bCols.has(name)) continue;
        assert.ok(
          allowedShared.has(name),
          `${a} and ${b} share column "${name}" — the stores must not be joinable`,
        );
      }
    }
  }
});

test("the feedback store holds no continuity key of any kind", () => {
  // Reactions need one (an answer can be changed); feedback has nothing to
  // change, so there is no reason for a key — and where there is no reason
  // there is no key. This is the difference stated as a schema property.
  const config = getTableConfig(schema.feedback);
  const names = config.columns.map((c) => c.name);
  assert.deepEqual(names.filter((n) => /key|hash|digest/.test(n)), []);
  assert.deepEqual(
    names.sort(),
    [
      "id",
      "message",
      "received_at",
      "run_class",
      "run_id",
      "surface",
      "suspect_reason",
    ],
    "the feedback store holds the message, when, where from, and nothing else",
  );
});

test("the reaction continuity key exists only on the reactions table", () => {
  for (const [name, table] of tables) {
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    for (const column of config.columns) {
      if (column.name.includes("reaction_key")) {
        assert.equal(
          name,
          "reactions",
          `${name}.${column.name}: the continuity key may exist nowhere but reactions`,
        );
      }
    }
  }
  // The mechanism check: the column does exist where it should.
  const config = getTableConfig(schema.reactions);
  const hash = config.columns.find((c) => c.name === "reaction_key_hash");
  assert.ok(hash, "reactions.reaction_key_hash missing");
  assert.ok(hash.notNull, "reaction_key_hash must be NOT NULL");
});

test("reactions are tier-stamped from the first row", () => {
  const config = getTableConfig(schema.reactions);
  const byName = new Map(config.columns.map((c) => [c.name, c]));
  assert.ok(
    byName.get("verification_tier")?.notNull,
    "verification_tier must be NOT NULL — aggregates are tier-shaped from row one",
  );
  assert.ok(byName.get("ocd_ids")?.notNull, "ocd_ids must be NOT NULL");
  assert.ok(
    byName.get("division_vintage")?.notNull,
    "division_vintage must be NOT NULL",
  );
  // The overwrite contract needs the unique index to upsert against.
  const unique = config.indexes.find(
    (i) => i.config.name === "reactions_key_target_unq" && i.config.unique,
  );
  assert.ok(unique, "reactions needs its unique (key, target) index for overwrite-on-change");
});

test("no table sneaks in a ranking or recommendation column", () => {
  // CLAUDE.md: no candidate or measure record may grow a score/rank/... key.
  // Meetings are not candidates, but the guard is cheap and the failure mode
  // (a 'relevance' column that becomes an ordering) is the same shape.
  // 4a (2026-08-17): "pick" joins the ban — save-my-picks is DEVICE-LOCAL
  // ONLY (wtp.ballot_picks), and no server column may ever be able to hold
  // one. "Saved on this device only. We never see your picks." is a schema
  // property here, not just a sentence.
  const forbidden = /score|rank|rating|match|fit|grade|alignment|recommend|pick/;
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
  for (const tableName of ["meetings", "agenda_documents", "search_log", "reactions", "intake_limiter", "feedback"]) {
    assert.ok(
      sql.includes(`CREATE TABLE "${tableName}"`),
      `no migration creates "${tableName}"`,
    );
  }
});
