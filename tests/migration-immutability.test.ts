/**
 * **AN ESTABLISHED MIGRATION IS IMMUTABLE — AND THE GUARD IS SHOWN CATCHING IT.**
 * (2026-08-28, the audit of the shipping gate written the same day.)
 *
 * ## The hole, and what was searched for before anything was built
 *
 * `migrationTagsIn` recognises that a migration file CHANGED and cannot tell
 * which way, so a rewrite of an already-applied `0021_mixed_red_ghost.sql` and
 * a brand-new `0023_...sql` reach the shipping gate as the same string.
 *
 * **There was no existing mechanism to reuse.** Drizzle's `meta/_journal.json`
 * is version 7 here and its entries carry `idx`, `version`, `when`, `tag` and
 * `breakpoints` — no hash and no checksum — and that absence is ASSERTED below
 * rather than described, so a future Drizzle format that adds one is noticed.
 * The only content anchor anywhere is
 * `drizzle.__drizzle_migrations.hash`, which `scripts/apply-migrations.mts`
 * writes on every apply and which `lib/db/applied-migrations.ts` has never read
 * back; `checksumViolations` is that comparison, tested here against fixtures.
 *
 * ## THE FOUR REGRESSIONS RUN THE REAL GATE, ON REAL GIT OUTPUT
 *
 * Not the evaluator with a hand-written change list — `scripts/db-shipping-gate.mts`
 * itself, spawned as a process, in a throwaway git repository holding a
 * miniature `lib/db/migrations/` tree. The four scenarios are the four things a
 * person actually does to a migration: REWRITE it, DELETE it, RENAME it, and
 * APPEND a new one. Three must exit 1 naming the file; the fourth must pass,
 * because a guard that refuses ordinary work gets removed.
 *
 * The child's environment has `WTP_PRODUCTION_DATABASE_URL_READONLY` REMOVED.
 * That is not tidiness: it makes the exit codes deterministic on a machine that
 * has the credential, and it guarantees the suite opens no connection —
 * `tests/fixtures/` exists because no test in this repository makes a live
 * call.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appliedHashesFrom,
  checksumViolations,
  CORRECTION_IS_A_NEW_MIGRATION,
  evaluateMigrationImmutability,
  JOURNAL_PATH,
  MIGRATION_SQL_PATH,
  parseNameStatus,
  parsePorcelain,
  type ChangedEntry,
} from "../lib/db/migration-immutability.ts";
import { readJournal, type JournalEntry } from "../lib/db/schema-state.ts";

const ROOT = process.cwd();
const GATE = join(ROOT, "scripts", "db-shipping-gate.mts");
const MIGRATIONS = join(ROOT, "lib", "db", "migrations");

/* ========================================================================== */
/* 0. THE ABSENCE THAT MADE THIS NECESSARY                                    */
/* ========================================================================== */

test("Drizzle's committed journal carries NO hash — the absence is asserted, not assumed", () => {
  /*
   * RULING 110: an instrument that cannot find what it was written for reports
   * green about nothing. If Drizzle ever starts writing a digest into the
   * journal, THAT is the mechanism to reuse and this module becomes a
   * duplicate — so the absence is pinned rather than remembered.
   */
  const raw = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
    version: string;
    entries: Record<string, unknown>[];
  };
  assert.ok(raw.entries.length >= 20, `the journal reader found only ${raw.entries.length} entries`);
  const fields = [...new Set(raw.entries.flatMap((e) => Object.keys(e)))].sort();
  assert.deepEqual(
    fields,
    ["breakpoints", "idx", "tag", "version", "when"],
    `journal entry fields changed: ${fields.join(", ")}. If one of them is now a digest, ` +
      "lib/db/migration-immutability.ts must READ IT rather than carry its own guard.",
  );
  for (const field of fields) {
    assert.ok(
      !/hash|checksum|digest|sha/i.test(field),
      `the journal now carries ${field} — reuse it instead of the git guard`,
    );
  }
});

test("the applier's sha256 is read back — the content anchor, wired end to end", () => {
  /*
   * **THIS TEST USED TO PIN THE GAP. IT NOW PINS THE JOIN.**
   *
   * The gap was one column in one SELECT. `apply-migrations.mts` computed
   * sha256 of each file's raw bytes and wrote it to
   * `drizzle.__drizzle_migrations.hash`; `applied-migrations.ts` asked for
   * `created_at` alone. So the strongest evidence in the system — the only
   * record of what production ACTUALLY executed — was written on every apply
   * and read by nothing, and the git guard was the whole of the immutability
   * check.
   *
   * That mattered because the two guards fail in opposite directions. The git
   * guard sees every rewrite from now on and cannot see one that landed
   * BEFORE it existed. The checksum sees a disagreement between committed SQL
   * and executed SQL whenever it happened, and cannot see a rewrite of a
   * migration production never applied. Neither is redundant with the other,
   * which is why closing this was worth a production read-path change.
   *
   * The column was never in doubt: the applier CREATEs the table with
   * `hash text NOT NULL` and has itself run `SELECT hash, created_at` against
   * production since the 2026-08-28 drift incident.
   */
  const applier = readFileSync(join(ROOT, "scripts", "apply-migrations.mts"), "utf8");
  assert.match(
    applier,
    /createHash\("sha256"\)/,
    "the applier no longer hashes the migration file — checksumViolations has nothing to compare",
  );
  assert.match(applier, /INSERT INTO drizzle\.__drizzle_migrations \(hash, created_at\)/);

  const reader = readFileSync(join(ROOT, "lib", "db", "applied-migrations.ts"), "utf8");
  // `[\s\S]` rather than the `s` flag: tsconfig targets below es2018, where the
  // flag is a compile error rather than a runtime one — it would pass the suite
  // on this machine and fail `tsc --noEmit` on the fresh-checkout gate.
  assert.ok(
    new RegExp(
      `SELECT[\\s\\S]*?\\bhash\\b[\\s\\S]*?\\bFROM\\s+drizzle\\.__drizzle_migrations\\b`,
      "i",
    ).test(reader),
    "lib/db/applied-migrations.ts must SELECT `hash` — without it the content cross-check is dark",
  );
  assert.ok(
    /appliedHashes/.test(reader),
    "the reader selects `hash` and must return it as `appliedHashes`, or the gate cannot feed " +
      "checksumViolations and the column is being read for nothing",
  );

  // The absence is still reported rather than invented — a caller handed a
  // read from BEFORE this wiring must get `null`, never an empty agreement.
  assert.equal(
    appliedHashesFrom({ ok: true, appliedWhen: [1, 2, 3] }),
    null,
    "appliedHashesFrom must report the absence rather than inventing an empty agreement",
  );

  // And the live shape flows through.
  assert.deepEqual(
    appliedHashesFrom({
      ok: true,
      appliedWhen: [1756000000000],
      appliedHashes: [{ when: 1756000000000, hash: "a".repeat(64) }],
    }),
    [{ when: 1756000000000, hash: "a".repeat(64) }],
    "a read carrying appliedHashes must reach checksumViolations intact",
  );
});

/* ========================================================================== */
/* 1. THE FOUR REGRESSIONS, THROUGH THE REAL GATE, ON REAL GIT OUTPUT         */
/* ========================================================================== */

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
}

interface Scratch {
  readonly dir: string;
  readonly base: string;
}

/** A throwaway repository holding a miniature `lib/db/migrations/` tree. */
function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "wtp-migration-immutability-"));
  git(dir, ["init", "--quiet"]);
  git(dir, ["config", "user.email", "gate@example.invalid"]);
  git(dir, ["config", "user.name", "schema gate test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  const meta = join(dir, "lib", "db", "migrations", "meta");
  mkdirSync(meta, { recursive: true });
  const entries: JournalEntry[] = [
    { idx: 0, when: 1_780_000_000_000, tag: "0000_alpha" },
    { idx: 1, when: 1_780_000_000_001, tag: "0001_beta" },
  ];
  for (const entry of entries) {
    writeFileSync(
      join(dir, "lib", "db", "migrations", `${entry.tag}.sql`),
      `CREATE TABLE "${entry.tag}" ("id" uuid PRIMARY KEY NOT NULL);\n`,
    );
    writeFileSync(
      join(meta, `${String(entry.idx).padStart(4, "0")}_snapshot.json`),
      `${JSON.stringify({ id: entry.tag, tables: {} }, null, 2)}\n`,
    );
  }
  writeJournal(dir, entries);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", "the established migrations"]);
  return { dir, base: git(dir, ["rev-parse", "HEAD"]) };
}

function writeJournal(dir: string, entries: readonly JournalEntry[]): void {
  writeFileSync(
    join(dir, JOURNAL_PATH),
    `${JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: entries.map((e) => ({ ...e, version: "7", breakpoints: true })),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Run the REAL gate in the scratch repository.
 *
 * `--base=` is how the merge base is stated when there is no GitHub event and
 * no `origin/main`; it is the same flag a session uses by hand. The credential
 * is stripped from the child so the exit codes are the guard's own and no
 * connection is possible.
 */
function runGate(dir: string, base: string): { status: number; out: string } {
  const env = { ...process.env };
  delete env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  delete env.WTP_SCHEMA_GATE_SMOKE;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", GATE, `--base=${base}`],
    { cwd: dir, encoding: "utf8", env },
  );
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

test("REGRESSION · a REWRITTEN established migration is REFUSED by the real gate", () => {
  const { dir, base } = scratch();
  try {
    // The exact move: correcting a shipped migration in place. It looks tidy,
    // it reviews cleanly, and the applied-join never notices.
    writeFileSync(
      join(dir, "lib", "db", "migrations", "0001_beta.sql"),
      `CREATE TABLE "0001_beta" ("id" uuid PRIMARY KEY NOT NULL, "corrected" text);\n`,
    );
    git(dir, ["commit", "--quiet", "-a", "-m", "correct 0001 in place"]);

    const nameStatus = git(dir, ["diff", "--name-status", base, "HEAD"]);
    assert.match(nameStatus, /^M\s/m, `the plant did not produce a modification: ${nameStatus}`);

    const { status, out } = runGate(dir, base);
    assert.equal(status, 1, `the gate did not refuse a rewrite:\n${out}`);
    assert.match(out, /\[migration-modified\]/, out);
    assert.match(out, /lib\/db\/migrations\/0001_beta\.sql/, "the refusal must name the file");
    assert.match(out, /NEW migration/, "the refusal must state that correction is a new migration");
    assert.doesNotMatch(out, /HOLDS/, "a refusing run must not also print a holding verdict");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REGRESSION · a DELETED established migration is REFUSED by the real gate", () => {
  const { dir, base } = scratch();
  try {
    // Deleting the file and its journal row — "undoing" a migration. It does
    // not unapply anything; production still ran it.
    git(dir, ["rm", "--quiet", "lib/db/migrations/0001_beta.sql"]);
    git(dir, ["rm", "--quiet", "lib/db/migrations/meta/0001_snapshot.json"]);
    writeJournal(dir, [{ idx: 0, when: 1_780_000_000_000, tag: "0000_alpha" }]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", "drop 0001"]);

    const { status, out } = runGate(dir, base);
    assert.equal(status, 1, `the gate did not refuse a deletion:\n${out}`);
    assert.match(out, /\[migration-deleted\]/, out);
    assert.match(out, /\[snapshot-deleted\]/, "the generated snapshot is held to the same rule");
    assert.match(out, /\[journal-entry-dropped\]/, "the journal is append-only");
    assert.match(out, /0001_beta/, "the refusal must name the migration");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REGRESSION · a RENAMED established migration is REFUSED by the real gate", () => {
  const { dir, base } = scratch();
  try {
    /*
     * The CAREFUL rename — the file moves and the journal is edited to agree,
     * so nothing downstream looks inconsistent. It is still a delete and an add
     * wearing one line: the `when` production applied now names a different
     * tag, and no timestamp-joined check anywhere would say a word.
     */
    git(dir, ["mv", "lib/db/migrations/0001_beta.sql", "lib/db/migrations/0001_beta_v2.sql"]);
    writeJournal(dir, [
      { idx: 0, when: 1_780_000_000_000, tag: "0000_alpha" },
      { idx: 1, when: 1_780_000_000_001, tag: "0001_beta_v2" },
    ]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", "rename 0001"]);

    const nameStatus = git(dir, ["diff", "--name-status", base, "HEAD"]);
    assert.match(nameStatus, /^R\d*\s/m, `git did not report a rename: ${nameStatus}`);

    const { status, out } = runGate(dir, base);
    assert.equal(status, 1, `the gate did not refuse a rename:\n${out}`);
    assert.match(out, /\[migration-renamed\]/, out);
    assert.match(out, /\[journal-entry-rewritten\]/, "the journal edit that hid it is caught too");
    assert.match(out, /0001_beta\.sql/, "the refusal must name the file as the merge base has it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("REGRESSION · a NORMAL APPEND passes — the guard does not refuse ordinary work", () => {
  const { dir, base } = scratch();
  try {
    writeFileSync(
      join(dir, "lib", "db", "migrations", "0002_gamma.sql"),
      `CREATE TABLE "0002_gamma" ("id" uuid PRIMARY KEY NOT NULL);\n`,
    );
    writeFileSync(
      join(dir, "lib", "db", "migrations", "meta", "0002_snapshot.json"),
      `${JSON.stringify({ id: "0002_gamma", tables: {} }, null, 2)}\n`,
    );
    writeJournal(dir, [
      { idx: 0, when: 1_780_000_000_000, tag: "0000_alpha" },
      { idx: 1, when: 1_780_000_000_001, tag: "0001_beta" },
      { idx: 2, when: 1_780_000_000_002, tag: "0002_gamma" },
    ]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", "add 0002"]);

    const { status, out } = runGate(dir, base);
    assert.match(out, /migration immutability HOLDS/, `an ordinary append was refused:\n${out}`);
    assert.doesNotMatch(out, /\[migration-/, out);
    assert.equal(
      status,
      0,
      "a run whose only change is a new migration, with no credential in the environment and " +
        `nothing else touched, must exit 0:\n${out}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ========================================================================== */
/* 2. THE UNREADABLE CASE — never a pass                                      */
/* ========================================================================== */

test("an unreachable merge base is COULD NOT TELL, never a pass", () => {
  const verdict = evaluateMigrationImmutability({
    changes: null,
    baseDescription: "the pull request's base (UNREACHABLE)",
    baseJournal: null,
    headJournal: [{ idx: 0, when: 1, tag: "0000_alpha" }],
    sqlTagsOnDisk: ["0000_alpha"],
  });
  assert.equal(verdict.verdict, "cannot-tell");
  assert.equal(verdict.violations.length, 0, "nothing is concluded about the migrations");
  assert.equal(verdict.cannotTell.length, 2, "both git-backed questions are named as unasked");
  assert.match(verdict.summary, /COULD NOT TELL/);
  for (const gap of verdict.cannotTell) assert.match(gap, /UNKNOWN|not a pass/);
});

test("the gate exits 2 on COULD NOT TELL and 1 on a violation — they are different answers", () => {
  const source = readFileSync(GATE, "utf8");
  const guardAt = source.indexOf("evaluateMigrationImmutability({");
  const credentialAt = source.indexOf("const connection = process.env[VARIABLE]");
  assert.ok(guardAt > 0, "the gate no longer runs the immutability guard at all");
  assert.ok(
    guardAt < credentialAt,
    "the immutability guard must run BEFORE the credential is read — it needs no database, and " +
      "a fork pull request with no secret must still be refused for rewriting a migration",
  );
  assert.match(source, /immutability\.verdict === "fail"[\s\S]{0,600}process\.exit\(1\)/);
  assert.match(source, /immutability\.verdict === "cannot-tell"[\s\S]{0,2400}process\.exit\(2\)/);
  assert.ok(
    !/--skip|SKIP_IMMUTAB|allowRewrite|--force/i.test(source),
    "an escape hatch on a gate is how the gate stops meaning anything",
  );
});

/* ========================================================================== */
/* 3. THE JOURNAL — append-only, and it must match the disk                   */
/* ========================================================================== */

const established: JournalEntry[] = [
  { idx: 0, when: 1_780_000_000_000, tag: "0000_alpha" },
  { idx: 1, when: 1_780_000_000_001, tag: "0001_beta" },
];

function verdictFor(head: JournalEntry[], onDisk: string[], changes: ChangedEntry[] = []) {
  return evaluateMigrationImmutability({
    changes,
    baseDescription: "a fixture merge base",
    baseJournal: established,
    headJournal: head,
    sqlTagsOnDisk: onDisk,
  });
}

test("a RE-TIMESTAMPED journal entry is refused — the join key is `when`", () => {
  const verdict = verdictFor(
    [established[0], { idx: 1, when: 1_780_000_009_999, tag: "0001_beta" }],
    ["0000_alpha", "0001_beta"],
  );
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(
    verdict.violations.map((v) => v.rule),
    ["journal-entry-rewritten"],
  );
  assert.match(verdict.violations[0].what, /THE JOIN KEY IS/);
});

test("a journal entry with no file, and a file with no journal entry, are both caught", () => {
  const missingFile = verdictFor(established, ["0000_alpha"]);
  assert.deepEqual(
    missingFile.violations.map((v) => v.rule),
    ["journal-entry-without-file"],
  );

  const strayFile = verdictFor(established, ["0000_alpha", "0001_beta", "0009_orphan"]);
  assert.deepEqual(
    strayFile.violations.map((v) => v.rule),
    ["file-without-journal-entry"],
  );
  assert.match(strayFile.violations[0].what, /nothing will ever run|invisible rather than pending/);
});

test("THE REPOSITORY ITSELF agrees: every journal entry has a file and every file an entry", () => {
  /*
   * The guard, run against the real tree. This is the half that needs no merge
   * base at all, and it has never been asserted anywhere before now.
   */
  const journal = readJournal();
  const onDisk = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => MIGRATION_SQL_PATH.exec(`lib/db/migrations/${f}`)?.[1])
    .filter((t): t is string => typeof t === "string");
  assert.ok(onDisk.length >= 20, `only ${onDisk.length} migration file(s) found — the sweep saw nothing`);

  const verdict = evaluateMigrationImmutability({
    changes: [],
    baseDescription: "the committed tree",
    baseJournal: journal,
    headJournal: journal,
    sqlTagsOnDisk: onDisk,
  });
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
});

/* ========================================================================== */
/* 4. THE PARSERS — both git vocabularies                                     */
/* ========================================================================== */

test("parseNameStatus reads every status letter, and a rename carries both sides", () => {
  const parsed = parseNameStatus(
    [
      "M\tlib/db/migrations/0001_beta.sql",
      "A\tlib/db/migrations/0002_gamma.sql",
      "D\tlib/db/migrations/0000_alpha.sql",
      "R100\tlib/db/migrations/0003_x.sql\tlib/db/migrations/0003_y.sql",
      "T\tdocs/state.md",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    parsed.map((p) => `${p.status}:${p.from ?? "-"}>${p.path}`),
    [
      "modified:->lib/db/migrations/0001_beta.sql",
      "added:->lib/db/migrations/0002_gamma.sql",
      "deleted:->lib/db/migrations/0000_alpha.sql",
      "renamed:lib/db/migrations/0003_x.sql>lib/db/migrations/0003_y.sql",
      "typechange:->docs/state.md",
    ],
  );
});

test("parsePorcelain sees the WORKING TREE, so a rewrite is caught before it is committed", () => {
  const parsed = parsePorcelain(
    [
      " M lib/db/migrations/0001_beta.sql",
      "?? lib/db/migrations/0002_gamma.sql",
      " D lib/db/migrations/0000_alpha.sql",
      "R  lib/db/migrations/0003_x.sql -> lib/db/migrations/0003_y.sql",
    ].join("\n"),
  );
  assert.deepEqual(parsed.map((p) => p.status), ["modified", "added", "deleted", "renamed"]);

  const verdict = verdictFor(established, ["0000_alpha", "0001_beta"], parsed);
  assert.ok(
    verdict.violations.some((v) => v.rule === "migration-modified"),
    "an uncommitted rewrite must be refused — pnpm gates runs before the commit",
  );
});

test("an unrecognised git status on a migration fails CLOSED", () => {
  const parsed = parseNameStatus("X\tlib/db/migrations/0001_beta.sql");
  assert.equal(parsed[0].status, "unknown");
  const verdict = verdictFor(established, ["0000_alpha", "0001_beta"], parsed);
  assert.equal(verdict.verdict, "fail", "an unrecognised letter must cost a new migration, not the guard");
  assert.equal(verdict.violations[0].rule, "migration-modified");
});

test("a Windows separator does not hide a rewrite", () => {
  // RULING 14 — the separator is BUILT, never written as a literal.
  const BACKSLASH = String.fromCharCode(92);
  const windowsPath = "lib/db/migrations/0001_beta.sql".split("/").join(BACKSLASH);
  const parsed = parseNameStatus(`M\t${windowsPath}`);
  assert.equal(parsed[0].path, "lib/db/migrations/0001_beta.sql");
  const verdict = verdictFor(established, ["0000_alpha", "0001_beta"], parsed);
  assert.equal(verdict.verdict, "fail");
});

/* ========================================================================== */
/* 5. THE CONTENT ANCHOR — ready for the column production already carries    */
/* ========================================================================== */

test("checksumViolations catches SQL that is not the SQL production ran", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const journal = established;
  const applied = [
    { when: established[0].when, hash: sha("alpha as applied") },
    { when: established[1].when, hash: sha("beta as applied") },
  ];

  const agreeing = checksumViolations(journal, applied, (tag) =>
    tag === "0000_alpha" ? sha("alpha as applied") : sha("beta as applied"),
  );
  assert.deepEqual(agreeing, [], "matching content must not be reported");

  const rewritten = checksumViolations(journal, applied, (tag) =>
    tag === "0000_alpha" ? sha("alpha as applied") : sha("beta, quietly corrected"),
  );
  assert.deepEqual(rewritten.map((v) => `${v.rule}:${v.tag}`), ["applied-sql-rewritten:0001_beta"]);
  assert.match(rewritten[0].what, /is NOT the\s+SQL that ran|NOT the/);
  assert.equal(rewritten[0].remedy, CORRECTION_IS_A_NEW_MIGRATION);
});

test("checksumViolations says nothing about a migration production has not applied", () => {
  /*
   * That is the shipping invariant's question, and answering it here in a
   * second vocabulary is how two surfaces start disagreeing about one database.
   */
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const violations = checksumViolations(established, [], () => sha("anything"));
  assert.deepEqual(violations, []);
});

test("appliedHashesFrom reads real rows and refuses malformed ones", () => {
  assert.deepEqual(
    appliedHashesFrom({
      ok: true,
      appliedHashes: [
        { when: 1, hash: "aa" },
        { when: "2", hash: "bb" },
        { when: 3, hash: "" },
        { when: Number.NaN, hash: "cc" },
      ],
    }),
    [
      { when: 1, hash: "aa" },
      { when: 2, hash: "bb" },
    ],
  );
  assert.equal(appliedHashesFrom(null), null);
  assert.equal(appliedHashesFrom({ ok: false, why: "refused" }), null);
});

/* ========================================================================== */
/* 6. THE UNREACHABLE BASE, AT BOTH ENDS — refused where it matters           */
/* ========================================================================== */

/**
 * An unreachable merge base makes DIRECTION unknown, and direction is the whole
 * question. The gate refuses on it — but only where a migration is actually in
 * play, and the difference is a SECOND independently-taken measurement rather
 * than a lowered bar: `changedPaths()` lists deletions on every one of its
 * rungs, so a readable path list with nothing under `lib/db/migrations/` in it
 * is a finding that no migration changed in any direction.
 *
 * Both halves are asserted, because only the pair is meaningful: the narrowing
 * is safe exactly insofar as the refusal still fires.
 */
function withUnreachableBase(paths: string): { status: number; out: string } {
  const { dir } = scratch();
  try {
    const env = { ...process.env };
    delete env.WTP_PRODUCTION_DATABASE_URL_READONLY;
    delete env.WTP_SCHEMA_GATE_SMOKE;
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        GATE,
        // A well-formed object name that is in no repository on earth.
        "--base=0123456789abcdef0123456789abcdef01234567",
        `--paths=${paths}`,
      ],
      { cwd: dir, encoding: "utf8", env },
    );
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an unreachable base REFUSES when the change touches a migration", () => {
  const { status, out } = withUnreachableBase("lib/db/migrations/0001_beta.sql");
  assert.equal(status, 2, `an unreachable base on a schema change must be COULD NOT TELL:\n${out}`);
  assert.match(out, /COULD NOT TELL/);
  assert.match(out, /DOES touch the schema contract/);
  assert.doesNotMatch(out, /immutability HOLDS/, "nothing may be concluded from a base it could not read");
});

test("an unreachable base does NOT refuse a docs-only change — a second reading says why", () => {
  const { status, out } = withUnreachableBase("docs/state.md");
  assert.equal(status, 0, `a docs-only change must not go red on a git hiccup:\n${out}`);
  assert.match(out, /SECOND reading rather than a lowered bar/);
  assert.match(out, /no migration changed in any direction/);
});
