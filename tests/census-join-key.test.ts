import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { posixRelative } from "../scripts/repo-path.mjs";
import { readTable } from "../lib/reference/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Join on census_id_pid6; census_id_gidid is blank on some rows, so a join on it drops or collapses governments.
const THIS_GUARD = "tests/census-join-key.test.ts";

const SWEPT = ["app", "components", "hooks", "lib", "scripts", "tests"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|sql)$/.test(entry)) out.push(full);
  }
  return out;
}

function sources(): Array<{ rel: string; code: string }> {
  const files: Array<{ rel: string; code: string }> = [];
  for (const root of SWEPT) {
    for (const abs of walk(join(ROOT, root))) {
      const raw = readFileSync(abs, "utf8");
      // Comments are stripped so an explanation is not read as a use.
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      files.push({ rel: posixRelative(ROOT, abs), code });
    }
  }
  return files;
}

test("the gidid sweep reaches the source tree it claims to", () => {
  assert.ok(
    sources().length > 300,
    "a sweep that walked nothing must never report that it found nothing wrong",
  );
});

test("census_id_gidid appears in no join, key, lookup or foreign-key position", () => {
  const offenders: string[] = [];
  for (const { rel, code } of sources()) {
    if (rel === THIS_GUARD) continue;
    if (!/gidid/i.test(code)) continue;
    offenders.push(`${rel}: names census_id_gidid`);
  }

  assert.deepEqual(
    offenders,
    [],
    "census_id_gidid is legacy, phased out from 2022, and blank on 36 of 90,837 " +
      "rows. Join on census_id_pid6.",
  );
});

test("census_id_pid6 is unique across all 90,837 units, and blank on none", () => {
  const table = readTable("census_govt_units_2022");
  const idx = table.header.indexOf("census_id_pid6");
  assert.ok(idx >= 0, "the join key column is present");

  const seen = new Set<string>();
  let blank = 0;
  for (const row of table.rows) {
    const v = (row[idx] ?? "").trim();
    if (v === "") blank += 1;
    else seen.add(v);
  }
  assert.equal(blank, 0, "a blank join key would collapse rows together");
  assert.equal(
    seen.size,
    90_837,
    "distinct pid6 values must equal the row count — a join that can collapse is " +
      "presumed broken until it is asked for distinctness",
  );
});

test("census_id_gidid is blank on exactly 36 rows — the recorded property", () => {
  const table = readTable("census_govt_units_2022");
  const idx = table.header.indexOf("census_id_gidid");
  const blank = table.rows.filter((r) => (r[idx] ?? "").trim() === "").length;
  assert.equal(
    blank,
    36,
    "36 of 90,837 (0.04%). This is not corruption — Census phased GIDID out from " +
      "2022 — and it is the reason a join on it silently loses 36 governments.",
  );
});
