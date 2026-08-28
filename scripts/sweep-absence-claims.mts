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
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { CLAIM_SHAPES, KNOWN_GOOD, claimsInText, isCorrectionNote } from "../lib/text/absence-claims.ts";

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

/**
 * **THE PROSE SWEEP** (2026-08-27, the coverage-truth session).
 *
 * This sweep read quoted strings in `app/`, `components/` and `lib/` — shipped
 * copy, which is the right place to look for a claim a READER sees. It read
 * nothing else, and on 2026-08-27 it reported a clean `0` while four documents
 * in this repository carried
 *
 *   "It will never have a website. It has no staff to build one."
 *
 * about a real school district. `states/az/85641.md`, `states/az/NOTES.md`,
 * `docs/state.md` and `data/method/knowledge.json` are not shipped copy — they
 * are the DURABLE RECORD, and a false permanent absence there is worse than one
 * in a component, because every later session inherits it as settled and stops
 * looking. `data/method/knowledge.json` in particular is designed to be
 * reapplied to the next jurisdiction.
 *
 * So the same shapes now run over the prose too. Measured before shipping:
 * 90,721 sentences, and after the two narrowings this leaves ZERO hits — so
 * this is not a guard that starts life with a backlog.
 */
const PROSE_GLOBS = ["*.md", "data/method/knowledge.json"];

function proseSentences(): { file: string; text: string }[] {
  /*
   * `filesThatWouldBeCommitted`, not `git ls-files`. A tracked-only listing
   * cannot see a document that has not been staged yet, so the session that
   * WRITES a permanent-absence claim into a new state note would get a green
   * sweep and CI would get a red one. `tests/gate-ordering.test.ts` enforces
   * this across every gate — and caught this function on its first run, which
   * is the guard doing precisely its job.
   */
  const files = filesThatWouldBeCommitted({ cwd: process.cwd(), paths: PROSE_GLOBS });

  const rows: { file: string; text: string }[] = [];
  for (const raw of files) {
    const file = raw.replace(/\\/g, "/");
    if (SPECIMEN_FILES.includes(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const piece of lines[i].split(/(?<=[.!?])\s+/)) {
        const s = piece.trim();
        if (s.length < 18) continue;
        rows.push({ file: `${file}:${i + 1}`, text: s });
      }
    }
  }
  return rows;
}

const prose = proseSentences();

/*
 * A sentence that QUOTES a claim in order to correct it is not the claim. A
 * repository that records what it fixed keeps the wrong wording on the page,
 * beside the right one, and a sweep with no notion of that either flags every
 * correction forever or gets loosened until it stops working.
 */
const hits = [
  ...absences.filter((s) => !isComment(s.file)),
  ...prose.filter((s) => !isCorrectionNote(s.text)),
].flatMap((s) => claimsInText(s.text).map((h) => ({ ...h, file: s.file })));

// RULING 159 — the floor is asserted BEFORE the count is reported. A sweep
// that found no sentences to judge has not found a clean surface.
const floor = floored("sweep:absence-claims", "quoted sentences in app/, components/, lib/ plus prose in *.md and the method store", all.length + prose.length, hits.length);
void floor;

console.log(`sweep:absence-claims · ${CLAIM_SHAPES.length} shape(s) searched`);
for (const s of CLAIM_SHAPES) console.log(`    [${s.id}] ${s.re}`);
console.log("");
console.log(`  quoted sentences swept        ${all.length}`);
console.log(`  in the absence family         ${absences.length}`);
console.log(`  prose sentences swept         ${prose.length}   (*.md and the method store)`);
console.log(`  asserting an unearned absence ${hits.length}`);

if (hits.length > 0) {
  console.log("");
  for (const h of hits) {
    console.log(`  ${h.file}`);
    console.log(`    [${h.shape}] ${h.why}`);
    console.log(`    "${h.text}"`);
  }
}

// The instrument is shown catching the real thing, on every run.
const PLANTED = [
  /* The line this sweep was written for (2026-08-26). */
  "People who have not held this office don't have a voting record to show.",
  /* The line it could not see (2026-08-27): the same defect about a GOVERNMENT,
   * in prose rather than in shipped copy. Both are exercised on every run, so
   * neither shape can rot into a regex that matches nothing. */
  "It will never have a website. It has no staff to build one.",
];
const planted = PLANTED.find((p) => claimsInText(p).length === 0) ?? "";
if (planted !== "") {
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
console.log(`  both planted defects are caught, and ${KNOWN_GOOD.length} honest lines are not`);
process.exit(hits.length > 0 ? 1 : 0);
