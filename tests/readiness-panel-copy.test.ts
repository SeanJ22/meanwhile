import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { coverageStatusPill } from "../lib/control-plane/admin-view/coverage.ts";
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
const SHELL_CSS = "app/(admin)/_mw/admin-v6/v6.module.css";

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
  for (const status of ["LIVE", "MANUAL", "KNOWN_UNCOVERED", "NO_SOURCE_FOUND", "NOT_ATTEMPTED", "SOMETHING_NEW"]) {
    assert.doesNotMatch(coverageStatusPill(status as never).pill, /_/, `${status} reaches the face as its enum`);
  }
});

/* ------------------------------------------------------------------ styles */

test("the page's stylesheet carries the classes its markup uses", () => {
  // Admin redesign, 2026-09-23: the panel's own stylesheet was removed; the readiness pages, like every redesigned screen, draw with the shell's CSS module, where a class key nobody declared renders as a class named "undefined".
  const css = src(SHELL_CSS);
  const declared = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  const users = sourceFilesUnder([".tsx"], "app", "(admin)")
    .map((abs) => relative(ROOT, abs).split(sep).join("/"))
    .filter((rel) => /from "[./]*(?:admin-v6\/)?v6\.module\.css"/.test(src(rel)));
  const missing: string[] = [];
  for (const rel of users) {
    for (const m of codeOf(rel).matchAll(/\bs\.([a-zA-Z_]\w*)\b/g)) if (!declared.has(m[1]) && !declared.has("legacy" + m[1][0].toUpperCase() + m[1].slice(1))) missing.push(`${rel}: s.${m[1]}`);
  }
  assert.deepEqual([...new Set(missing)], [], "these classes are rendered with no rule to style them");
});
