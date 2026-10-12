import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import {
  census,
  RAW_CONSTRUCTION_ALLOWED,
  type Bucket,
} from "../scripts/browser-census.mts";
import { join } from "node:path";

/** A browser is opened in exactly one place: scripts/browser.mts constructs every browser and context, and every other script gets one through launchGuarded, which applies the beacon guard as part of construction. A script calling fetch from Node must still pass the run headers by hand. */

const SITE = "browser.mts";

/** Ways to make a browser or a context that skip the shared site. */
const CONSTRUCTORS = [
  { name: "chromium.launch", re: /\bchromium\s*\.\s*launch\s*\(/ },
  { name: "firefox.launch", re: /\bfirefox\s*\.\s*launch\s*\(/ },
  { name: "webkit.launch", re: /\bwebkit\s*\.\s*launch\s*\(/ },
  { name: "launchPersistentContext", re: /\.\s*launchPersistentContext\s*\(/ },
  {
    // `context.newPage()` is fine — the context is already guarded. It is
    // `browser.newPage()` that mints an unguarded context of its own, and the
    // two read almost identically, which is exactly why this is a test and not
    // a convention.
    name: "browser.newPage",
    re: /\bbrowser\s*\.\s*newPage\s*\(/,
  },
  { name: "browser.newContext", re: /\bbrowser\s*\.\s*newContext\s*\(/ },
];

test("scripts/browser.mts is the only place a browser is constructed", async () => {
  const dir = join(process.cwd(), "scripts");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mts"));
  assert.ok(files.length > 20, `expected the scripts directory, found ${files.length}`);

  const offenders: string[] = [];
  let usingTheSite = 0;
  let noBrowser = 0;

  for (const file of files) {
    const src = await readFile(join(dir, file), "utf8");
    if (file === SITE) continue;

    const usesGuard = /from "\.\/browser\.mts"/.test(src);
    if (usesGuard) usingTheSite += 1;
    else if (!/from "playwright"/.test(src)) {
      noBrowser += 1;
      continue;
    }

    for (const c of CONSTRUCTORS) {
      if (c.re.test(src)) offenders.push(`${file} — ${c.name}`);
    }
  }

  /* The denominator, stated: a guard reporting "0 offenders" while inspecting
   * nothing is the empty success this repo has a rule about. */
  assert.ok(
    usingTheSite >= 13,
    `expected the browser scripts to come through scripts/${SITE}, only ${usingTheSite} do ` +
      `(${noBrowser} script(s) drive no browser at all)`,
  );

  assert.deepEqual(
    offenders,
    [],
    `these scripts construct a browser or a context outside scripts/${SITE} (R50) — ` +
      "a context made anywhere else carries no run marker on a sendBeacon, and its rows " +
      `land ORGANIC in the store we sell. Use launchGuarded from ./${SITE}.`,
  );
});

test("the shared site guards every context it makes", async () => {
  const src = await readFile(join(process.cwd(), "scripts", SITE), "utf8");

  // The override, not a delete: sendBeacon lives on Navigator.prototype, so deleting an own property removes nothing.
  assert.match(
    src,
    /Object\.defineProperty\(navigator, "sendBeacon"/,
    "the shared site must OVERRIDE sendBeacon; `delete` is a no-op on a prototype method",
  );
  assert.doesNotMatch(
    src,
    /delete\s+navigator\.sendBeacon/,
    "`delete navigator.sendBeacon` is the no-op that let four rows through in g14",
  );
  assert.match(
    src,
    /addInitScript/,
    "the override must be installed BEFORE the page's first script runs",
  );
  // Every context, not just the first: the page shortcut must route through the
  // guarded constructor rather than reaching for the raw browser.
  assert.match(
    src,
    /async page\([^)]*\)[^{]*\{[\s\S]{0,200}await guardedContext\(/,
    "the page() shortcut must build its context through guardedContext",
  );
  // The one raw construction in the tree sits inside the guarded constructor,
  // with the marker and the override applied to what it returns.
  assert.match(
    src,
    /async function guardedContext\([\s\S]{0,600}?await browser\.newContext\(/,
    "the raw construction must live inside guardedContext, where the guard is applied",
  );
});

/** The same question, asked of the whole tree: scripts/browser-census.mts puts every source file in exactly one bucket, and the one file allowed to construct raw must use its allowance. */

test("nothing anywhere in the repo constructs a browser outside the shared site", async () => {
  const rows = await census();
  const bucket = (b: Bucket) => rows.filter((r) => r.bucket === b);

  /* The denominator, stated. A repo-wide scan that found nothing to inspect
   * would pass loudest exactly when it had stopped working. */
  assert.ok(rows.length > 300, `expected the whole tree, scanned ${rows.length} file(s)`);
  const guarded = bucket("guarded — comes through launchGuarded");
  assert.ok(
    guarded.length >= 19,
    `only ${guarded.length} file(s) come through the shared site — the population shrank`,
  );
  assert.equal(bucket("the shared site").length, 1, "scripts/browser.mts is missing");

  assert.deepEqual(
    bucket("constructs its own browser").map((r) => r.file),
    [],
    "these files construct a browser or a context outside scripts/browser.mts (R50) — " +
      "a context made anywhere else carries no run marker on a sendBeacon, and its rows " +
      "land ORGANIC in the store we sell. Use launchGuarded, or name the file in " +
      "RAW_CONSTRUCTION_ALLOWED with the reason it must not be guarded.",
  );

  /* Every named allowance is used, and every use is named. An exemption list
   * that outlives the thing it exempts is a hole with paperwork. */
  const allowed = bucket("raw construction, allowed and named").map((r) => r.file);
  assert.deepEqual(
    allowed.sort(),
    [...RAW_CONSTRUCTION_ALLOWED.keys()].sort(),
    "a file is named as an allowed raw construction but no longer constructs one, " +
      "or the reverse",
  );

  /* Buckets partition the population: nothing counted twice, nothing dropped. */
  const counted = rows.length;
  const summed = [
    "the shared site",
    "guarded — comes through launchGuarded",
    "raw construction, allowed and named",
    "named exception — the pattern is not a call",
    "constructs its own browser",
    "imports playwright but constructs nothing",
    "no browser",
  ].reduce((n, b) => n + bucket(b as Bucket).length, 0);
  assert.equal(summed, counted, "the census buckets do not sum to the files scanned");

  console.log(
    `browser census: ${counted} file(s) — ${guarded.length} guarded, ` +
      `${allowed.length} allowed raw, ${bucket("named exception — the pattern is not a call").length} pattern-not-a-call, ` +
      `0 unguarded`,
  );
});
