import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * R50: A BROWSER IS OPENED IN EXACTLY ONE PLACE (2026-08-18, g16).
 *
 * `lib/log/client.ts` prefers `navigator.sendBeacon`, and Playwright's
 * `extraHTTPHeaders` do not reach a beacon, so a context that does not
 * override `sendBeacon` writes rows that land ORGANIC — our own robots
 * counted as readers in the store this business sells. It fired twice in two
 * days: seven rows on 2026-08-18 (g14), forty-four more the same day (g15).
 * Both times the guard was applied to the contexts that had leaked, and both
 * times the next unguarded context leaked again, because `scripts/` held fifty
 * of them.
 *
 * THE PREDECESSOR OF THIS TEST PROVED THE WRONG THING.
 * `tests/run-marker-coverage.test.ts` asserted that a script MENTIONS
 * `syntheticRunHeaders` in its source. A leaking script passes that: mentioning
 * the constant is not sending it, and the header does not travel on a beacon
 * whatever the source says. It was green through both leaks.
 *
 * So this test asserts a STRUCTURAL fact instead, one a leak cannot satisfy:
 * `scripts/browser.mts` is the only file that constructs a browser or a
 * context, and every other script gets one through `launchGuarded`, which
 * applies the guard as part of construction. `tests/beacon-guard.test.ts` then
 * proves the guard actually works, by running it.
 *
 * A new script cannot open an unguarded context without failing here.
 *
 * ## What `run-marker-coverage.test.ts` asserted that nothing asserts now
 *
 * It was deleted in the same commit as this file, and the deletion is recorded
 * rather than quiet. Two things went with it, and neither is a loss:
 *
 * - Its `RETIRED_SESSION_WALKS` exemption list — twenty-three one-off session
 *   walks kept for their record and excused from declaring themselves. The
 *   exemption is moot now: those scripts are guarded BY CONSTRUCTION, so if one
 *   is ever run again it declares itself without anybody remembering to make it.
 * - Its `covered >= 8` floor. The equivalent floor here counts every script that
 *   comes through the shared site, and it is far higher.
 *
 * One residual obligation is stated because no test carries it: a script that
 * calls `fetch` from NODE (rather than from a page) at production must still
 * pass the run headers by hand — a browser guard cannot reach a request the
 * browser never makes. The old test did not check that either.
 */

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
    usingTheSite >= 40,
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

  // The override, not a delete: g14's first attempt used `delete
  // navigator.sendBeacon`, which removes an own property while the method
  // lives on Navigator.prototype. It type-checked, read correctly, and let
  // four more rows through.
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
