/**
 * `pnpm sweep:refusal` — **every place the product DECLINES rather than
 * describes, found by SHAPE rather than by string.** (Item 1, 2026-08-23.)
 *
 * ## Why a shape and not a grep
 *
 * On 2026-08-23 a session reported the *"we haven't read the law"* refusal gone
 * from the repo. It had grepped one string. The copy was alive in
 * `lib/ballot/battlecard-sections.ts` under different wording, on the FIRST and
 * MANDATORY section of every candidate card — so while the product counted 214
 * bodies with no definition, every candidate on every ballot opened with the
 * app declining to describe the office they were running for.
 *
 * **The first report was not dishonest. It was searched in the wrong FORM.**
 * That is RULING 100 in a new place: a search returning nothing has told you
 * about the search, not about the repo, unless it can show it looked in the
 * shape the thing actually takes.
 *
 * ## The three shapes, and the one thing that separates a refusal from a gap
 *
 * A REFUSAL and a NAMED GAP use nearly the same words. The difference is what
 * comes after:
 *
 * - **A named gap** says what we have not got and then hands over what we
 *   have. *"We haven't yet read the law that says what this office decides.
 *   What we do hold about it is below."* That is required by the
 *   render-default rule and must never be removed.
 * - **A refusal** says what we have not got and STOPS — or, worse, states an
 *   intention not to tell. *"...so we're not going to describe it."*
 *
 * So the shapes are refusal-specific and none of them fires on an honest gap:
 *
 * 1. **DECLARED INTENT NOT TO TELL** — "so we can't describe it here", "we're
 *    not going to describe", "we won't say", "there is nothing we can tell
 *    you". A statement about what the product will not do.
 * 2. **A CAPABILITY DENIAL ABOUT THE SUBJECT** — "can't describe", "cannot
 *    explain", "unable to summarise", where the object is the thing the
 *    reader asked about rather than a distinction we are declining to draw.
 * 3. **A TERMINAL APOLOGY** — a sentence whose whole content is that we have
 *    nothing, with no clause handing the reader anything else.
 *
 * Shape 3 is judged, not matched: a candidate is any reader-facing string in
 * the deny-shape whose text carries no second clause. Those are printed for a
 * human to read rather than failed automatically, because the line between
 * "nothing here" and "nothing here, look there" is a reading.
 *
 * ```
 * pnpm sweep:refusal
 * ```
 *
 * Exit code 1 if any shape-1 or shape-2 hit survives, so the sweep is a gate
 * rather than a report. `tests/refusal-copy.test.ts` runs the same shapes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { REFUSAL_SHAPES, refusalHitsIn } from "../lib/text/refusal-shapes.ts";

const ROOT = process.cwd();
const ROOTS = ["app", "components", "lib", "data"];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r), []));
let hits = 0;

console.log(`\nrefusal-copy sweep — ${files.length} files under ${ROOTS.join(", ")}\n`);
console.log(`shapes searched (${REFUSAL_SHAPES.length}):`);
for (const s of REFUSAL_SHAPES) console.log(`  ${s.id.padEnd(24)} ${s.what}`);
console.log("");

for (const file of files) {
  const found = refusalHitsIn(readFileSync(file, "utf8"));
  for (const hit of found) {
    hits++;
    console.log(`  ${relative(ROOT, file)}:${hit.line}  [${hit.shape}]`);
    console.log(`    ${hit.text}`);
  }
}

console.log(`\n  N found: ${hits}\n`);
if (hits > 0) process.exit(1);
