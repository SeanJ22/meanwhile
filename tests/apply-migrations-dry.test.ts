import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { declaredPhase } from "../lib/db/migration-phases.ts";
import { runDbApply } from "../scripts/db-apply.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER = join(ROOT, "tests", "fixtures", "apply-migrations-neon-register.mjs");
const SCRIPT = join(ROOT, "scripts", "apply-migrations.mts");
const SQL_PREFIX = "APPLY_MIGRATIONS_FAKE_SQL ";
const EVENT_PREFIX = "APPLY_MIGRATIONS_FAKE_EVENT ";
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "migration-committed-fixture-"));
after(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));
cpSync(join(ROOT, "lib/db/migrations"), join(FIXTURE_ROOT, "lib/db/migrations"), { recursive: true });
symlinkSync(join(ROOT, "scripts"), join(FIXTURE_ROOT, "scripts"), "dir");
for (const args of [["init", "--quiet"], ["add", "lib/db/migrations"], ["commit", "--quiet", "--no-gpg-sign", "-m", "Migration fixture"]]) {
  const child = spawnSync("git", ["-c", "user.name=Migration test", "-c", "user.email=migration@example.test", ...args],
    { cwd: FIXTURE_ROOT, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
}

interface RunResult {
  status: number | null;
  output: string;
  statements: string[];
  events: unknown[];
}

function run(args: string[], env: Record<string, string> = {}, beforeContract?: string): RunResult {
  const child = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "--import",
      pathToFileURL(REGISTER).href,
      ...(beforeContract === undefined ? [SCRIPT, ...args] : ["--input-type=module", "-e",
        `import { applyMigrations } from ${JSON.stringify(pathToFileURL(SCRIPT).href)}; await applyMigrations(${JSON.stringify(args)}, { beforeContract: async () => { ${beforeContract} } });`]),
    ],
    {
      cwd: FIXTURE_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://local_writer:secret@example.invalid/wtp_test",
        WTP_DB_ROLE: "local",
        NODE_OPTIONS: `--import ${pathToFileURL(REGISTER).href}`,
        ...env,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const output = `${child.stdout}${child.stderr}`;
  const lines = output.split(/\r?\n/);
  return {
    status: child.status,
    output,
    statements: lines
      .filter((line) => line.startsWith(SQL_PREFIX))
      .map((line) => JSON.parse(line.slice(SQL_PREFIX.length)) as string),
    events: lines
      .filter((line) => line.startsWith(EVENT_PREFIX))
      .map((line) => JSON.parse(line.slice(EVENT_PREFIX.length)) as unknown),
  };
}

function journal() {
  return JSON.parse(
    readFileSync(join(ROOT, "lib", "db", "migrations", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number }[] };
}

test("db:apply --dry plans against an absent journal using SELECT only", () => {
  const committed = journal().entries;
  const result = run(["--dry"], { APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: "0" });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.statements.length, 1, result.output);
  assert.match(result.statements[0], /^SELECT\s+to_regclass\b/i);
  assert.ok(
    result.statements.every((statement) => /^SELECT\b/i.test(statement)),
    `dry mode issued a non-read statement: ${JSON.stringify(result.statements)}`,
  );
  assert.deepEqual(result.events, [], "dry mode opened a transaction");
  assert.match(
    result.output,
    new RegExp(`${committed.length} migration\\(s\\) committed · 0 already applied here · ${committed.length} pending`),
  );
  assert.match(result.output, /DRY RUN — nothing applied\./);
});

test("db:apply --dry preserves applied/pending planning without issuing DDL", () => {
  const committed = journal().entries;
  assert.ok(committed.length >= 3, "fixture needs at least three committed migrations");
  const alreadyApplied = committed.slice(0, 2);
  const result = run(["--dry"], {
    APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: "1",
    APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: alreadyApplied.map((entry) => entry.when).join(","),
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.statements.length, 2, result.output);
  assert.ok(
    result.statements.every((statement) => /^SELECT\b/i.test(statement)),
    `dry mode issued a non-read statement: ${JSON.stringify(result.statements)}`,
  );
  assert.doesNotMatch(result.output, /\bCREATE\s+(?:SCHEMA|TABLE)\b/i);
  assert.deepEqual(result.events, [], "dry mode opened a transaction");
  assert.match(
    result.output,
    new RegExp(
      `${committed.length} migration\\(s\\) committed · 2 already applied here · ${committed.length - 2} pending`,
    ),
  );
  for (const entry of alreadyApplied) {
    assert.doesNotMatch(result.output, new RegExp(`pending: ${entry.tag}(?:\\r?\\n|$)`));
  }
  assert.match(result.output, new RegExp(`pending: ${committed[2].tag}(?:\\r?\\n|$)`));
});

test("an already applied upper bound still includes older pending migrations", () => {
  const committed = journal().entries;
  const result = run(["--dry", `--upto=${committed[2].tag}`], { APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: String(committed[2].when) });
  assert.equal(result.status, 0, result.output);
  const pending = result.output.split(/\r?\n/).filter(line => line.startsWith("  pending: ")).map(line => line.slice(11));
  assert.deepEqual(pending, committed.slice(0, 2).map(entry => entry.tag));
  assert.ok(result.statements.every(statement => /^SELECT\b/.test(statement)));
  assert.deepEqual(result.events, []);
});

test("a serving mismatch cannot write pending contracts, but cannot hold a current contract journal", () => {
  const args = ["--target=production", "--phase=contract"];
  const env = { WTP_RUNTIME_MODE: "production",
    WTP_PRODUCTION_DATABASE_URL_WRITE: "postgresql://writer:secret@ep-dry-river-axwtolzc.c-4.us-east-2.aws.neon.tech/neondb" };
  for (const exists of ["0", "1"]) {
    const result = run(args, { ...env, APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: exists }, "throw new Error('REFUSED pending contracts: serving mismatch');");
    assert.equal(result.status, 1);
    assert.match(result.output, /REFUSED pending contracts/);
    assert.ok(result.statements.every(statement => /^SELECT\b/.test(statement)));
    assert.deepEqual(result.events, [], "a serving refusal wrote schema or a migration");
  }
  const current = run(args, { ...env, APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: journal().entries.map(entry => entry.when).join(",") },
    "throw new Error('serving check must not block a zero-write current journal');");
  assert.equal(current.status, 0, current.output);
  assert.match(current.output, /No pending contract migrations/);
  assert.ok(current.statements.every(statement => /^SELECT\b/.test(statement)));
  assert.deepEqual(current.events, []);
});

test("non-dry db:apply keeps setup and migration journalling fail-closed", () => {
  const result = run([], { APPLY_MIGRATIONS_FAKE_TRANSACTION_FAIL: "1", APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: "0" });

  assert.equal(result.status, 1, result.output);
  assert.ok(
    result.events.some((event) => /^CREATE\s+SCHEMA\b/i.test((event as { statement?: string }).statement ?? "")),
    `non-dry setup did not create the Drizzle schema: ${JSON.stringify(result.statements)}`,
  );
  assert.ok(
    result.events.some((event) => /^CREATE\s+TABLE\b/i.test((event as { statement?: string }).statement ?? "")),
    `non-dry setup did not create the Drizzle journal: ${JSON.stringify(result.statements)}`,
  );
  assert.ok(result.events.length > 0, "the planted failure never reached a migration transaction");
  assert.match(result.output, /FAIL\s+transaction rolled back before the journal row was written/);
  assert.match(result.output, /applied no durable statements in this run/);
  assert.match(result.output, /planted transaction failure/);
  assert.doesNotMatch(result.output, /journalled\s+hash=/);
  assert.doesNotMatch(result.output, /Applied \d+ migration/);
});

test("an applied journal hash mismatch refuses in both dry and write modes without DDL", () => {
  for (const args of [["--dry"], []]) {
    const result = run(args, { APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: String(journal().entries[0].when), APPLY_MIGRATIONS_FAKE_BAD_HASH: "1" });
    assert.equal(result.status, 1);
    assert.match(result.output, /REFUSED.*does not match the applied journal hash/);
    assert.ok(result.statements.every(statement => /^SELECT\b/.test(statement)));
    assert.deepEqual(result.events, []);
  }
});

for (const phase of ["expand", "contract"] as const) {
  test(`db:apply --phase=${phase} plans only that phase without writes`, () => {
    const result = run(["--dry", `--phase=${phase}`], { APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: "0" });
    assert.equal(result.status, 0, result.output);
    const pending = result.output.split(/\r?\n/).filter(line => line.startsWith("  pending: ")).map(line => line.slice(11));
    assert.deepEqual(pending, journal().entries.filter(e => declaredPhase(e.tag)?.phase === phase).map(e => e.tag));
    assert.ok(result.statements.every(statement => /^SELECT\b/i.test(statement)));
    assert.deepEqual(result.events, []);
  });
}

test("an unknown phase refuses before database setup", () => {
  const result = run(["--phase=typo"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /phase must be expand or contract/);
  assert.deepEqual(result.statements, []);
  assert.deepEqual(result.events, []);
});

test("an unknown upper bound refuses before any database setup", () => {
  const result = run(["--upto=typo"]);
  assert.equal(result.status, 1);
  assert.deepEqual(result.statements, []);
});

test("concurrent migration reuse reports no statements applied and keeps the lock with the journal", () => {
  const result = run([`--upto=${journal().entries[0].tag}`], { APPLY_MIGRATIONS_FAKE_CONCURRENT: "1" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /REUSED/);
  assert.match(result.output, /Applied 0 migration\(s\), 0 statement\(s\)/);
  const events = result.events as { kind: string; statement?: string; requests?: number }[];
  assert.match(events.find(event => event.kind === "transaction-tag")?.statement ?? "", /pg_advisory_xact_lock/);
  assert.match(events.find(event => event.kind === "transaction-query")?.statement ?? "", /IF NOT EXISTS[\s\S]*EXECUTE[\s\S]*INSERT INTO/);
});

test("the runtime refuses a contract before the exact commit is loaded, records the refusal and redacts failure output", async () => {
  const sha = "a".repeat(40);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", WTP_RUNTIME_MODE: "production", WTP_DB_ROLE: "production", PRIVATE_TOKEN: "private-token-value" };
  const records: unknown[] = [];
  let executed = false;
  const args = ["--target=production", "--phase=contract", "--production-runtime", `--runtime-commit=${sha}`];
  const status = await runDbApply(args, env, { head: () => "b".repeat(40),
    execute: () => { executed = true; return { status: 0, stdout: "", stderr: "" }; },
    record: async record => { records.push(record); } });
  assert.equal(status, 1);
  assert.equal(executed, false);
  assert.match(JSON.stringify(records), /REFUSED/);
  records.length = 0;
  assert.equal(await runDbApply(args, env, { head: () => sha,
    execute: () => ({ status: 1, stdout: "", stderr: "FAIL private-token-value postgresql://private:password@host/db" }),
    record: async record => { records.push(record); } }), 1);
  assert.doesNotMatch(JSON.stringify(records), /private-token-value|password|private:/);
  assert.match(JSON.stringify(records), /FAILED/);
});

test("production apply refuses a writer on the old endpoint before database access", () => {
  const result = run(["--target=production", "--phase=expand"], {
    WTP_RUNTIME_MODE: "production",
    WTP_PRODUCTION_DATABASE_URL_WRITE: "postgresql://writer:secret@ep-weathered-cherry-ax65m9rf.c-4.us-east-2.aws.neon.tech/neondb",
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /approved ep-dry-river endpoint/);
  assert.doesNotMatch(result.output, /secret|ep-weathered/);
  assert.deepEqual(result.statements, []);
  assert.deepEqual(result.events, []);
});

test("the legacy production contract command uses the same serving refusal before database access", () => {
  const result = run(["--target=production", "--phase=contract"], { WTP_RUNTIME_MODE: "production" });
  assert.equal(result.status, 1);
  assert.match(result.output, /REFUSED.*exact production commit to be serving and loaded/);
  assert.deepEqual(result.statements, []);
  assert.deepEqual(result.events, []);
});

test("an unreadable runtime commit is redacted and saved as a contract refusal", async () => {
    const records: unknown[] = [];
    const sha = "a".repeat(40);
    const status = await runDbApply(["--target=production", "--phase=contract", "--production-runtime", `--runtime-commit=${sha}`],
      { WTP_RUNTIME_MODE: "production", NODE_ENV: "test" }, {
        head: () => { throw Error("private-git-error"); },
        execute: () => { throw Error("must not launch"); },
        record: async record => { records.push(record); },
      });
    assert.equal(status, 1);
    assert.equal(records.length, 1);
    assert.match(JSON.stringify(records), /REFUSED/);
    assert.doesNotMatch(JSON.stringify(records), /private-git-error|private-fetch-error/);
});

test("preview, branch and local build hooks skip without reading a database", () => {
  for (const settings of [
    { NETLIFY: "true", CONTEXT: "deploy-preview", BRANCH: "main" },
    { NETLIFY: "true", CONTEXT: "branch-deploy", BRANCH: "test" },
    { NETLIFY: "true", CONTEXT: "production", BRANCH: "test" },
    { NETLIFY: "false", CONTEXT: "production", BRANCH: "main" },
  ]) {
    const result = run(["--target=production", "--phase=expand", "--production-build"], settings);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /skipped.*writes=0/);
    assert.deepEqual(result.statements, []);
    assert.deepEqual(result.events, []);
  }
});

const productionBuild = { NETLIFY: "true", CONTEXT: "production", BRANCH: "main",
  DATABASE_URL: "postgresql://reader:secret@ep-dry-river-axwtolzc-pooler.c-4.us-east-2.aws.neon.tech/neondb",
  WTP_PRODUCTION_DATABASE_URL_WRITE: "" };
const expandBuildArgs = ["--target=production", "--phase=expand", "--production-build"];

test("production refuses uncommitted journal or SQL bytes before database access", () => {
  for (const file of ["meta/_journal.json", `${journal().entries[0].tag}.sql`]) {
    const path = join(FIXTURE_ROOT, "lib/db/migrations", file);
    const original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from("\n")]));
      const result = run(expandBuildArgs, productionBuild, "");
      assert.equal(result.status, 1);
      assert.match(result.output, /REFUSED.*differs from its committed (version|SQL)/);
      assert.deepEqual(result.statements, []);
      assert.deepEqual(result.events, []);
    } finally { writeFileSync(path, original); }
  }
});

test("production build without a writer passes only when committed expands are already applied", () => {
  // Pending contracts do not hold a zero-write expand build.
  const expands = journal().entries.filter(entry => declaredPhase(entry.tag)?.phase === "expand");
  const result = run(expandBuildArgs, { ...productionBuild,
    APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: expands.map(entry => entry.when).join(",") }, "");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /No pending expand migrations/);
  assert.match(result.output, /writes=0; no writer required/);
  const events = result.events as { kind: string; statement?: string; readOnly?: boolean }[];
  assert.ok(events.filter(event => event.statement).every(event => /^SELECT\b/.test(event.statement!)));
  assert.ok(events.filter(event => event.kind === "transaction").every(event => event.readOnly));
});

test("production build without a writer refuses pending expands or an absent journal without DDL", () => {
  for (const exists of ["0", "1"]) {
    const result = run(expandBuildArgs, { ...productionBuild, APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS: exists }, "");
    assert.equal(result.status, 1);
    assert.match(result.output, /pending expand migrations require WTP_PRODUCTION_DATABASE_URL_WRITE/);
    assert.ok((result.events as { statement?: string }[]).filter(event => event.statement)
      .every(event => /^SELECT\b/.test(event.statement!)));
    assert.doesNotMatch(result.output, /CREATE SCHEMA|CREATE TABLE|transaction-query/);
  }
});

test("writerless production inspection still refuses the wrong endpoint and applied hash drift", () => {
  const wrong = run(expandBuildArgs, { ...productionBuild, DATABASE_URL: "postgresql://reader:secret@old.invalid/db" }, "");
  assert.equal(wrong.status, 1);
  assert.match(wrong.output, /approved ep-dry-river endpoint/);
  assert.deepEqual(wrong.events, []);
  assert.doesNotMatch(wrong.output, /secret|old.invalid/);
  const drift = run(expandBuildArgs, { ...productionBuild, APPLY_MIGRATIONS_FAKE_BAD_HASH: "1",
    APPLY_MIGRATIONS_FAKE_APPLIED_WHEN: journal().entries.map(entry => entry.when).join(",") }, "");
  assert.equal(drift.status, 1);
  assert.match(drift.output, /does not match the applied journal hash/);
});
