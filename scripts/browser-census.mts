/**
 * WHO OPENS A BROWSER IN THIS REPO — the denominator, established rather than
 * remembered (g17, 2026-08-18, item 4a).
 *
 * Three different numbers have been in circulation for the same population.
 * R50's own header says `scripts/` held FIFTY browser contexts, ten guarded and
 * forty not. The g16 brief repeated fifty. The g16 report said forty-five
 * scripts came through the shared site. Five were unaccounted for, and five
 * unexplained scripts is not a rounding difference — it is exactly the size of
 * a hole, and the guard this replaced was green through two live leaks while
 * inspecting the wrong thing.
 *
 * THEY RECONCILE, AND THE RECONCILIATION IS THE FINDING, computed from the tree
 * rather than argued:
 *
 *   50 = `.newContext(` CALL SITES in scripts/ before R50 (`3408d4c^`). A
 *        script may open several contexts, so this counts contexts.
 *   45 = FILES in scripts/ holding a raw constructor at the same commit. This
 *        is what g16's report counted, and it is also correct.
 *   46 = files coming through `launchGuarded` at `main@57b15bc` — all 45 of
 *        the above, converted, plus `scripts/probe-m135.mts`, which was CREATED
 *        in the R50 commit itself and so never held a raw constructor.
 *
 * Nothing was missing. Fifty counted contexts and forty-five counted files, and
 * the set difference between the before and after populations is exactly one
 * new file, named above. Reproduce it:
 *
 *   git grep -cE "\.newContext\(" 3408d4c^ -- scripts/
 *   git grep -lE "chromium\.launch\(|\.newContext\(|browser\.newPage\(" 3408d4c^ -- scripts/
 *   git grep -l 'browser\.mts"' 57b15bc -- scripts/
 *
 * ## What this file is for from here on
 *
 * The count is now computed, with every file landing in exactly one bucket and
 * the buckets summing to the total. Run it:
 *
 *   corepack pnpm exec tsx scripts/browser-census.mts
 *
 * It scans WIDER than `tests/browser-construction.test.ts` used to, on purpose.
 * That test read `scripts/*.mts` only, and a hole in a guard is most likely to
 * be exactly where the guard never looks: a `.mjs` script, a test, a library
 * file. This walks every source file in the repo and asks each one whether it
 * makes a browser — and the test now imports `census()` from here, so the guard
 * and the report cannot disagree about the population.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".scratch",
  "screenshots",
  "public",
  "data",
]);
const EXTS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"];

/**
 * Files whose CONSTRUCTOR MATCH IS NOT A CALL, each with its reason.
 *
 * This census is a text scan, not a parser, so a file holding the pattern
 * inside a regex literal reads identically to one calling it. Two files do,
 * and both are named here rather than filtered out quietly — a census that
 * silently drops rows is how a denominator goes wrong in the first place.
 */
export const NOT_A_CALL = new Map<string, string>([
  [
    "tests/browser-construction.test.ts",
    "holds the constructor patterns as regex literals — it is the guard doing the scanning",
  ],
  ["scripts/browser-census.mts", "this file; it holds the same patterns to scan with"],
]);

/**
 * The one file allowed to construct a raw browser, and why.
 *
 * `tests/beacon-guard.test.ts` builds a context the unguarded way as its second
 * test — the PERMANENT PLANT that must keep leaking. A guard proven only
 * against the guarded path proves nothing about the path it guards against.
 */
export const RAW_CONSTRUCTION_ALLOWED = new Map<string, string>([
  [
    "tests/beacon-guard.test.ts",
    "the permanent plant: it builds an unguarded context on purpose, and that context must keep leaking or the guard is obsolete",
  ],
]);

/** Every way to construct a browser or a context that skips the shared site. */
const RAW_CONSTRUCTORS = [
  /\bchromium\s*\.\s*launch\s*\(/,
  /\bfirefox\s*\.\s*launch\s*\(/,
  /\bwebkit\s*\.\s*launch\s*\(/,
  /\.\s*launchPersistentContext\s*\(/,
  /\bbrowser\s*\.\s*newPage\s*\(/,
  /\bbrowser\s*\.\s*newContext\s*\(/,
];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(p, out);
    } else if (EXTS.some((x) => e.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

export type Bucket =
  | "the shared site"
  | "guarded — comes through launchGuarded"
  | "raw construction, allowed and named"
  | "named exception — the pattern is not a call"
  | "constructs its own browser"
  | "imports playwright but constructs nothing"
  | "no browser";

export interface CensusRow {
  file: string;
  bucket: Bucket;
  note: string;
}

/**
 * The census, as data. `tests/browser-construction.test.ts` imports this so the
 * guard and the report cannot disagree about who opens a browser.
 */
export async function census(root: string = ROOT): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];

  for (const abs of await walk(root)) {
    const file = relative(root, abs).replace(/\\/g, "/");
    const src = await readFile(abs, "utf8");

    const importsPlaywright =
      /from "playwright"|from 'playwright'|require\("playwright"\)/.test(src);
    const usesSite = /from "[^"]*browser\.mts"/.test(src);
    const constructs = RAW_CONSTRUCTORS.some((re) => re.test(src));

    if (file === "scripts/browser.mts") {
      rows.push({ file, bucket: "the shared site", note: "defines launchGuarded" });
    } else if (NOT_A_CALL.has(file)) {
      rows.push({
        file,
        bucket: "named exception — the pattern is not a call",
        note: NOT_A_CALL.get(file)!,
      });
    } else if (constructs && RAW_CONSTRUCTION_ALLOWED.has(file)) {
      rows.push({
        file,
        bucket: "raw construction, allowed and named",
        note: RAW_CONSTRUCTION_ALLOWED.get(file)!,
      });
    } else if (constructs) {
      rows.push({
        file,
        bucket: "constructs its own browser",
        note: "calls a raw Playwright constructor",
      });
    } else if (usesSite) {
      rows.push({ file, bucket: "guarded — comes through launchGuarded", note: "" });
    } else if (importsPlaywright) {
      rows.push({
        file,
        bucket: "imports playwright but constructs nothing",
        note: "types only, or drives a page handed to it",
      });
    } else {
      rows.push({ file, bucket: "no browser", note: "" });
    }
  }

  return rows;
}

export const BUCKET_ORDER: Bucket[] = [
  "the shared site",
  "guarded — comes through launchGuarded",
  "raw construction, allowed and named",
  "named exception — the pattern is not a call",
  "constructs its own browser",
  "imports playwright but constructs nothing",
];

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/browser-census.mts")) {
  const rows = await census();
  const byBucket = new Map<Bucket, CensusRow[]>();
  for (const r of rows) {
    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
    byBucket.get(r.bucket)!.push(r);
  }

  console.log(`browser census — ${rows.length} source file(s) scanned under ${ROOT}\n`);
  let accounted = 0;
  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket) ?? [];
    accounted += list.length;
    console.log(`${bucket}: ${list.length}`);
    for (const r of list) console.log(`  ${r.file}${r.note ? ` — ${r.note}` : ""}`);
    console.log("");
  }
  const none = byBucket.get("no browser")?.length ?? 0;
  console.log(`no browser: ${none}`);
  console.log(
    `\nTOTAL ${accounted + none} = ${accounted} browser-touching + ${none} not.\n` +
      "Every scanned file is in exactly one bucket; the buckets sum to the total.",
  );

  const offenders = byBucket.get("constructs its own browser") ?? [];
  if (offenders.length > 0) {
    console.error(
      "\nUNGUARDED BROWSER CONSTRUCTION — every context this makes writes rows\n" +
        "that land ORGANIC in the store this business sells:",
    );
    for (const r of offenders) console.error(`  ${r.file}`);
    process.exit(1);
  }
}
