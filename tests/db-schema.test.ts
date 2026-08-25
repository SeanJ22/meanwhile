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

    const vintage = byName.get("division_vintage");
    assert.ok(vintage, `${name}: carries ocd_id but no division_vintage column`);

    /*
     * THE PAIRING, which is what this rule was always about (D31, g10).
     *
     * It used to be asserted as "both NOT NULL", and that was right while
     * every division identifier was mandatory. `meetings.ocd_id` is now
     * nullable, because a government the Census does not enumerate — Pima
     * Community College's board, an authority, the seven special districts
     * inside Pima County's own agendas — has no division to name, and the
     * two ways to keep the old constraint were to drop those meetings or to
     * mint a canonical identifier for a division that does not exist.
     *
     * So the assertion follows the rule rather than its old spelling: the
     * identifier and its vintage are nullable TOGETHER or not at all, and a
     * table that lets them diverge fails here. Where the pair is nullable,
     * the schema must additionally carry a CHECK so the DATABASE refuses a
     * row with one and not the other — a rule only the application enforces
     * is a rule the next writer skips.
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

/**
 * THE ONE DELIBERATE EXCEPTION, NAMED PER STORE AND PER COLUMN (R41,
 * 2026-08-17, the author's ruling A).
 *
 * `feedback.reply_to` holds a contact detail on purpose: a reader typed it
 * into a field labelled as an optional reply address. The exception is
 * written as an exact allow-list of (store, column) pairs rather than by
 * softening FORBIDDEN_FRAGMENTS, because loosening the fragment list would
 * quietly permit the NEXT contact column anyone adds anywhere. A second entry
 * here is a decision someone has to type out.
 */
const DELIBERATE_IDENTIFIER_COLUMNS = new Set<string>([
  // **A-001, 2026-08-24: this set is now EMPTY, and that is the fix.**
  //
  // It used to hold `feedback.reply_to`. The exception was written carefully — an
  // exact (store, column) pair rather than a softened fragment list, so a
  // second entry would have to be typed out. What no amount of care about the
  // list could do was notice that the value it exempted was an email address,
  // which `questionnaire_invitations.email` also holds. A named exception to a
  // NAME-based sweep is still a name-based sweep.
  //
  // The address moved to `feedback_contact`, which is not a collection store,
  // and the claim is proven over VALUE SPACES in
  // `tests/identity-boundary.test.ts`. If anything is ever added back here, that
  // test is the one that has to be satisfied first.
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
    /*
     * - `coverage_tier` (RULING 6, Prompt B item 8, 2026-08-20) — a five-value
     *   enum describing how deeply this product has researched a PLACE:
     *   TIER_0 through TIER_3, plus UNKNOWN. It is identical for every reader
     *   in that place and changes only when a session does research, so it
     *   carries no per-person value and cannot relate two readers' rows —
     *   the same reasoning as `suspect_reason` directly above. It is on both
     *   sold stores on purpose: a buyer weighting civic-interest signal by
     *   coverage depth needs it on the row, and interest from a Tier 3 zip
     *   with forty candidate cards is not the same measurement as interest
     *   from a Tier 0 zip with none.
     */
    "coverage_tier",
    /*
     * - `coverage_tier_distribution` (Prompt C item 3, 2026-08-20) — the same
     *   fact as `coverage_tier` directly above, counted rather than floored:
     *   how many of that place's governments sit at each of the four tiers,
     *   encoded `T0:24,T1:0,T2:3,T3:0`, or `UNKNOWN`.
     *
     *   It exists because the FLOOR is TIER_0 for 97.88% of zips nationally —
     *   no special district anywhere has resolved territory and nearly every
     *   zip contains one — so as a field on a sold row the floor separates
     *   almost nothing. Four small integers about a PLACE, identical for every
     *   reader in it, changing only when a session does research. It cannot
     *   single anyone out and it cannot relate two readers' rows, exactly as
     *   the tier cannot.
     *
     *   STORED ONLY: it reaches no reader-facing surface, no headline figure
     *   and no national distribution. The floor stays the only tier stated
     *   publicly.
     */
    "coverage_tier_distribution",
  ]);

  /*
   * R41: `reply_to` is deliberately NOT in `allowedShared`. It is the one
   * column in any collection store that could identify a person, so if it
   * ever appears on a second store this loop fails — which is the whole
   * protection. The reader gave one address for one message; a copy of it on
   * the search log or the reactions table would make the two joinable and
   * would break the n-stores rule outright.
   */
  assert.ok(
    !allowedShared.has("reply_to"),
    "reply_to may never be an allowed shared column — it is the one identifying column that exists",
  );

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
      "contact_ref",
      "id",
      "message",
      "received_at",
      "run_class",
      "run_id",
      "surface",
      "suspect_reason",
    ],
    "the feedback store holds the message, when, where from, an opaque contact handle, and nothing else",
  );
});

/**
 * **A-001 · REWRITTEN, 2026-08-24.** This test used to be called *the optional
 * reply address exists on the feedback store and nowhere else*, and it passed
 * for a year while the schema falsified the constitutional claim.
 *
 * Its reasoning was the R41 note's: a column that may identify a person is
 * pinned to ONE table, so no later store can grow a copy and become joinable.
 * Being on one table was never the test. `questionnaire_invitations.email`
 * held the same KIND of value under a different name, and this guard — like
 * the fragment list above it — was looking for a spelling.
 *
 * The address is no longer in a reader collection store at all.
 * `tests/identity-boundary.test.ts` is where the claim is now proven, over
 * value spaces rather than names; this holds the mechanism in place.
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
