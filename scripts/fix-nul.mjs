/**
 * One-shot: strip a literal NUL byte from a source file and put a real
 * separator in its place.
 *
 * Written during the 2026-08-26 governance remediation, when a shell-driven
 * edit wrote `parts.join("<NUL>")` into `scripts/workstream-migrate.mts`. A
 * literal NUL makes ripgrep and `git grep` classify the file as binary and skip
 * it SILENTLY, so every class sweep of this repository would have reported
 * nothing found without having looked. `tests/nul-bytes.test.ts` caught it.
 *
 * Committed under RULING 76: a one-shot script stays in the tree, because it
 * carries the technique.
 */
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/fix-nul.mjs <file>");
  process.exit(2);
}

const before = readFileSync(target);
const nulCount = before.filter((b) => b === 0).length;
if (nulCount === 0) {
  console.log(`${target}: no NUL bytes`);
  process.exit(0);
}

// A space, not the empty string: the separator is load-bearing. Joining on ""
// would let ("ab","c") and ("a","bc") hash identically, and these ids are what
// make a discovery frontier resumable.
const after = Buffer.from(
  before.toString("latin1").split(String.fromCharCode(0)).join(" "),
  "latin1",
);
writeFileSync(target, after);
console.log(`${target}: replaced ${nulCount} NUL byte(s) with a space`);
