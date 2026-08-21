import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compareSchemaState, describeSchemaState } from "../lib/db/schema-state.ts";
import { errorCodeOf, errorMessageOf } from "../lib/db/write-alarm.ts";

/**
 * **D73's CLASS, GUARDED** (Prompt D item 6.4, 2026-08-20).
 *
 * The defect: migration 0011 added `coverage_tier` to `search_log` and
 * `reactions`, the code shipped, the migration was never applied, every insert
 * into both sold stores failed for four hours, and the only trace was a
 * `console.error` in a serverless function log this repo cannot read. The site
 * was up. The pages rendered. The walk was green.
 *
 * Two things had to be true for that to be invisible, and both are guarded
 * here: a write to a sold store could fail without raising anywhere reachable,
 * and nothing could be ASKED whether the schema matched.
 *
 * RULING 25 is the constraint on the fix and it is asserted too: the
 * reader-facing catches are unchanged, so no visitor sees any difference.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every route that writes to a sold store. Derived from the source rather than
 * hand-listed — a fourth call site added tomorrow joins this list on its first
 * test run rather than on the day somebody remembers.
 */
function soldStoreWriteRoutes(): string[] {
  const files = execFileSync("git", ["ls-files", "app"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64e6,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.ts$/.test(f));
  return files.filter((f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    return /\b(logSearchEvent|writeReaction)\s*\(/.test(src);
  });
}

test("6.4: every sold-store write path raises on the alarm path", () => {
  const routes = soldStoreWriteRoutes();
  assert.ok(
    routes.length >= 3,
    `only ${routes.length} sold-store write route(s) found — the sweep shrank, ` +
      "and a sweep that stopped looking reports the same thing as a clean tree",
  );

  const silent: string[] = [];
  for (const f of routes) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (!/raiseWriteAlarm\(/.test(src)) silent.push(f);
  }
  assert.deepEqual(
    silent,
    [],
    "a write to a sold store that can fail without raising on the alarm path is " +
      "D73 exactly: the reader still gets their page, the revenue path records " +
      "nothing, and every instrument stays green",
  );
});

test("6.4: the alarm is raised on the SAME catch that swallows, in every route", () => {
  /*
   * The weaker version of the check above passes if `raiseWriteAlarm` appears
   * anywhere in the file. This one asserts it appears inside every catch that
   * handles a sold-store write — the failure mode being an alarm added for one
   * error path while a second path beside it keeps swallowing.
   *
   * Read as source because the alternative is executing route handlers against
   * a database that is deliberately broken, and a test that needs a broken
   * production database to prove a point is a test nobody runs.
   */
  const routes = soldStoreWriteRoutes();
  const offenders: string[] = [];
  for (const f of routes) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // Every catch/`.catch(` that follows the write call in the same file.
    const writeAt = Math.min(
      ...[/\blogSearchEvent\s*\(/, /\bwriteReaction\s*\(/]
        .map((re) => {
          const m = re.exec(src);
          return m ? m.index : Number.POSITIVE_INFINITY;
        })
        .filter((n) => Number.isFinite(n)),
    );
    const after = src.slice(writeAt);
    const catches = [...after.matchAll(/(\}\s*catch\s*(\([^)]*\))?\s*\{|\.catch\(\s*\()/g)];
    assert.ok(catches.length > 0, `${f} writes to a sold store and handles no error at all`);
    // The FIRST handler after the write is the one that swallows it.
    const firstCatch = catches[0]!.index!;
    const body = after.slice(firstCatch, firstCatch + 2000);
    if (!/raiseWriteAlarm\(/.test(body)) offenders.push(f);
  }
  assert.deepEqual(
    offenders,
    [],
    "the alarm must ride on the handler that catches the write, not merely somewhere in the file",
  );
});

test("6.4 / RULING 25: the reader-facing answers on the write paths are unchanged", () => {
  /*
   * Reader-facing behaviour is not degraded to fix an internal problem. These
   * are the exact statuses and bodies that shipped before the alarm existed,
   * pinned so a later edit to the alarm cannot quietly change what a visitor
   * gets.
   */
  const meetings = readFileSync(join(ROOT, "app", "api", "meetings", "route.ts"), "utf8");
  assert.match(
    meetings,
    /console\.error\("search log write failed", error\)/,
    "the search-log failure is still swallowed for the reader — the search answers anyway",
  );

  const reactions = readFileSync(join(ROOT, "app", "api", "reactions", "route.ts"), "utf8");
  assert.match(
    reactions,
    /Response\.json\(\{ error: "could not store the reaction" \}, \{ status: 500 \}\)/,
    "the reaction route still answers 500 with the same body",
  );

  const log = readFileSync(join(ROOT, "app", "api", "log", "route.ts"), "utf8");
  assert.match(
    log,
    /Response\.json\(\{ error: String\(\(error as Error\)\.message\) \}, \{ status: 400 \}\)/,
    "the log route still answers 400 with the same body",
  );
});

test("6.2: the alarm table holds no column that could join to a store", () => {
  /*
   * n-stores-never-join, applied to the protection. The alarm records THAT a
   * write to a named store failed and the database's own words about why —
   * never a zip, a division, a continuity key, a run id, an IP or a foreign
   * key. A protection that violates the rule to enforce it has failed.
   * `tests/db-schema.test.ts` holds the same line against the live schema
   * object; this holds it against the migration a database will actually run.
   */
  const sql = readFileSync(
    join(ROOT, "lib", "db", "migrations", "0015_fast_mojo.sql"),
    "utf8",
  );
  const columns = [...sql.matchAll(/^\t"([a-z_]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(
    columns.sort(),
    ["error_code", "error_message", "id", "raised_at", "store"],
    "the alarm table's columns are exactly these — anything else is a join waiting to happen",
  );
  const FORBIDDEN = [
    "approximate_location",
    "ocd_ids",
    "continuity",
    "run_id",
    "target_id",
    "digest",
    "ip",
  ];
  for (const f of FORBIDDEN) {
    assert.ok(!columns.includes(f), `write_alarm must not carry ${f}`);
  }
});

test("6.2: the alarm records the database's own words, capped", () => {
  const err = Object.assign(new Error('column "coverage_tier" does not exist'), {
    code: "42703",
  });
  assert.equal(errorCodeOf(err), "42703");
  assert.equal(errorMessageOf(err), 'column "coverage_tier" does not exist');

  // A message that could carry a value is truncated, and the truncation is
  // STATED rather than silent — a clipped string that reads as complete is the
  // same defect one layer down.
  const long = Object.assign(new Error("x".repeat(900)), { code: "42703" });
  const capped = errorMessageOf(long)!;
  assert.ok(capped.length < 900, "capped");
  assert.match(capped, /\[truncated\]$/, "the clip says it is a clip");

  // A driver with no code, and an error that is not an Error at all, are both
  // absence — named, never a plausible value.
  assert.equal(errorCodeOf(new Error("no code")), null);
  assert.equal(errorCodeOf({ code: "not-a-sqlstate" }), null);
  assert.equal(errorMessageOf(null), null);
  assert.equal(errorMessageOf({}), null);
});

test("6.1: the schema gate names the missing migration, and never rounds up", () => {
  const journal = [
    { idx: 0, when: 1, tag: "0000_a" },
    { idx: 1, when: 2, tag: "0001_b" },
    { idx: 2, when: 3, tag: "0002_c" },
  ];

  const synced = compareSchemaState(journal, [1, 2, 3]);
  assert.equal(synced.inSync, true);
  assert.equal(synced.codeHead, "0002_c");
  assert.deepEqual(synced.missing, []);

  // D73's exact shape: the code names a column a migration adds, and the
  // migration is not applied.
  const drifted = compareSchemaState(journal, [1, 2]);
  assert.equal(drifted.inSync, false);
  assert.deepEqual(drifted.missing, ["0002_c"], "missing migrations are named BY TAG");
  assert.match(describeSchemaState(drifted), /0002_c/);
  assert.match(describeSchemaState(drifted), /db:apply/, "the summary says what to run");

  // A gap in the middle is not the same as a short tail, and both are named.
  const gap = compareSchemaState(journal, [1, 3]);
  assert.deepEqual(gap.missing, ["0001_b"]);

  // A database AHEAD of the code is its own problem and is reported as its
  // own thing — folding it into `missing` would tell somebody to apply a
  // migration that is already there.
  const ahead = compareSchemaState(journal, [1, 2, 3, 99]);
  assert.deepEqual(ahead.missing, []);
  assert.deepEqual(ahead.unknownApplied, [99]);
  assert.equal(ahead.inSync, false, "ahead is not in sync either");

  // An empty journal has no head, and "unknown" is the named gap rather than
  // a plausible tag.
  assert.equal(compareSchemaState([], []).codeHead, "unknown");
});

test("6.1: the committed journal head matches the newest migration file", () => {
  /*
   * The gate compares the DATABASE against the journal. This compares the
   * journal against the files, so a migration generated and not journalled —
   * or journalled and not committed — cannot make the gate report in-sync
   * about a schema nobody has.
   */
  const journal = JSON.parse(
    readFileSync(join(ROOT, "lib", "db", "migrations", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const files = execFileSync("git", ["ls-files", "lib/db/migrations"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/^lib\/db\/migrations\//, "").replace(/\.sql$/, ""))
    .sort();
  const tags = journal.entries.map((e) => e.tag).sort();
  assert.deepEqual(
    tags,
    files,
    "every journalled migration has a file and every file is journalled",
  );
});
