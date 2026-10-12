import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";

/**
 * Structural guarantees asserted on the schema objects themselves, so they hold for every row any future code could
 * write.
 *
 * 1. A division identifier without the dataset vintage it was resolved against is a silent wrong-match waiting for
 *    the next redistricting, so every `ocd_id` travels with a `division_vintage`.
 * 2. The search log is identifier-free: no column that could name a person or a device, and no foreign key.
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

    const vintage = byName.get("division_vintage");
    assert.ok(vintage, `${name}: carries ocd_id but no division_vintage column`);

    /*
     * The identifier and its vintage are nullable together or not at all (a government the Census does not
     * enumerate has no division). Where the pair is nullable, a CHECK makes the database refuse a row with one and
     * not the other.
     */
    if (ocd.notNull) {
      assert.ok(
        vintage.notNull,
        `${name}: ocd_id is NOT NULL, so division_vintage must be too`,
      );
      continue;
    }

    assert.ok(
      !vintage.notNull,
      `${name}: ocd_id is nullable while division_vintage is NOT NULL — ` +
        "a vintage with no identifier states which release an absence came from",
    );
    const checks = config.checks.map((c) => c.name);
    assert.ok(
      checks.some((c) => /vintage/i.test(c)),
      `${name}: a nullable ocd_id/division_vintage pair needs a CHECK binding them; ` +
        `found ${checks.length === 0 ? "no checks" : checks.join(", ")}`,
    );
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
 * Column-name fragments that would mean the search log can be resolved to a person or a device. `zip` is allowed
 * only as approximate_location.
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
 * The collection stores never join: no shared identifying key, no foreign keys across them, and the reaction
 * continuity key exists on the reactions table only.
 */
const COLLECTION_STORES = [
  "searchLog",
  "reactions",
  "feedback",
  "askInteractions",
] as const;

/**
 * Exact (store, column) pairs exempt from the fragment sweep. Empty: identifying values are kept out of collection
 * stores entirely, and `tests/identity-boundary.test.ts` proves it over value spaces.
 */
const DELIBERATE_IDENTIFIER_COLUMNS = new Set<string>([
]);

test("every collection store is identifier-free and joins nothing", () => {
  for (const storeName of COLLECTION_STORES) {
    const table = (schema as Record<string, unknown>)[storeName];
    assert.ok(table, `collection store ${storeName} missing from the schema`);
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);

    for (const column of config.columns) {
      if (DELIBERATE_IDENTIFIER_COLUMNS.has(`${config.name}.${column.name}`)) continue;
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
    new Map(
      getTableConfig(table as Parameters<typeof getTableConfig>[0]).columns.map(
        (c) => [c.name, (c as { enumValues?: string[] }).enumValues ?? null] as const,
      ),
    );

  /*
   * Two enum columns that share a name but whose value sets do not intersect cannot join. Disjointness is checked
   * against the declared values, so it stops being true the moment someone makes it untrue.
   */
  const disjointEnums = (a: string[] | null, b: string[] | null) =>
    a !== null && b !== null && !a.some((v) => b.includes(v));

  /*
   * Context columns that carry no per-person value and cannot join rows: random ids, timestamps, the division
   * context, the run declaration (NULL on every organic row), the quarantine enum, and place-level facts identical for
   * every reader in a place (coverage tier and distribution, the typed ZIP, which is coarser than `ocd_ids`).
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
    "coverage_tier",
    "coverage_tier_distribution",
    "approximate_location",
  ]);

  /* `reply_to` must never be an allowed shared column: a copy on a second store would make the two joinable. */
  assert.ok(
    !allowedShared.has("reply_to"),
    "reply_to may never be an allowed shared column — it is the one identifying column that exists",
  );

  // Every pair, so a new store cannot silently fall outside the check.
  for (let i = 0; i < COLLECTION_STORES.length; i++) {
    for (let j = i + 1; j < COLLECTION_STORES.length; j++) {
      const [a, b] = [COLLECTION_STORES[i], COLLECTION_STORES[j]];
      const aCols = columnsOf((schema as Record<string, unknown>)[a]);
      const bCols = columnsOf((schema as Record<string, unknown>)[b]);
      for (const [name, aEnum] of aCols) {
        if (!bCols.has(name)) continue;
        /* Disjoint value spaces cannot join. */
        if (disjointEnums(aEnum, bCols.get(name) ?? null)) continue;
        assert.ok(
          allowedShared.has(name),
          `${a} and ${b} share column "${name}" — the stores must not be joinable`,
        );
      }
    }
  }
});

test("the feedback store holds no continuity key of any kind", () => {
  // Reactions need one (an answer can be changed); feedback has nothing to change, so it has no key.
  const config = getTableConfig(schema.feedback);
  const names = config.columns.map((c) => c.name);
  assert.deepEqual(names.filter((n) => /key|hash|digest/.test(n)), []);
  assert.deepEqual(
    names.sort(),
    [
      "about", // The card being reported, not a reader.
      "contact_ref",
      "id",
      "message",
      "received_at",
      "record_id", // Public record context, never a continuity key.
      "run_class",
      "run_id",
      "site", // The report origin; no reader identity.
      "surface",
      "suspect_reason",
      "zip", // The card's ZIP, explicitly authorized with the report.
    ],
    "the feedback store holds the report/context, when, where from, and an opaque contact handle",
  );
});

/**
 * A column that may identify a person is not pinned by name: the address lives outside the reader collection stores,
 * and the reader store holds only an opaque handle.
 */
test("A-001 · the reader store holds an opaque handle, and the address is elsewhere", () => {
  for (const [name, table] of tables) {
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    for (const column of config.columns) {
      assert.notEqual(
        column.name,
        "reply_to",
        `${name}.reply_to still exists — the raw address is back in a table`,
      );
      if (column.name === "contact_ref") {
        assert.ok(
          name === "feedback" || name === "feedbackContact",
          `${name}.contact_ref: the handle may exist only on the two tables it joins`,
        );
      }
    }
  }

  const handle = getTableConfig(schema.feedback).columns.find((c) => c.name === "contact_ref");
  assert.ok(handle, "feedback.contact_ref missing");
  assert.equal(
    handle.notNull,
    false,
    "contact_ref must be nullable — blank is the default and blank must submit",
  );

  // The delivery store holds the address, when it arrived, and the handle.
  // Nothing about what was said, where from, or by what kind of run.
  const contact = getTableConfig(schema.feedbackContact);
  assert.deepEqual(
    contact.columns.map((c) => c.name).sort(),
    ["address", "contact_ref", "received_at"],
    "the contact-delivery store grew a column — every one of them is a way to profile somebody",
  );
  assert.equal(
    contact.foreignKeys.length,
    0,
    "the delivery store must reference nothing — the handle is a value, not a constraint",
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
  // No candidate or measure record may grow a score/rank key; a 'relevance' column on meetings would become an
  // ordering the same way.
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
  // A schema change without its generated migration is a deploy that cannot happen.
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
