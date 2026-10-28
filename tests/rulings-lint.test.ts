import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkRulings, recordReads } from "../scripts/check-rulings.mjs";
import { browserEmailLeaks, PERSONAL_EMAIL } from "../lib/feedback/browser-privacy.ts";

function fixture(initial: Record<string, string> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "rc-01-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (file: string, source: string) => { mkdirSync(dirname(join(cwd, file)), { recursive: true }); writeFileSync(join(cwd, file), source); };
  git("init", "-q"); git("config", "user.name", "Codex"); git("config", "user.email", "codex@openai.com");
  for (const [file, source] of Object.entries(initial)) put(file, source);
  put("rulings-read-baseline.json", JSON.stringify({ reads: Object.entries(initial).flatMap(([file, source]) => recordReads(file, source)) }));
  git("add", "."); git("commit", "-qm", "fixture");
  const base = git("rev-parse", "HEAD");
  return { cwd, git, put, check: () => checkRulings({ cwd, base }), close: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("RC-01: new reads fail even when the saved list is enlarged; removals permanently shrink it", async () => {
  const file = "lib/probe.ts", original = "store.readCandidate(id);\n";
  const f = fixture({ [file]: original });
  try {
    f.put(file, 'const held = guard ? previous : store.readCandidate(\n id\n);\n');
    assert.deepEqual(await f.check(), [], "formatting and guards preserve an existing call's identity");
    f.put(file, original + "store.readCandidate(other);\n");
    assert.match((await f.check()).join("\n"), /added readCandidate.*lib\/probe.ts.*rulings.md:192 and 194/);
    f.put("rulings-read-baseline.json", JSON.stringify({ reads: recordReads(file, original + "store.readCandidate(other);\n") }));
    assert.ok((await f.check()).length > 0, "editing the allowance cannot admit a new call");
    f.put(file, "");
    f.put("rulings-read-baseline.json", JSON.stringify({ reads: recordReads(file, original) }));
    assert.deepEqual(await f.check(), []);
    assert.deepEqual(JSON.parse(readFileSync(join(f.cwd, "rulings-read-baseline.json"), "utf8")).reads, []);
    f.git("add", "."); f.git("commit", "-qm", "remove read");
    f.put(file, original);
    f.put("rulings-read-baseline.json", JSON.stringify({ reads: recordReads(file, original) }));
    f.git("add", "."); f.git("commit", "-qm", "try to restore read");
    assert.ok((await f.check()).length > 0, "a committed decrease cannot be undone");
  } finally { f.close(); }
});

test("RC-01: wildcard projections, qualified stars and cache bypasses fail; aggregates and comments do not", async () => {
  const f = fixture();
  try {
    for (const source of ['sql`SELECT\n * FROM civic_data_candidates`;', 'sql`SELECT id, c.* FROM civic_data_candidates c`;', 'sql`SELECT * FROM ${table}`;', 'const options = { bypassCache: true };']) {
      f.put("lib/probe.ts", source);
      assert.equal((await f.check()).length, 1, source);
    }
    f.put("lib/probe.ts", '// readCandidate(id), bypassCache\nconst q = "SELECT count(*) FROM civic_data_candidates";');
    assert.deepEqual(await f.check(), []);
    f.put("lib/probe.ts", 'sql`WITH names AS (SELECT id FROM civic_data_candidates) SELECT * FROM names`; sql`SELECT * FROM jsonb_to_recordset($1::jsonb) AS n(id text)`;');
    assert.deepEqual(await f.check(), [], "narrow CTEs and parameter expansion do not download stored records");
    f.put("lib/probe.ts", 'sql`WITH ${held} AS (SELECT id FROM civic_data_candidates) SELECT * FROM ${held}`;');
    assert.deepEqual(await f.check(), [], "a generated CTE name still expands selected columns");
    f.put("lib/probe.ts", 'sql`${prefix ? prefix + "," : "WITH"} ${held} AS MATERIALIZED (SELECT id FROM civic_data_candidates) SELECT source.* FROM ${held} source`;');
    assert.deepEqual(await f.check(), [], "a generated WITH prefix still declares a CTE");
    f.put("lib/probe.ts", 'sql`SELECT n.* FROM jsonb_to_recordset($1::jsonb) AS n(id text)`;');
    assert.deepEqual(await f.check(), [], "a qualified parameter projection also stays local to the query");
    const mixed = 'sql`WITH pointers AS (SELECT id FROM civic_data_candidates), subset AS (SELECT * FROM pointers), physical AS (SELECT r.* FROM civic_data_rows r) SELECT id FROM subset`;';
    assert.equal(recordReads("lib/probe.ts", mixed).filter(row => row.kind === "SELECT *").length, 1,
      "a later CTE cannot make an earlier parameter projection look like a stored-record read");
  } finally { f.close(); }
});

test("RC-01: added proof paths and orphan scripts fail, including staged ignored files and orphan cycles", async () => {
  const f = fixture({ ".gitignore": "/docs/evidence/\n" });
  try {
    for (const file of ["docs/evidence/trace.json", "docs/measurements/run.json", "docs/rc-01.md", "docs/rb-a1.md", "scripts/proof.mjs"]) {
      f.put(file, "{}"); if (file.startsWith("docs/evidence")) f.git("add", "-f", file);
      assert.ok((await f.check()).some((line: string) => line.includes(file)), file);
    }
    f.put("scripts/first.mjs", "import './second.mjs';"); f.put("scripts/second.mjs", "import './first.mjs';");
    assert.ok((await f.check()).some((line: string) => line.includes("scripts/first.mjs")));
    f.put("lib/entry.ts", "// node scripts/proof.mjs\nimport '../scripts/first.mjs';");
    assert.ok((await f.check()).some((line: string) => line.includes("scripts/proof.mjs")), "a comment does not run a script");
    assert.ok(!(await f.check()).some((line: string) => line.includes("scripts/first.mjs")), "a real import reaches both scripts");
  } finally { f.close(); }
});

test("RC-01: jobs require a numeric byte declaration and non-owner rulings edits fail", async () => {
  const f = fixture({ "docs/rulings.md": "Owner rules\n" });
  try {
    f.put("lib/jobs.ts", "const job = { id: 'new', acquisitionAdapter: { command: ['scripts/source.mts'] } };");
    assert.ok((await f.check()).some((line: string) => /no database bytes.*lib\/jobs.ts/.test(line)));
    for (const number of ["NaN", "Infinity", "-1", "'many'", "null"]) {
      f.put("lib/jobs.ts", `const job = { id: 'new', databaseBytesPerRun: ${number}, acquisitionAdapter: { command: ['scripts/source.mts'] } };`);
      assert.ok((await f.check()).some((line: string) => /invalid database bytes/.test(line)), number);
    }
    f.put("lib/jobs.ts", "const job = { id: 'new', databaseBytesPerRun: 1234, acquisitionAdapter: { command: ['scripts/source.mts'] } };");
    assert.ok(!(await f.check()).some((line: string) => line.includes("lib/jobs.ts")));
    f.put("docs/rulings.md", "Agent changed the rule\n");
    assert.ok((await f.check()).some((line: string) => /Only Sean.*docs\/rulings.md:3/.test(line)));
  } finally { f.close(); }
});

test("RC-01: the existing feedback privacy rule covers public assets, API output and encodings, with its original exemption", () => {
  const encoded = PERSONAL_EMAIL.replace("@", "&#64;");
  assert.deepEqual(browserEmailLeaks([
    ["public/contact.svg", encoded], ["app/api/contact/route.ts", PERSONAL_EMAIL],
    [".next/static/chunk.js", PERSONAL_EMAIL], ["lib/geo/outbound-agent.ts", PERSONAL_EMAIL],
  ]), ["public/contact.svg", "app/api/contact/route.ts", ".next/static/chunk.js"]);
});
