import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { writeReaction } from "../lib/db/reactions.ts";
import { rowsEligibleForAggregation } from "../lib/signal/aggregate.ts";
import { reactions, searchLog } from "../lib/db/schema.ts";

/**
 * F01-continued session 2, item 0D (2026-08-19) — **the table that could not
 * say whose traffic it was.**
 *
 * `search_log` has carried `run_class` / `run_id` since C05. `reactions`
 * carried neither, so for three days the product could say which SEARCHES
 * were ours and could not say which REACTIONS were. That is exactly the wrong
 * way round: a search-log row is a lookup, and a reactions row is **the thing
 * the business sells**. The entire claim a buyer pays for is that synthetic
 * traffic is separable from real traffic, and this table could not make it —
 * its only attribution was a timestamp and a key hash.
 *
 * Three properties, and losing any one of them puts our own robots back into
 * a number somebody is paying for.
 */

const ROOT = join(import.meta.dirname, "..");

test("0D: a reaction write without a declaration FAILS rather than defaulting", async () => {
  // The database is deliberately absent, so this proves the refusal happens
  // BEFORE any insert is attempted — a refusal that only fires when a
  // database is present is a refusal nothing in the suite can see.
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://example.invalid/db";
  try {
    await assert.rejects(
      () =>
        writeReaction({
          targetType: "FEDERAL_VOTE",
          targetId: "house:119-2:283",
          reaction: "YES",
          reactionKey: "0123456789abcdef0123456789abcdef",
          ocdIds: [],
          // marker deliberately omitted, cast through unknown because the
          // TYPE already forbids it — this test is about the runtime half,
          // for the callers TypeScript cannot see (a script, a REPL, a
          // future route written in a hurry).
        } as unknown as Parameters<typeof writeReaction>[0]),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /no run marker/i);
        assert.match(err.message, /must not be sold as a reader/i);
        return true;
      },
      "an undeclared reaction write must throw, never become a reader",
    );
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test("0D: only ORGANIC rows reach an aggregate, and absence is not organic", () => {
  const base = {
    targetType: "FEDERAL_VOTE" as const,
    targetId: "house:119-2:283",
    reaction: "YES" as const,
    ocdIds: ["ocd-division/country:us/state:az"],
    verificationTier: "ANONYMOUS" as const,
  };

  const rows = [
    { ...base, runClass: "ORGANIC" },
    { ...base, targetId: "house:119-2:284", runClass: "SYNTHETIC" },
    { ...base, targetId: "house:119-2:285", runClass: "UNKNOWN" },
    { ...base, targetId: "house:119-2:286", runClass: "AUTHOR" },
    // The column absent entirely — a caller not yet taught to carry it.
    { ...base, targetId: "house:119-2:287" },
    { ...base, targetId: "house:119-2:288", runClass: null },
  ];

  const eligible = rowsEligibleForAggregation(rows);
  assert.equal(eligible.length, 1, "exactly one of these six rows is a reader");
  assert.equal(eligible[0].targetId, "house:119-2:283");

  // Stated as an ALLOWLIST rather than a blocklist: a class invented
  // tomorrow is excluded the moment it exists, not the moment someone
  // remembers it.
  const invented = rowsEligibleForAggregation([
    { ...base, runClass: "SOME_CLASS_NOBODY_HAS_WRITTEN_YET" },
  ]);
  assert.deepEqual(invented, [], "an unrecognised class must be excluded, not counted");
});

test("0D: a quarantined row is still excluded, class notwithstanding", () => {
  // The two filters are independent and both unconditional. An ORGANIC row
  // that tripped an intake limit is still out.
  const eligible = rowsEligibleForAggregation([
    {
      targetType: "FEDERAL_VOTE",
      targetId: "house:119-2:283",
      reaction: "YES",
      ocdIds: ["ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS",
      runClass: "ORGANIC",
      suspectReason: "VELOCITY",
    },
  ]);
  assert.deepEqual(eligible, []);
});

test("0D: an overwrite can lower a row out of the sold pool and never raise one in", () => {
  // The rule lives in SQL, so this reads the statement rather than executing
  // it — the same shape as the existing guards over `verificationTier` and
  // `suspectReason`, which are pinned the same way for the same reason.
  const source = readFileSync(join(ROOT, "lib", "db", "reactions.ts"), "utf8");

  assert.match(
    source,
    /runClass: sql`CASE WHEN \$\{reactions\.runClass\} = 'ORGANIC' THEN/,
    "the upsert must keep a non-ORGANIC class rather than accepting the incoming one",
  );
  assert.match(
    source,
    /runId: sql`CASE WHEN \$\{reactions\.runClass\} = 'ORGANIC' THEN/,
    "the run id must move with the class it belongs to",
  );
  // And it must never take the incoming class unconditionally.
  assert.ok(
    !/set:\s*\{[\s\S]*?runClass:\s*row\.marker\.runClass/.test(source),
    "an unconditional runClass on the upsert would let a write launder its own row",
  );
});

test("0D: the column's shape matches the search log's, so one word means one thing", () => {
  const reactionCols = Object.keys(reactions);
  const searchCols = Object.keys(searchLog);
  for (const col of ["runClass", "runId"]) {
    assert.ok(reactionCols.includes(col), `reactions is missing ${col}`);
    assert.ok(searchCols.includes(col), `search_log is missing ${col}`);
  }
});

/**
 * The n-stores-never-join rule is not weakened by this column, and saying so
 * is not enough — `tests/db-schema.test.ts` owns the general assertion, and
 * this is the specific one for the key just added.
 */
test("0D: run_id relates a robot to its run and joins nothing", () => {
  const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
  // No foreign key anywhere near either column, on either table.
  assert.ok(
    !/run_?[iI]d[\s\S]{0,200}references\(/.test(schema),
    "run_id must carry no foreign key",
  );
  // And the search log's own rule — null on ORGANIC — is restated here in
  // the write path rather than only in a comment.
  const source = readFileSync(join(ROOT, "lib", "db", "reactions.ts"), "utf8");
  assert.match(
    source,
    /runClass === "ORGANIC" \|\| !row\.marker\.runId\s*\r?\n?\s*\? null/,
    "a reader's row must never carry a run id",
  );
  // And what it does carry is the digest, never the raw label — the n-stores
  // rule surviving this column. See `hashRunId`.
  assert.match(source, /: hashRunId\(row\.marker\.runId\)/);
});
