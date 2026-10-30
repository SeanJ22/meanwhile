import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { coreProblems, createdTables, ormTables, tableWrites } from "../scripts/check-rulings.mjs";

const ROOT = join(import.meta.dirname, "..");
const core = JSON.parse(readFileSync(join(ROOT, "lib", "core", "core.json"), "utf8"));
const repo = () => new Map(["app", "lib", "scripts", "netlify"].flatMap(dir => readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).map(file => join(dir, file)))
  .filter(file => /\.(?:ts|tsx|mts|mjs|js|sql)$/.test(file) && !file.includes("node_modules")).map(file => [file, readFileSync(join(ROOT, file), "utf8")] as const));

test("no file writes a core table, or defines a table, that lib/core/core.json does not list", () => {
  assert.deepEqual(coreProblems(core, repo()), []);
});

test("a write around the Slide, a new table, or a longer bypass list fails; the listed writers and comments do not", () => {
  const files = repo();
  const planted: Record<string, string> = {
    "lib/facts/rogue-fact.ts": "await query(`UPDATE fact SET status = 'live' WHERE id = $1`, [id]);",
    "lib/rogue-entity.ts": "await query('INSERT INTO public.entity (id) VALUES ($1)');",
    "lib/rogue-copy.ts": "await sql.query(`DELETE FROM source_copy WHERE id = $1`);",
    "lib/rogue-orm.ts": "await getDb().insert(reactions).values(row);",
    "lib/rogue-dynamic.ts": "await query(`INSERT INTO ${table} (a) VALUES ($1)`);",
    "lib/rogue-table.ts": "await query(`CREATE TABLE IF NOT EXISTS surprise (id int)`);",
    "lib/db/migrations/9999_rogue.sql": "CREATE TABLE surprise_two (id int);",
  };
  const quiet: Record<string, string> = {
    "lib/quiet-prose.ts": "// UPDATE fact SET x = 1\nthrow new Error('could not update fact value');\nconst q = 'select * from fact';",
    "tests/helpers/rogue.ts": "UPDATE fact SET x = 1; CREATE TABLE fixture (id int);",
    "lib/core/door.ts": `${files.get("lib/core/door.ts")}\nawait query("UPDATE fact SET status = 'superseded'");`,
  };
  const found = coreProblems(core, new Map([...files, ...Object.entries(planted), ...Object.entries(quiet)]));
  for (const file of Object.keys(planted)) assert.ok(found.some(problem => problem.includes(file)), file);
  assert.deepEqual(found.filter(problem => problem.includes("core table")).length, 4, found.join("\n"));
  assert.ok(found.some(problem => problem.includes("surprise, outside the core")) && found.some(problem => problem.includes("surprise_two, outside the core")), "a migration that adds a table is caught");
  assert.equal(found.length, 7, found.join("\n"));
  const stale = structuredClone(core), table = Object.keys(core.tables).find(name => core.tables[name].bypass.length)!;
  stale.tables.fact.bypass.push("lib/not/writing.ts");
  const [removed] = core.tables[table].bypass;
  const base = structuredClone(core);
  base.tables[table].bypass = base.tables[table].bypass.filter((file: string) => file !== removed);
  const problems = coreProblems(stale, files, base);
  assert.ok(problems.some(problem => /lib\/not\/writing\.ts no longer writes fact/.test(problem)));
  assert.ok(problems.some(problem => problem.includes(`${removed} was added as a bypass of ${table}`)));
  assert.deepEqual(coreProblems(core, files, structuredClone(core)), [], "an unchanged list is fine; only growth fails");
});

test("the scanner reads writes the way the code spells them", () => {
  assert.deepEqual(tableWrites("UPDATE fact f SET a = 1; update only \"entity\" set b = 2; INSERT INTO blank(a) SELECT 1; DELETE FROM public.owner_flag; TRUNCATE TABLE rebuild_queue").tables,
    ["blank", "entity", "fact", "owner_flag", "rebuild_queue"]);
  assert.equal(tableWrites("const hash = createHash('sha256').update(text).digest();").tables.length, 0);
  assert.deepEqual(tableWrites("db.update(reactions).set({}); hash.update(data);", ormTables('export const reactions = pgTable(\n  "reactions", {')).tables, ["reactions"]);
  assert.deepEqual(createdTables("CREATE TABLE IF NOT EXISTS cp_a (x int); create table \"b\" as select 1;"), { names: ["b", "cp_a"], dynamic: false });
  assert.equal(createdTables("`CREATE TABLE IF NOT EXISTS ${table} (x int)`").dynamic, true);
});
