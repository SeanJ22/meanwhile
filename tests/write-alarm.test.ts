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
    // `async` handlers count. Prompt E made the meetings route's `.catch`
    // async so it could `await` the alarm inside an `after()`, and the
    // narrower pattern read that as "handles no error at all" — a guard
    // reporting a route unguarded because it did not recognise the guard.
    const catches = [
      ...after.matchAll(/(\}\s*catch\s*(\([^)]*\))?\s*\{|\.catch\(\s*(async\s+)?\()/g),
    ];
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

test("6.5: the alarm is not left as an unawaited promise", () => {
  /*
   * **THE DEFECT THE LIVE PROBE FOUND, GUARDED** (Prompt D item 6.5,
   * 2026-08-20).
   *
   * The first version of the alarm fired as `void raiseWriteAlarm(...)` and
   * returned on the next line. Every test passed, every route compiled, and on
   * the live deploy NOTHING LANDED: a serverless invocation ends when the
   * response is returned, and a promise still in flight is dropped. The alarm
   * built to catch a silent failure failed silently.
   *
   * So a bare `void raiseWriteAlarm` is banned. Either the handler AWAITS it —
   * safe, because it never throws, and the reader is already receiving an
   * error on that branch — or it is scheduled through `after()`, which is the
   * platform's own primitive for work that outlives the response.
   */
  for (const f of soldStoreWriteRoutes()) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(
      !src.includes("void raiseWriteAlarm("),
      `${f} fires the alarm without awaiting it — a promise in flight when the ` +
        "response returns is dropped by the runtime, which is how an alarm " +
        "for a silent failure fails silently",
    );
    assert.ok(
      src.includes("await raiseWriteAlarm(") || src.includes("=> raiseWriteAlarm("),
      `${f} must either await the alarm or schedule it with after()`,
    );
  }
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

test("6.2: the alarm carries the reason and NEVER the values", () => {
  /*
   * **THE ALARM'S FIRST REAL FIRING CAUGHT THIS** (2026-08-20, the Prompt D
   * close-out walk). One search_log insert failed transiently out of 94, the
   * alarm fired exactly as designed, and the row it wrote carried a reader's
   * zip and the divisions their search had resolved to — because the Neon
   * driver wraps a failure as the QUERY plus its PARAMS.
   *
   * The alarm's whole design is that it holds nothing about who was writing,
   * and a column guard cannot see a value smuggled inside a text field it
   * permits. So the shape is guarded there and the CONTENT is guarded here.
   */
  const real = new Error(
    'Failed query: insert into "search_log" ("id", "occurred_at", "approximate_location", ' +
      '"ocd_ids") values (default, $1, $2, $3) params: 2026-08-21T00:20:53.025Z,SEARCH,03255,' +
      '["ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district"]',
  );
  const kept = errorMessageOf(real)!;
  assert.ok(!kept.includes("params:"), "everything from params: onward is values and goes");
  assert.ok(!kept.includes("03255"), "no zip survives");
  assert.ok(!kept.includes("ocd-division/"), "no division id survives");
  assert.ok(kept.includes("search_log"), "the table it failed on is kept — that is the reason");

  // A driver that formats its values some other way is caught by the second
  // line. Neither of these tokens belongs to a reason-for-failure sentence.
  const loose = new Error('insert failed for 85701 at ocd-division/country:us/state:az/place:tucson');
  const scrubbed = errorMessageOf(loose)!;
  assert.ok(!scrubbed.includes("85701"), "a bare five-digit run is scrubbed");
  assert.ok(!scrubbed.includes("ocd-division/country"), "a bare division id is scrubbed");

  // And the sentence worth keeping is untouched by any of it. This is the one
  // that would have closed D73 in a minute.
  assert.equal(
    errorMessageOf(new Error('column "coverage_tier" does not exist')),
    'column "coverage_tier" does not exist',
  );
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

/* ========================================================================== */
/* PD04 (Prompt E item 4, 2026-08-20) — the write itself, and the error chain */
/* ========================================================================== */

test("PD04: no sold-store WRITE is left as a floating promise either", () => {
  /*
   * **THE CLASS, NOT THE INSTANCE.**
   *
   * Prompt D banned a floating `raiseWriteAlarm` because a promise still in
   * flight when a serverless invocation returns is dropped by the runtime. The
   * INSERT it was watching had exactly the same shape, in the same function,
   * five lines further up: `logSearchEvent({…}).catch(…)` with nothing awaiting
   * it and `return Response.json(…)` immediately below. Every row that had not
   * reached Neon by the time the response went out was dropped — silently, and
   * with no alarm, because a dropped promise never rejects and there is nothing
   * for a `.catch` to catch.
   *
   * That is `PD04`: the alarm could only ever see the writes that got far
   * enough to be REFUSED. So the ban is widened from the alarm to the write.
   *
   * A write qualifies if it is `await`ed, or if it is the body of an `after()`.
   * The `after(` test is deliberately positional — the call must open before
   * the write does — because `after()` somewhere else in the file proves
   * nothing about this write.
   */
  const routes = soldStoreWriteRoutes();
  assert.ok(routes.length >= 3, `only ${routes.length} sold-store write route(s) found`);

  const floating: string[] = [];
  for (const f of routes) {
    /*
     * Comments out first. This file's own doc block explains the defect and
     * quotes the dead call — `logSearchEvent({…}).catch(…)` — and a sweep that
     * reads its own explanation as a call site reports a defect that is not
     * there. Same trap `tests/no-suppression.test.ts` strips comments for.
     */
    const src = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const call of ["logSearchEvent", "writeReaction"]) {
      const re = new RegExp(`\\b${call}\\s*\\(`, "g");
      for (const m of src.matchAll(re)) {
        const at = m.index!;
        const before = src.slice(Math.max(0, at - 200), at).trimEnd();
        // `import { logSearchEvent }` and the export itself are not call sites.
        if (/import\s*\{[^}]*$/.test(before)) continue;
        const awaited = /\bawait$/.test(before);
        // `after()` itself, or the wrapper that falls back to running the work
        // when there is no request scope to defer into — `lib/log/after-response.ts`,
        // which exists because a bare `after()` throws in every test that calls
        // a route handler directly.
        const deferred = /after(?:Response)?\(\s*(async\s*)?\(\s*\)\s*=>$/.test(before);
        if (!awaited && !deferred) floating.push(`${f} — ${call}()`);
      }
    }
  }
  assert.deepEqual(
    floating,
    [],
    "a sold-store write that is neither awaited nor inside after() is dropped " +
      "by the runtime when the response returns — the loss is silent, and no " +
      "alarm can see it because a dropped promise never rejects",
  );
});

test("PD04: the alarm reads SQLSTATE and the reason from the CAUSE, not the wrapper", () => {
  /*
   * **THE INSTRUMENT DEFECT, PROVED FROM THE DRIVER'S OWN SOURCE.**
   *
   * `drizzle-orm/errors.js` — read, not assumed — defines `DrizzleQueryError`
   * as four assignments: a message of `Failed query: <sql>\nparams: <params>`,
   * `this.query`, `this.params`, and `this.cause`. It carries no `code`.
   *
   * So an alarm that reads `.code` off the object it is handed records `null`
   * for EVERY query failure, structurally — not because the database withheld
   * a SQLSTATE, but because it was asked the wrong object. And an alarm that
   * reads `.message` off that object records the STATEMENT where the reason
   * should be. `PD04`'s one row read exactly that: no code, and the SQL.
   *
   * The fixture below is the real shape, not a mock of a convenient one.
   */
  const driverError = Object.assign(
    new Error(`column "coverage_tier" does not exist`),
    { code: "42703" },
  );
  const wrapped = Object.assign(
    new Error(
      'Failed query: insert into "search_log" ("id", "occurred_at") values (default, $1)\n' +
        "params: 2026-08-21T00:20:53.025Z,03255",
    ),
    { cause: driverError },
  );

  assert.equal(
    errorCodeOf(wrapped),
    "42703",
    "the SQLSTATE is one link down .cause and the alarm has to walk to it",
  );

  const message = errorMessageOf(wrapped)!;
  assert.match(
    message,
    /column "coverage_tier" does not exist/,
    "the database's own sentence survives — it is the whole value of the row",
  );
  assert.ok(
    message.indexOf("does not exist") < message.indexOf("Failed query"),
    "the reason reads first; the statement is context behind it",
  );

  // And the scrub still applies to every link, not only the outermost one.
  assert.ok(!message.includes("03255"), "no value from the params reaches the row");
  assert.ok(!message.includes("params:"), "everything from params: onward is cut");
});

test("PD04: the chain walk terminates on a cycle and on a bare error", () => {
  /*
   * An alarm that hangs takes down the path it is watching, so the walk is
   * depth-capped and cycle-safe. A `cause` pointing back at its own wrapper is
   * not hypothetical — it is what a re-thrown error can produce.
   */
  const a: { message: string; cause?: unknown } = { message: "outer" };
  const b: { message: string; cause?: unknown } = { message: "inner", cause: a };
  a.cause = b;
  const walked = errorMessageOf(a)!;
  assert.match(walked, /outer/);
  assert.match(walked, /inner/);

  assert.equal(errorCodeOf(new Error("no code anywhere")), null);
  assert.equal(errorMessageOf(null), null);
  assert.equal(errorMessageOf(new Error("plain")), "plain");
});
