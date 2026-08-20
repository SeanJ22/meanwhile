import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative } from "../scripts/repo-path.mjs";
import { readTable } from "../lib/reference/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Census join key is `census_id_pid6`. It is never `census_id_gidid`
 * (Prompt B item 3, 2026-08-20).
 *
 * GIDID is the legacy identifier, phased out from the 2022 Census of
 * Governments onward, and it is BLANK on 36 of the 90,837 unit rows. A join
 * on it does not fail — it drops those 36 governments, or worse, collapses
 * them together on the empty string. Both outcomes are a quieter version of
 * the FEC replication bug: a join that reports a healthy match rate while
 * pointing at the wrong rows.
 *
 * PID6 is unique across all 90,837 rows and blank on none, verified against
 * the file rather than against its provenance note.
 *
 * A COMMENT SAYING SO IS NOT ENFORCEMENT. This is the enforcement. The rule
 * is banned-by-default: `census_id_gidid` may not appear in this repo's code
 * at all, with one allowlisted exception that MEASURES the blanks rather than
 * joining on them — and the exception is itself checked for the shape of a
 * join, so the exemption cannot quietly become the thing it exempts.
 */

/** The one file allowed to name the legacy column, and why. */
const MEASUREMENT_ONLY = new Set([
  // Prints the blank-GIDID count as part of the reference reconciliation.
  // Counting the blanks is the evidence FOR this rule, not a use of the key.
  "scripts/reference-verify.mts",
]);

/**
 * A guard cannot be its own subject. This file holds the banned column in
 * assertion text and holds every key SHAPE as a literal regex, so sweeping
 * itself reports its own patterns as violations of themselves — which is
 * noise, not a finding. Excluded by name and stated here rather than folded
 * into the exemption list above, because the reason is different in kind:
 * those files are exempt from the RULE, this one is outside the SWEEP.
 */
const THIS_GUARD = "tests/census-join-key.test.ts";

/** Shapes that mean "this value is being used as a key". */
const KEY_SHAPES: Array<[RegExp, string]> = [
  [/new (?:Map|Set)\([^)]*gidid/i, "Map/Set keyed on gidid"],
  [/\.get\(\s*[^)]*gidid/i, "lookup by gidid"],
  [/\.set\(\s*[^)]*gidid/i, "keyed insert by gidid"],
  [/\bby\s*[A-Za-z]*[Gg]idid\b/, "a by-gidid index"],
  // Deliberately NOT a bare `gidid ... ===`. The reference verifier compares a
  // blank COUNT against 36, which is measurement, and a rule loose enough to
  // catch that would push every honest use into a second exemption. A real
  // equality join reads a record field, which the `.gidid` shape below catches.
  [/references\([^)]*gidid/i, "a foreign key on gidid"],
  [/\.gidid\b/i, "gidid read as a record field"],
];

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
      // Comments name the banned column constantly — this header does it a
      // dozen times. Stripping them keeps an explanation from reading as a use.
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

test("item 3: census_id_gidid appears in no join, key, lookup or foreign-key position", () => {
  const offenders: string[] = [];
  for (const { rel, code } of sources()) {
    if (rel === THIS_GUARD) continue;
    if (!/gidid/i.test(code)) continue;
    if (MEASUREMENT_ONLY.has(rel)) {
      // The exemption is measurement. If the exempt file grows a key shape,
      // it fails here — an allowlist that cannot be caught misusing its
      // exemption is not an allowlist, it is a hole.
      for (const [shape, label] of KEY_SHAPES) {
        if (shape.test(code)) offenders.push(`${rel}: exempt file grew ${label}`);
      }
      continue;
    }
    offenders.push(`${rel}: names census_id_gidid outside the measurement exemption`);
  }

  assert.deepEqual(
    offenders,
    [],
    "census_id_gidid is legacy, phased out from 2022, and blank on 36 of 90,837 " +
      "rows. Join on census_id_pid6.",
  );
});

test("item 3: every allowlisted exemption is a file that still exists", () => {
  for (const rel of MEASUREMENT_ONLY) {
    assert.ok(
      statSync(join(ROOT, rel)).isFile(),
      `${rel} is exempted but is not a file — an exemption that binds to nothing ` +
        "makes the guard stricter without anyone deciding that",
    );
  }
});

/* ---- the recorded properties of the two columns -------------------------- */

test("item 3: census_id_pid6 is unique across all 90,837 units, and blank on none", () => {
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

test("item 3: census_id_gidid is blank on exactly 36 rows — the recorded property", () => {
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
