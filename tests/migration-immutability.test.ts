/**
 * An established migration is immutable. `migrationTagsIn` cannot tell which way a migration file changed, so the
 * guard is run here as the real gate (`scripts/db-shipping-gate.mts`), spawned in a throwaway git repository: a
 * rewrite, a delete and a rename must exit 1 naming the file, and an append must pass. The child's environment has
 * `WTP_PRODUCTION_DATABASE_URL_READONLY` removed, so exit codes are deterministic and no connection is opened.
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
  RETRACTED_MIGRATIONS,
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

test("Drizzle's committed journal carries NO hash — the absence is asserted, not assumed", () => {
  // If Drizzle ever writes a digest into the journal, that is the mechanism to reuse, so the absence is pinned.
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
  // The applier writes each file's sha256; the reader must select it back so `checksumViolations` can compare
  // committed SQL with the SQL production executed.
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
 * Run the real gate in the scratch repository, in an environment carrying only what this test put there: the
 * credential and every variable the gate reads, CI event context included, are removed.
 */
function runGate(dir: string, base: string): { status: number; out: string } {
  const env = { ...process.env };
  delete env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  delete env.WTP_SCHEMA_GATE_SMOKE;
  delete env.WTP_SCHEMA_GATE_MOMENT;
  // The CI event context the gate reads to find its base.
  for (const key of Object.keys(env)) if (key.startsWith("GITHUB_")) delete env[key];
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
    // Correcting a shipped migration in place.
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
    // Deleting the file and its journal row does not unapply anything.
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
    // A careful rename, with the journal edited to agree, is still a delete and an add.
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

test("step-named migrations are found, and an established step cannot be rewritten", () => {
  for (const tag of ["STEP3_write_alarm_stores", "STEP-7_reader_location_capture"]) {
    const path = `lib/db/migrations/${tag}.sql`;
    assert.equal(MIGRATION_SQL_PATH.exec(path)?.[1], tag);
    const journal = [{ idx: 0, when: 1, tag }];
    const verdict = evaluateMigrationImmutability({
      changes: parseNameStatus(`M\t${path}`),
      baseDescription: "an established step",
      baseJournal: journal,
      headJournal: journal,
      sqlTagsOnDisk: [tag],
    });
    assert.deepEqual(verdict.violations.map(v => v.rule), ["migration-modified"]);
  }
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

test("parseNameStatus reads every status letter, and a rename carries both sides", () => {
  const parsed = parseNameStatus(
    [
      "M\tlib/db/migrations/0001_beta.sql",
      "A\tlib/db/migrations/0002_gamma.sql",
      "D\tlib/db/migrations/0000_alpha.sql",
      "R100\tlib/db/migrations/0003_x.sql\tlib/db/migrations/0003_y.sql",
      "T\tdocs/DESIGN.md",
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
      "typechange:->docs/DESIGN.md",
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
  // The separator is built, never written as a literal.
  const BACKSLASH = String.fromCharCode(92);
  const windowsPath = "lib/db/migrations/0001_beta.sql".split("/").join(BACKSLASH);
  const parsed = parseNameStatus(`M\t${windowsPath}`);
  assert.equal(parsed[0].path, "lib/db/migrations/0001_beta.sql");
  const verdict = verdictFor(established, ["0000_alpha", "0001_beta"], parsed);
  assert.equal(verdict.verdict, "fail");
});

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
  // That is the shipping invariant's question, not this one.
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

/**
 * An unreachable merge base makes direction unknown, so the gate refuses, but only where a migration is in play: a
 * readable path list with nothing under `lib/db/migrations/` is a second, independent finding. Both halves are asserted.
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
  const { status, out } = withUnreachableBase("docs/DESIGN.md");
  assert.equal(status, 0, `a docs-only change must not go red on a git hiccup:\n${out}`);
  assert.match(out, /SECOND reading rather than a lowered bar/);
  assert.match(out, /no migration changed in any direction/);
});

/* ---- retracted, never-applied migrations (PB-01) ---------------------- */

const PB_RETIRE = { idx: 35, when: 1_790_889_600_001, tag: "0035_pb01_retire_playbooks" };
const PB_SEED = { idx: 36, when: 1_790_889_600_002, tag: "0036_pb01_role_playbooks" };
const withRetracted: JournalEntry[] = [...established, PB_RETIRE, PB_SEED];
const del = (tag: string): ChangedEntry => ({ status: "deleted", path: `lib/db/migrations/${tag}.sql`, from: null, raw: `D\tlib/db/migrations/${tag}.sql` });

function retractionVerdict(head: JournalEntry[], onDisk: string[], changes: ChangedEntry[], base: JournalEntry[] = withRetracted) {
  return evaluateMigrationImmutability({ changes, baseDescription: "a fixture merge base", baseJournal: base, headJournal: head, sqlTagsOnDisk: onDisk });
}

test("the two retracted PB-01 migrations are on the list with their reason, and nothing else is", () => {
  assert.deepEqual(RETRACTED_MIGRATIONS.map((r) => [r.idx, r.tag, r.when]), [[35, PB_RETIRE.tag, PB_RETIRE.when], [36, PB_SEED.tag, PB_SEED.when]]);
  for (const row of RETRACTED_MIGRATIONS) {
    assert.match(row.why, /never applied/i);
    assert.match(row.why, /ends at 0034 as of 2026-10-13/);
    assert.match(row.why, /cp_field_manual_entries/);
  }
});

test("deleting exactly the two retracted files and dropping exactly their journal entries passes", () => {
  const verdict = retractionVerdict(established, ["0000_alpha", "0001_beta"], [del(PB_RETIRE.tag), del(PB_SEED.tag)]);
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
  assert.ok(verdict.checked.some((line) => line.includes(PB_RETIRE.tag) && /retracted/.test(line)));
});

test("a retracted slot may be reused by the next migration", () => {
  const next: JournalEntry = { idx: 35, when: 1_790_900_000_000, tag: "0035_something_new" };
  const verdict = retractionVerdict([...established, next], ["0000_alpha", "0001_beta", "0035_something_new"], [del(PB_RETIRE.tag), del(PB_SEED.tag)]);
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
});

test("the retraction excuses nothing else: another established migration is still refused", () => {
  const verdict = retractionVerdict([established[0], PB_RETIRE, PB_SEED], ["0000_alpha", PB_RETIRE.tag, PB_SEED.tag], [del("0001_beta")]);
  assert.deepEqual(verdict.violations.map((v) => v.rule).sort(), ["journal-entry-dropped", "migration-deleted"]);
  assert.ok(verdict.violations.every((v) => v.tag === "0001_beta"));
});

test("a retracted file that is modified or renamed instead of deleted is still refused", () => {
  const modified: ChangedEntry = { status: "modified", path: `lib/db/migrations/${PB_SEED.tag}.sql`, from: null, raw: "M" };
  const renamed: ChangedEntry = { status: "renamed", path: "lib/db/migrations/0036_renamed.sql", from: `lib/db/migrations/${PB_SEED.tag}.sql`, raw: "R100" };
  assert.deepEqual(retractionVerdict(withRetracted, ["0000_alpha", "0001_beta", PB_RETIRE.tag, PB_SEED.tag], [modified]).violations.map((v) => v.rule), ["migration-modified"]);
  assert.ok(retractionVerdict(withRetracted, ["0000_alpha", "0001_beta", PB_RETIRE.tag, "0036_renamed"], [renamed]).violations.some((v) => v.rule === "migration-renamed"));
});

test("a retracted tag with a different `when` is not the retracted migration", () => {
  const impostor = { ...PB_SEED, when: PB_SEED.when + 5 };
  const verdict = retractionVerdict(established, ["0000_alpha", "0001_beta"], [], [...established, PB_RETIRE, impostor]);
  assert.deepEqual(verdict.violations.map((v) => v.rule), ["journal-entry-dropped"]);
  assert.equal(verdict.violations[0].tag, PB_SEED.tag);
});

test("if a database reports applying a retracted migration, the retraction is refused", () => {
  const violations = checksumViolations(established, [{ when: PB_SEED.when, hash: createHash("sha256").update("anything").digest("hex") }], () => null);
  assert.deepEqual(violations.map((v) => v.rule), ["retracted-migration-applied"]);
  assert.match(violations[0].what, /premise is false/);
  assert.deepEqual(checksumViolations(established, [], () => null), [], "an unapplied retracted migration is fine");
});
