import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { sourceFilesUnder } from "../lib/ops/repo-files.ts";
import {
  KNOWN_GOOD,
  REFUSAL_SHAPES,
  refusalHitsIn,
} from "../lib/text/refusal-shapes.ts";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["app", "components", "lib", "data"];

/**
 * **Item 1, 2026-08-23 — the refusal-copy class, gated by SHAPE.**
 *
 * The 8/23 session reported the *"we haven't read the law"* refusal gone from
 * the repo. It had grepped one string. The copy was alive in
 * `lib/ballot/battlecard-sections.ts`, under different wording, on the FIRST
 * and MANDATORY section of every candidate card — so while the product counted
 * 214 bodies with no definition, every candidate on every ballot opened with
 * the app declining to describe the office they were standing for.
 *
 * That report was not dishonest; it searched in the wrong FORM. This is the
 * instrument that makes the same mistake impossible: three shapes, matched
 * against string literals across every reader-facing root, gating the build.
 */

test("no refusal copy survives anywhere a reader can reach", () => {
  // RULING 103: the shared walker, which reads what would be COMMITTED rather
  // than what is on disk. Four copies of a hand-rolled recursion were what the
  // duplicate sweep caught here — `lib/ops/repo-files.ts` carries the account.
  const files = sourceFilesUnder(ROOT, ROOTS);
  assert.ok(files.length > 300, `expected the sweep to reach the tree, saw ${files.length} files`);

  const hits: string[] = [];
  for (const file of files) {
    for (const hit of refusalHitsIn(readFileSync(join(ROOT, file), "utf8"))) {
      hits.push(`${file}:${hit.line} [${hit.shape}] ${hit.text}`);
    }
  }
  assert.deepEqual(hits, [], `refusal copy found:\n${hits.join("\n")}`);
});

test("the shapes catch the two refusals this product actually shipped", () => {
  // Verbatim, from `lib/officials/body-definitions.ts` and
  // `lib/ballot/battlecard-sections.ts`. A guard that cannot catch the defect
  // it was written for is a guard that reports green about nothing.
  const shipped = [
    'const a = "We haven\'t yet read the law that defines what this body can decide, so we\'re not going to describe it.";',
    'const b = "We haven\'t read the law that says what this office does, so we can\'t describe it here.";',
  ];
  for (const line of shipped) {
    assert.ok(refusalHitsIn(line).length > 0, `shape missed a shipped refusal: ${line}`);
  }
});

test("no honest named gap is ever flagged as a refusal", () => {
  /*
   * The render-default rule REQUIRES a null to render as its named gap. If a
   * shape matched one of these, the guard would be pressure to delete the
   * attribution rule rather than to enforce it — so this is the half of the
   * test that protects the copy rather than removing it.
   */
  for (const good of KNOWN_GOOD) {
    const line = `const line = ${JSON.stringify(good)};`;
    assert.deepEqual(refusalHitsIn(line), [], `honest gap flagged as a refusal: ${good}`);
  }
});

test("every shape states in plain words what it looks for", () => {
  assert.ok(REFUSAL_SHAPES.length >= 3);
  for (const shape of REFUSAL_SHAPES) {
    assert.ok(shape.what.length > 20, `shape ${shape.id} has no plain-words description`);
  }
});

test("comments are never swept, so recording a fix cannot become a defect", () => {
  const withComment = [
    "/*",
    " * This used to read: so we're not going to describe it.",
    " */",
    'const ok = "Nothing here.";',
  ].join("\n");
  assert.deepEqual(refusalHitsIn(withComment), []);
});
