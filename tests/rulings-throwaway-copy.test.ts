import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bundleTables, THROWAWAY_COPIES, throwawayCopyProblems } from "../scripts/check-rulings.mjs";

const FILE = "lib/reader/state-mirror.ts";
const reads = "const rows = await pg.query('SELECT 1 FROM civic_data_promotions');\n";
const copy = `import { PGlite } from "@electric-sql/pglite";\nimport { applyMigrations } from "../db/apply-migrations.ts";\nimport type { Query } from "../facts/publish.ts";\nconst pg = new PGlite();\n${reads}`;

test("SPN-01PF: the exemption holds only for a file that makes its own in-memory copy and reaches no production writer", () => {
  // 1. A real throwaway copy is exempt from the bundle-table list.
  assert.deepEqual(throwawayCopyProblems(FILE, copy), []);
  assert.deepEqual(bundleTables(FILE, copy), [], "the listed copy may name the bundle tables");
  assert.deepEqual(THROWAWAY_COPIES, [FILE]);
  assert.deepEqual(throwawayCopyProblems(FILE, readFileSync(FILE, "utf8")), [], "the listed file is such a copy");
  assert.ok(bundleTables("lib/reader/other.ts", copy).length > 0, "any other file naming them is still listed");

  // 2. A listed file that does not create its own PGlite is not exempt.
  const borrowed = `import type { Query } from "../facts/publish.ts";\nexport const read = (query: Query) => query('SELECT 1 FROM civic_data_promotions');\n`;
  assert.deepEqual(throwawayCopyProblems(FILE, borrowed), ["does not create its own PGlite"]);
  assert.ok(bundleTables(FILE, borrowed).length > 0, "so its table reads are listed");

  // 3. A listed file that imports a production writer or driver is not exempt, whether the import is static or dynamic; a type import carries no code.
  const writer = `${copy}import { factWriter } from "../facts/db.ts";\n`;
  assert.match(throwawayCopyProblems(FILE, writer).join("\n"), /imports \.\.\/facts\/db\.ts, which reaches production/);
  assert.match(throwawayCopyProblems(FILE, `${copy}const { Pool } = await import("@neondatabase/serverless");\n`).join("\n"), /@neondatabase\/serverless/);
  assert.match(throwawayCopyProblems(FILE, `${copy}import { promote } from "../civic-data/promote.ts";\n`).join("\n"), /civic-data/);
  assert.deepEqual(throwawayCopyProblems(FILE, `${copy}import type { Writer } from "../facts/db.ts";\n`), []);
  assert.ok(bundleTables(FILE, writer).length > 0, "so its table reads are listed");
});
