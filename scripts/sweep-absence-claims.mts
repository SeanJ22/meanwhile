/**
 * EVERY ABSENCE STRING, AGAINST THE SHAPES THAT ASSERT A FACT ABOUT A PERSON.
 * (2026-08-26, Item 13 of the sources-and-incumbency brief.)
 *
 * Reports N strings found, K asserting facts about a person, and the shapes
 * searched. **RULING 159** — a sweep that matches no candidate strings at all
 * fails loudly rather than printing a clean board.
 *
 * Usage:  pnpm sweep:absence-claims
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { floored } from "../lib/ops/denominator-floor.ts";
import { CLAIM_SHAPES, KNOWN_GOOD, claimsInText } from "../lib/text/absence-claims.ts";

/**
 * `data/` IS EXCLUDED AND THE CLIP IS STATED. It holds retrieved content — the
 * words other people wrote on pages this project fetched — and sweeping it
 * returned 44,552 "absence family" sentences that are somebody else's prose,
 * not this product's copy. Reader-facing strings live in these three.
 */
const ROOTS = ["app", "components", "lib"];

/**
 * The two modules that hold forbidden shapes AS SPECIMENS, exempt by name with
 * the reason (the `tests/asset-store.test.ts` pattern — a carve-out nobody has
 * to write down is a carve-out that grows).
 *
 * They must contain the defect: `lib/text/absence-claims.ts` quotes the line
 * this sweep was written for, and `lib/text/refusal-shapes.ts` carries the
 * refusal family's own specimens. A sweep that flagged them would be flagging
 * the evidence that it works.
 */
const SPECIMEN_FILES = ["lib/text/absence-claims.ts", "lib/text/refusal-shapes.ts"];

/** Every double-quoted, backticked or single-quoted sentence in the tree. */
function sentences(): { file: string; text: string }[] {
  const out = execFileSync(
    "git",
    ["grep", "-a", "--untracked", "-I", "-n", "-oE", String.raw`["'\`][A-Z][^"'\`]{18,400}["'\`]`, "--", ...ROOTS],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const rows: { file: string; text: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const file = m[1].replace(/\\/g, "/");
    if (SPECIMEN_FILES.includes(file)) continue;
    rows.push({ file: `${file}:${m[2]}`, text: m[3].slice(1, -1) });
  }
  return rows;
}

/**
 * Is this quoted sentence inside a COMMENT rather than in shipped copy?
 *
 * A doc block that quotes the defect in order to explain the fix must not be
 * flagged as the defect — that is the sweep reading its own explanation as the
 * thing being explained. Read from the file, by line, because the grep gives
 * back a line number and nothing about its context.
 */
function commentLines(file: string): Set<number> {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const out = new Set<number>();
  let inBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (inBlock) {
      out.add(i + 1);
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("//")) {
      out.add(i + 1);
      continue;
    }
    if (t.startsWith("/*")) {
      out.add(i + 1);
      if (!t.includes("*/")) inBlock = true;
    }
  }
  return out;
}

const all = sentences();

if (all.length === 0) {
  console.error(
    "sweep:absence-claims: matched no quoted sentences at all across app/, components/, lib/ and " +
      "data/. This repository carries thousands, so that is a broken sweep, not a clean board " +
      "(RULING 159).",
  );
  process.exit(1);
}

// The absence family: sentences that explain why something is not there.
const ABSENCE_HINT =
  /\b(no|not|none|nothing|never|haven't|hasn't|don't|doesn't|yet|empty|unavailable|unsourced)\b/i;
const absences = all.filter((s) => ABSENCE_HINT.test(s.text));

const commentCache = new Map<string, Set<number>>();
function isComment(fileWithLine: string): boolean {
  const at = fileWithLine.lastIndexOf(":");
  const file = fileWithLine.slice(0, at);
  const line = Number(fileWithLine.slice(at + 1));
  if (!commentCache.has(file)) commentCache.set(file, commentLines(file));
  return commentCache.get(file)!.has(line);
}

const hits = absences
  .filter((s) => !isComment(s.file))
  .flatMap((s) => claimsInText(s.text).map((h) => ({ ...h, file: s.file })));

// RULING 159 — the floor is asserted BEFORE the count is reported. A sweep
// that found no sentences to judge has not found a clean surface.
const floor = floored("sweep:absence-claims", "quoted sentences in app/, components/ and lib/", all.length, hits.length);
void floor;

console.log(`sweep:absence-claims · ${CLAIM_SHAPES.length} shape(s) searched`);
for (const s of CLAIM_SHAPES) console.log(`    [${s.id}] ${s.re}`);
console.log("");
console.log(`  quoted sentences swept        ${all.length}`);
console.log(`  in the absence family         ${absences.length}`);
console.log(`  asserting a fact about a person  ${hits.length}`);

if (hits.length > 0) {
  console.log("");
  for (const h of hits) {
    console.log(`  ${h.file}`);
    console.log(`    [${h.shape}] ${h.why}`);
    console.log(`    "${h.text}"`);
  }
}

// The instrument is shown catching the real thing, on every run.
const planted = "People who have not held this office don't have a voting record to show.";
if (claimsInText(planted).length === 0) {
  console.error(
    "sweep:absence-claims: the shapes did not catch the line this sweep was written for. A sweep " +
      "that cannot find its own defect is a sweep reporting green about nothing (RULING 110).",
  );
  process.exit(1);
}
const falsePositives = KNOWN_GOOD.filter((g) => claimsInText(g).length > 0);
if (falsePositives.length > 0) {
  console.error("");
  console.error("sweep:absence-claims: these HONEST lines were flagged, which would turn this sweep into");
  console.error("pressure to delete the attribution rule instead of the claim:");
  for (const f of falsePositives) console.error(`  "${f}"`);
  process.exit(1);
}

console.log("");
console.log(`  the planted defect is caught, and ${KNOWN_GOOD.length} honest lines are not`);
process.exit(hits.length > 0 ? 1 : 0);
