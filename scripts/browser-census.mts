/**
 * Who opens a browser in this repo: every source file lands in exactly one
 * bucket, and the buckets sum to the total.
 *
 *   corepack pnpm exec tsx scripts/browser-census.mts
 *
 * It walks every source file (scripts, `.mjs`, tests, libraries), and
 * `tests/browser-construction.test.ts` imports `census()` from here, so the
 * guard and the report cannot disagree about the population.
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
 * Files whose constructor match is not a call (a regex literal, say), each
 * with its reason; named rather than filtered out quietly.
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
