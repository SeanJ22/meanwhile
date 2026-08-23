/**
 * `pnpm dupes` — **the class sweep for duplicated implementations.**
 * (RULING 103, 2026-08-23. Written for NJ Hunt 6 hardening item 6.)
 *
 * Three copies of an initials function rendered *Thomas J. Haynes III* as
 * "TI". A named-instance sweep — grep the symptom, grep the card — finds one
 * of three, because the other two are not the same text and do not use the
 * same variable names.
 *
 * This walks the tracked tree, extracts every function-shaped declaration with
 * its normalised body, and reports bodies that appear in more than one FILE:
 * identically, and structurally with identifiers set aside so a rename still
 * collides.
 *
 * Usage:
 *   pnpm dupes            — report every group, with counts
 *   pnpm dupes --shape    — shape collisions only
 *   pnpm dupes --exact    — exact copies only
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  duplicates,
  groupId,
  implementationsIn,
  MIN_BODY,
  type Implementation,
} from "../lib/ops/duplicate-implementations.ts";

const ROOT = process.cwd();
const ONLY = process.argv.includes("--shape")
  ? "shape"
  : process.argv.includes("--exact")
    ? "exact"
    : null;

/**
 * `git ls-files -z` rather than a directory walk. **ripgrep skips a hidden
 * path and a file carrying a NUL byte, and reports nothing found without
 * having looked** — the sweep instrument in this repo is the tracked set.
 */
export function sourceFiles(): string[] {
  return execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => /\.(?:ts|tsx|mts|mjs|js|cjs)$/.test(f))
    .filter((f) => !f.startsWith("tests/fixtures/"));
}

export function census(): Implementation[] {
  const all: Implementation[] = [];
  for (const file of sourceFiles()) {
    let src: string;
    try {
      src = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    all.push(...implementationsIn(file, src));
  }
  return all;
}

if (process.argv[1]?.endsWith("duplicate-implementations.mts")) {
  const files = sourceFiles();
  const all = census();
  const groups = duplicates(all).filter((g) => ONLY === null || g.kind === ONLY);

  console.log(`\nduplicate implementations — RULING 103\n`);
  console.log(`  files scanned            ${files.length}`);
  console.log(`  declarations found       ${all.length}`);
  console.log(`  bodies over ${MIN_BODY} chars   ${all.filter((i) => i.size >= MIN_BODY).length}`);
  console.log(`  duplicate groups         ${groups.length}\n`);

  for (const g of groups) {
    console.log(`  [${g.kind}] ${g.members.length} copies, ${g.members[0].size} chars`);
    for (const m of g.members) console.log(`      ${m.file}:${m.line}  ${m.name}()`);
    console.log(`      id: ${groupId(g)}`);
    console.log("");
  }

  if (groups.length === 0) {
    console.log("  no implementation appears in more than one file.\n");
  }
}

/* ------------------------------------------------------------- baseline --- */

/**
 * `--write` records the CURRENT groups as the baseline, the same way
 * `tests/guard-census.json` records guards.
 *
 * The baseline is not an approval. It is a line under a backlog: the guard
 * fails on a NEW duplicate group, so the class cannot grow while the existing
 * ones are worked through. Every recorded group carries a disposition, and a
 * group with no disposition fails — an entry that says nothing is an entry
 * that has quietly become permission.
 */
export const BASELINE_FILE = "tests/duplicate-implementations.json";
