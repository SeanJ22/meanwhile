import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { coverageStatusPill } from "../lib/control-plane/admin-view/coverage.ts";
import { readingCards } from "../lib/control-plane/admin-view/readiness-view.ts";
import { plainCode } from "../lib/control-plane/plain-words.ts";
import { codeOf, sourceFilesUnder } from "./read-code.ts";

/**
 * **WHAT THE STATE READINESS PAGE SAYS** (ADM-39 / ADM-40 / ADM-41, 9.6.26;
 * re-pointed for the Admin redesign, 2026-09-23).
 *
 * A `.tsx` module is asserted here as source text: each claim is a REQUIRED
 * property of the page, and the failure mode is that somebody deletes it or
 * rewrites it into machine speech. The rendering is covered by
 * `tests/admin-readiness-cell-state.test.ts`, which drives Chromium over the
 * stylesheets, and the derivation by `tests/readiness-reader-delivery.test.ts`,
 * which runs the real publisher.
 *
 * Admin redesign, 2026-09-23: the per-state readiness panel — its capability
 * grid with a word in every cell, its reader-delivery block, its summary tiles,
 * its per-ZIP table (population, next step, deploy button) and its own
 * stylesheet — was removed. The redesigned state page draws collection status,
 * five readings with five denominators, and a drilldown from a container to
 * its codes, in the shell's primitives. Each rule below follows the part of
 * the page that now carries it; the rules whose subject left with the panel
 * are retired where they stood.
 */

const ROOT = process.cwd();
const PAGE = "app/(admin)/readiness/[state]/page.tsx";
const ALL_STATES = "app/(admin)/readiness/page.tsx";
const VIEW = "lib/control-plane/admin-view/readiness-view.ts";
const SHELL_CSS = "app/(admin)/_mw/mw.module.css";

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/* ------------------------------------------------------------------ ADM-40 */

// Admin redesign, 2026-09-23: the capability grid (a word in every cell, including the §9A.9 sentence for something live whose proof is stale) and the block naming what the Reader is being served were removed; delivery is now one reading — published meeting versions the typed Reader read back — whose meaning is guarded with ADM-39 below.

test("§9A.1: plainCode keeps the two cell-state words the brief names", () => {
  // Admin redesign, 2026-09-23: the grid cells that reached the face through plainCode, with the raw state on hover, were removed; plainCode's dictionary still speaks for those states wherever the console prints one, so its two named entries stay pinned.
  assert.equal(plainCode("NOT_WALKED"), "Not checked yet");
  assert.equal(plainCode("ARGUED_ABSENT"), "Looked for, does not exist");
});

test("§9A.1: no machine constant leads on the readiness page", () => {
  const found: string[] = [];
  for (const rel of [PAGE, ALL_STATES, VIEW]) {
    const code = codeOf(rel);
    // The literal `NOT_WALKED` used to be printed in the unpublished banner, and
    // the wrong CLI command with it. Neither may return, and no CLI command of
    // any kind belongs on the face (§9A.7).
    if (/<code>[A-Z][A-Z0-9_]+<\/code>/.test(code)) found.push(`${rel}: a raw state constant in <code>`);
    if (/pnpm [a-z:]+/.test(code)) found.push(`${rel}: a command line`);
    if (/readiness-refresh\.mts/.test(code)) found.push(`${rel}: a module name`);
    // "worst-of" is an internal derivation name; "Level 0" is the phrase the gap sentences forbid.
    if (/`worst-of:/.test(code)) found.push(`${rel}: worst-of`);
    if (/"Level 0"/.test(code)) found.push(`${rel}: "Level 0"`);
    // A tag is words, never its enum (the old level tag went through a dictionary of words); a key with its underscores swapped for spaces is still the key (the 9.6.26 owner quote was exactly that).
    for (const m of code.matchAll(/\{[\w.]+\.(type|level|state|status|kind)\.replace\(\/_\/g, " "\)\}/g)) found.push(`${rel}: ${m[0]} prints a machine key with its underscores swapped for spaces`);
  }
  // The drilldown's own tags go through words.
  assert.match(codeOf(PAGE), /BY_WORDS\[by\]\.head/, "the container type is named in words");
  assert.match(codeOf(PAGE), /coverageStatusPill\(b\.coverageStatus\)/, "a body's coverage status is named through the one word map");
  assert.doesNotMatch(codeOf(PAGE), /\{b\.coverageStatus\}/, "and never printed raw");
  for (const status of ["LIVE", "MANUAL", "KNOWN_UNCOVERED", "NO_SOURCE_FOUND", "NOT_ATTEMPTED", "SOMETHING_NEW"]) {
    assert.doesNotMatch(coverageStatusPill(status as never).pill, /_/, `${status} reaches the face as its enum`);
  }
  assert.deepEqual(found, [], "machine constants reach the face of the readiness page");
});

test("POS-18 and the lines the owner asked to keep are still there", () => {
  const page = codeOf(PAGE);
  assert.match(page, /Deploy fleet here/, "POS-18: the Deploy-fleet button left the readiness page");
  // §9A.16: the control is the shared one that explains itself before acting and sends through the typed gateway.
  assert.match(page, /<Link href=\{withScope\("\/admin\/work", scope, \{ geo: /, "Deploy fleet here opens the Work composer with this geography already chosen");
  assert.match(codeOf("app/(admin)/_mw/composer.tsx"), /type: "expansion\.scope\.set"/);
  // MW-028 (2026-09-23): sending now creates what the registry defines and no clock carries, so the page says that instead of "not built yet".
  assert.match(page, /Sending\s+creates the work the registry defines here that no clock carries yet \(bounded per cycle and per geography\)/, "and the page says what sending does");
  // Admin redesign, 2026-09-23: the per-ZIP rows that carried the "Nobody has looked yet" line and the per-card "Needs you" answer were removed; bodies never walked are counted apart in the Coverage reading and in every code's row.
  assert.match(codeOf(VIEW), /have never been walked/);
});

/* ------------------------------------------------------------------ ADM-39 */

test("ADM-39: no reading renders a bare dash as though it were a metric", () => {
  // Admin redesign, 2026-09-23: the summary tiles became the five readings; an unfilled reading is the dashed pill with its own words.
  const cards = readingCards({ stateName: "Arizona", coverage: null, coverageGap: null, registryVersion: null, grid: null, contract: null, freshness: null, gates: null, observedAt: "now" });
  assert.equal(cards.length, 5, "five readings, five denominators");
  for (const c of cards) {
    assert.equal(c.fig, null, `${c.name}: an unread input must not produce a figure`);
    assert.ok(/^[A-Z][A-Z ]+$/.test(c.unknown), `${c.name}: an unfilled reading must say what it is in words, not "${c.unknown}"`);
    assert.ok(c.note.length > 20, `${c.name}: an unfilled reading still says why`);
  }
  const page = codeOf(PAGE);
  assert.match(page, /<Fig value=\{r\.fig\} tone=\{r\.tone\} unknown=\{r\.unknown\} \/>/, "the page hands each reading's words to the figure slot");
  assert.match(codeOf("app/(admin)/_mw/ui.tsx"), /if \(value === null \|\| value === undefined\) return <Dash>\{unknown\}<\/Dash>;/, "a null figure renders its words in the dashed pill");
  assert.doesNotMatch(codeOf(VIEW), /fig: "—"|fig: "-"/, "a reading figure is never the literal dash");
  // The two tiles that could never hold a value stay gone.
  for (const rel of [PAGE, VIEW]) {
    assert.doesNotMatch(src(rel), /Reader-visible jurisdictions/);
    assert.doesNotMatch(src(rel), /Since the last full pass/);
  }
});

/* ------------------------------------------------------------------ ADM-41 */

// Admin redesign, 2026-09-23: the per-ZIP table and its population sentence (source, vintage and geography named on the face) were removed; the redesigned page draws no population.

test("ADM-41: every per-code figure the readiness page draws is inside its own number audit", () => {
  const page = codeOf(PAGE);
  // Admin redesign, 2026-09-23: the per-ZIP population and the "capabilities served to readers" tile were removed; the readings and the drilldown's per-container and per-code rows are what the page draws now.
  for (const label of ["bodies with a way in", "requirement checks current", "fresh meeting sources", "read back", "gates passing"]) {
    assert.match(page, new RegExp(`numbers\\.push\\(\\{ label: "${label}"`), `the ${label} reading is outside the audit`);
  }
  assert.match(page, /numbers\.push\(\{ label: `\$\{r\.c\.geography\.geoid\} way in`/, "each container's way-in share is audited");
  assert.match(page, /open\.standing\.perCode\.map\(/, "the guard must see the per-code rows");
  const unaudited: string[] = [];
  if (!/numbers\.push\([^;]*zcta5/.test(page)) {
    unaudited.push("an opened container draws each code's way-in share and body counts, and none of them is pushed into the page's numbers");
  }
  // One code's view counts its bodies into `counts` (not a container's `standing.counts`).
  if (!/numbers\.push\([^;]*(?<![\w.])counts\.wayIn/.test(page)) {
    unaudited.push("one code's view draws its bodies and way-in count with an empty number audit");
  }
  assert.deepEqual(unaudited, [], "a wrong per-code figure would pass the page's own audit untouched");
});

/* ------------------------------------------------------------------ styles */

test("the page's stylesheet carries the classes its markup uses", () => {
  // Admin redesign, 2026-09-23: the panel's own stylesheet was removed; the readiness pages, like every redesigned screen, draw with the shell's CSS module, where a class key nobody declared renders as a class named "undefined".
  const css = src(SHELL_CSS);
  const declared = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  const users = sourceFilesUnder([".tsx"], "app", "(admin)")
    .map((abs) => relative(ROOT, abs).split(sep).join("/"))
    .filter((rel) => /from "[./]*(_mw\/)?mw\.module\.css"|\bmw as s\b/.test(src(rel)));
  assert.ok(users.includes(PAGE) && users.includes(ALL_STATES), "the sweep must reach the readiness pages");
  const missing: string[] = [];
  for (const rel of users) {
    for (const m of codeOf(rel).matchAll(/\bs\.([a-zA-Z_]\w*)\b/g)) if (!declared.has(m[1])) missing.push(`${rel}: s.${m[1]}`);
  }
  assert.deepEqual([...new Set(missing)], [], "these classes are rendered with no rule to style them");
});
