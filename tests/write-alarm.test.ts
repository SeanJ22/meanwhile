import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compareSchemaState, describeSchemaState } from "../lib/db/schema-state.ts";
import { errorCodeOf, errorMessageOf } from "../lib/db/write-alarm.ts";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function soldStoreWriteRoutes(): string[] {
  const files = filesThatWouldBeCommitted({ cwd: ROOT, paths: ["app"] })
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
    routes.length >= 2,
    `only ${routes.length} sold-store write route(s) found — the sweep shrank, ` +
      "and a sweep that stopped looking reports the same thing as a clean tree. " +
      "(PDC-9: the SEARCH write moved off /api/meetings to the /api/log beacon, so " +
      "the sold-store writers are /api/log and /api/reactions.)",
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
    // `async` catch handlers count.
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

test("6.4: the reader-facing answers on the write paths are unchanged", () => {
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

  // A truncated message states its truncation.
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

  // The code names a column a migration adds, and the migration is not applied.
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
  const journal = JSON.parse(
    readFileSync(join(ROOT, "lib", "db", "migrations", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const files = filesThatWouldBeCommitted({ cwd: ROOT, paths: ["lib/db/migrations"] })
    .map((f) => f.trim())
    .filter((f) => /\/\d{4}_[^/]+\.sql$/.test(f))
    .map((f) => f.replace(/^lib\/db\/migrations\//, "").replace(/\.sql$/, ""))
    .sort();
  const tags = journal.entries.map((e) => e.tag).sort();
  assert.deepEqual(
    tags,
    files,
    "every numbered migration is journalled; River numbers step-named lane migrations",
  );
});

test("PD04: no sold-store WRITE is left as a floating promise either", () => {
  // A write qualifies if it is awaited, or is the body of an `after()` that opens before it.
  const routes = soldStoreWriteRoutes();
  assert.ok(routes.length >= 2, `only ${routes.length} sold-store write route(s) found (PDC-9: SEARCH moved to the /api/log beacon)`);

  const floating: string[] = [];
  for (const f of routes) {
    // Comments are stripped so a quoted dead call is not read as a call site.
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
        // `after()` itself, or `lib/log/after-response.ts`, which runs the work when there is no request scope.
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
  // `DrizzleQueryError` carries no `code` and its message is the statement; the reason is on `cause`.
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

test("NH32: the code is found under sourceError, not only under cause", () => {
  // Pooled drivers nest the real error under names other than `cause`.
  const inner = Object.assign(new Error('column "coverage_tier" does not exist'), {
    code: "42703",
  });
  const outer = Object.assign(new Error("Failed query: insert into search_log"), {
    sourceError: inner,
  });
  assert.equal(errorCodeOf(outer), "42703");
});

test("NH32: the code is found under originalError", () => {
  const inner = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
  const outer = Object.assign(new Error("wrapper"), { originalError: inner });
  assert.equal(errorCodeOf(outer), "23505");
});

test("NH32: an AggregateError's real failures are reached", () => {
  /*
   * What a pooled driver raises when every connection in the pool fails. Its
   * own message says nothing; each entry in `errors` is a real database error.
   */
  const real = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });
  const aggregate = Object.assign(new Error("all connections failed"), { errors: [real] });
  assert.equal(errorCodeOf(aggregate), "57P01");
});

test("NH32: a cyclic error chain does not hang the alarm", () => {
  const a = Object.assign(new Error("a"), { cause: undefined as unknown });
  const b = Object.assign(new Error("b"), { cause: a });
  (a as { cause: unknown }).cause = b;
  assert.equal(errorCodeOf(a), null);
  assert.ok(typeof errorMessageOf(a) === "string");
});

test("NH32: a genuinely absent code is still null — the widening did not invent one", () => {
  const outer = Object.assign(new Error("Failed query: insert into search_log"), {
    sourceError: new Error("no code on this one either"),
  });
  assert.equal(errorCodeOf(outer), null);
});

test("NH32: the reader names the gap instead of printing dashes", () => {
  const source = readFileSync(join(ROOT, "scripts", "read-alarms.mts"), "utf8");
  assert.doesNotMatch(
    source.replace(/\/\*[\s\S]*?\*\//g, ""),
    /\?\?\s*"-----"/,
    'a null SQLSTATE must render as a NAMED gap, never as "-----"',
  );
  assert.match(source, /no SQLSTATE/, "the gap says what is missing and whose gap it is");
});
