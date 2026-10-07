import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { writeReaction } from "../lib/db/reactions.ts";
import { rowsEligibleForAggregation } from "../lib/signal/aggregate.ts";
import { reactions, searchLog } from "../lib/db/schema.ts";

const ROOT = join(import.meta.dirname, "..");

test("a reaction write without a declaration FAILS rather than defaulting", async () => {
  // Unreachable database: the refusal must happen before any insert.
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
          // marker omitted; the type forbids it, this checks the runtime guard.
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

test("only ORGANIC rows reach an aggregate, and absence is not organic", () => {
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
    { ...base, targetId: "house:119-2:287" },
    { ...base, targetId: "house:119-2:288", runClass: null },
  ];

  const eligible = rowsEligibleForAggregation(rows);
  assert.equal(eligible.length, 1, "exactly one of these six rows is a reader");
  assert.equal(eligible[0].targetId, "house:119-2:283");

  // Allowlist: an unknown class is excluded.
  const invented = rowsEligibleForAggregation([
    { ...base, runClass: "SOME_CLASS_NOBODY_HAS_WRITTEN_YET" },
  ]);
  assert.deepEqual(invented, [], "an unrecognised class must be excluded, not counted");
});

test("a quarantined row is still excluded, class notwithstanding", () => {
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

test("an overwrite can lower a row out of the sold pool and never raise one in", () => {
  // The rule lives in SQL, so this reads the statement.
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
  assert.ok(
    !/set:\s*\{[\s\S]*?runClass:\s*row\.marker\.runClass/.test(source),
    "an unconditional runClass on the upsert would let a write launder its own row",
  );
});

test("the column's shape matches the search log's, so one word means one thing", () => {
  const reactionCols = Object.keys(reactions);
  const searchCols = Object.keys(searchLog);
  for (const col of ["runClass", "runId"]) {
    assert.ok(reactionCols.includes(col), `reactions is missing ${col}`);
    assert.ok(searchCols.includes(col), `search_log is missing ${col}`);
  }
});

test("run_id relates a robot to its run and joins nothing", () => {
  const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
  assert.ok(
    !/run_?[iI]d[\s\S]{0,200}references\(/.test(schema),
    "run_id must carry no foreign key",
  );
  const source = readFileSync(join(ROOT, "lib", "db", "reactions.ts"), "utf8");
  assert.match(
    source,
    /runClass === "ORGANIC" \|\| !row\.marker\.runId\s*\r?\n?\s*\? null/,
    "a reader's row must never carry a run id",
  );
  assert.match(source, /: hashRunId\(row\.marker\.runId\)/);
});
