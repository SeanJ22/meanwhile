import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bundleTables, checkRulings, controlRecordReads, recordReads, repositoryTables } from "../scripts/check-rulings.mjs";
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
    for (const source of ['sql`SELECT\n * FROM fact_rows`;', 'sql`SELECT id, c.* FROM fact_rows c`;', 'sql`SELECT * FROM ${table}`;', 'const options = { bypassCache: true };']) {
      f.put("lib/probe.ts", source);
      assert.equal((await f.check()).length, 1, source);
    }
    f.put("lib/probe.ts", '// readCandidate(id), bypassCache\nconst q = "SELECT count(*) FROM fact_rows";');
    assert.deepEqual(await f.check(), []);
    f.put("lib/probe.ts", 'sql`WITH names AS (SELECT id FROM fact_rows) SELECT * FROM names`; sql`SELECT * FROM jsonb_to_recordset($1::jsonb) AS n(id text)`;');
    assert.deepEqual(await f.check(), [], "narrow CTEs and parameter expansion do not download stored records");
    f.put("lib/probe.ts", 'sql`WITH ${held} AS (SELECT id FROM fact_rows) SELECT * FROM ${held}`;');
    assert.deepEqual(await f.check(), [], "a generated CTE name still expands selected columns");
    f.put("lib/probe.ts", 'sql`${prefix ? prefix + "," : "WITH"} ${held} AS MATERIALIZED (SELECT id FROM fact_rows) SELECT source.* FROM ${held} source`;');
    assert.deepEqual(await f.check(), [], "a generated WITH prefix still declares a CTE");
    f.put("lib/probe.ts", 'sql`SELECT n.* FROM jsonb_to_recordset($1::jsonb) AS n(id text)`;');
    assert.deepEqual(await f.check(), [], "a qualified parameter projection also stays local to the query");
    const mixed = 'sql`WITH pointers AS (SELECT id FROM fact_rows), subset AS (SELECT * FROM pointers), physical AS (SELECT r.* FROM civic_data_rows r) SELECT id FROM subset`;';
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

const STORE = "lib/control-plane/repository/pg-store.ts";
const STORE_SOURCE = 'export const repos = { doors: pgDoorRepository(sql, bounded), leases: pgAggregateRepository<Lease>(sql, "Lease", "cp_leases", bounded) };\n';

/** A river whose saved lists already hold the given files' bundle and control-record readers. */
function listedFixture(initial: Record<string, string>) {
  const f = fixture({ [STORE]: STORE_SOURCE, ...initial });
  const tables = repositoryTables(STORE_SOURCE), sources = Object.entries({ [STORE]: STORE_SOURCE, ...initial });
  f.put("rulings-read-baseline.json", JSON.stringify({ reads: sources.flatMap(([file, source]) => recordReads(file, source)),
    bundleTables: sources.flatMap(([file, source]) => bundleTables(file, source)),
    controlRecordReads: sources.flatMap(([file, source]) => controlRecordReads(file, source, tables)) }));
  f.git("add", "."); f.git("commit", "-qm", "lists");
  const base = f.git("rev-parse", "HEAD");
  return { ...f, check: () => checkRulings({ cwd: f.cwd, base }), saved: () => JSON.parse(readFileSync(join(f.cwd, "rulings-read-baseline.json"), "utf8")) };
}

test("RC-01: a new file naming a bundle table fails with its table; a removed reader shrinks the list for good", async () => {
  const held = "lib/held.ts", reader = 'export const q = "SELECT version FROM civic_data_promotions WHERE key=$1";\n';
  const f = listedFixture({ [held]: reader });
  try {
    assert.deepEqual(await f.check(), [], "the river's own readers stay listed");
    f.put("lib/new-reader.ts", 'export const q = sql`SELECT payload FROM civic_data_promotions WHERE scope=${scope}`;\n');
    assert.deepEqual(await f.check(), ["A new reader of the bundle table civic_data_promotions in lib/new-reader.ts violates docs/rulings.md:192 and 194."]);
    f.put("lib/new-reader.ts", "// civic_data_promotions is named only in a comment\nexport const q = 1;\n");
    assert.deepEqual(await f.check(), [], "comments name nothing");
    f.put(held, reader + 'export const parts = "SELECT hash FROM civic_data_payload_parts";\n');
    assert.deepEqual(await f.check(), ["A new reader of the bundle table civic_data_payload_parts in lib/held.ts violates docs/rulings.md:192 and 194."],
      "a listed file that starts naming another bundle table is a new reader of that table");
    const enlarged = f.saved();
    f.put("rulings-read-baseline.json", JSON.stringify({ ...enlarged, bundleTables: [...enlarged.bundleTables, { file: held, table: "civic_data_payload_parts" }] }));
    assert.ok((await f.check()).some((line: string) => line.includes("civic_data_payload_parts in lib/held.ts")), "editing the list cannot admit a reader");
    f.put("rulings-read-baseline.json", JSON.stringify(enlarged));
    f.put(held, "export const q = 1;\n");
    assert.deepEqual(await f.check(), []);
    assert.deepEqual(f.saved().bundleTables, [], "the family move deletes its entries in the same change");
    f.git("add", "."); f.git("commit", "-qm", "move the family off the bundles");
    f.put(held, reader);
    f.put("rulings-read-baseline.json", JSON.stringify(enlarged));
    f.git("add", "."); f.git("commit", "-qm", "try to restore the reader");
    assert.ok((await f.check()).some((line: string) => line.includes("civic_data_promotions in lib/held.ts")), "a committed decrease cannot be undone");
  } finally { f.close(); }
});

test("RC-01: whole control-plane record reads are listed by table; narrowed and projected reads are not", async () => {
  const f = listedFixture({ "lib/held.ts": "export const all = () => repos.doors.list();\n" });
  try {
    assert.deepEqual(await f.check(), []);
    for (const [source, table] of [
      ["export const one = (id: string) => input.repos.leases.read(id);", "cp_leases"],
      ["const doors = repos.doors; export const all = () => doors.listWhere(['status'], 'OPEN');", "cp_doors"],
      ["const { leases: held } = deps.repos; export const all = () => held.mustRead('x');", "cp_leases"],
      ["export const q = sql`SELECT id, value FROM cp_doors WHERE id=$1`;", "cp_doors"],
      ["export const q = sql`SELECT position, record FROM cp_log_costs`;", "cp_log_costs"],
    ] as const) {
      f.put("lib/new-reader.ts", source);
      assert.deepEqual(await f.check(), [`A new whole-record read of ${table} in lib/new-reader.ts violates docs/rulings.md:192 and 194.`], source);
    }
    for (const source of [
      "export const some = () => repos.doors.listWhereNarrowed(['status'], 'OPEN', { status: true });",
      "export const one = (id: string) => repos.leases.readNarrowed(id, { expiresAt: true });",
      "export const changed = () => repos.leases.listChangedSince(null, held, { projection: { expiresAt: true } });",
      "export const q = sql`SELECT id, value->>'status' AS status, pg_column_size(value) AS size FROM cp_doors`;",
      "export const q = sql`SELECT item AS value FROM cp_admin_config, jsonb_array_elements(value->'rows') item`;",
      "export const files = () => store.list();",
    ]) {
      f.put("lib/new-reader.ts", source);
      assert.deepEqual(await f.check(), [], source);
    }
  } finally { f.close(); }
});

test("RC-01: the existing feedback privacy rule covers public assets, API output and encodings, with its original exemption", () => {
  const encoded = PERSONAL_EMAIL.replace("@", "&#64;");
  assert.deepEqual(browserEmailLeaks([
    ["public/contact.svg", encoded], ["app/api/contact/route.ts", PERSONAL_EMAIL],
    [".next/static/chunk.js", PERSONAL_EMAIL], ["lib/geo/outbound-agent.ts", PERSONAL_EMAIL],
  ]), ["public/contact.svg", "app/api/contact/route.ts", ".next/static/chunk.js"]);
});
