import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  rawMotionInCss,
  rawMotionInSource,
  reducedMotionFloorPresent,
} from "../lib/design/motion.ts";
import { sourceFilesUnder } from "../lib/ops/repo-files.ts";

const ROOT = join(import.meta.dirname, "..");
const GLOBALS = join(ROOT, "app", "globals.css");

/**
 * One motion scale, and reduced motion honored: every transition and animation moves on `--dur-*` / `--ease-*`, and
 * the reduced-motion floor honors an OS request for less motion everywhere.
 */

test("the motion sweep catches a raw duration — the instrument works", () => {
  // PLANT: the exact shape the sweep exists to catch.
  const planted = ".x { transition: transform 0.2s ease; }";
  const hits = rawMotionInCss(planted);
  assert.equal(hits.length, 1, "a raw 0.2s transition must be flagged");
  assert.equal(hits[0].raw, "0.2s");

  // KNOWN GOOD: the same declaration written on the scale is silent.
  assert.equal(
    rawMotionInCss(".x { transition: transform var(--dur-base) var(--ease-move); }").length,
    0,
    "a tokenized transition must not be flagged",
  );

  // The reduced-motion instant is motion turned off, not a raw value.
  assert.equal(
    rawMotionInCss("@media (prefers-reduced-motion: reduce){*{transition-duration:0.01ms}}").length,
    0,
    "the reduced-motion instant is permitted",
  );

  // The longhand escape path is closed too.
  assert.equal(
    rawMotionInCss(".x { transition-duration: 300ms; }").length,
    1,
    "a raw longhand transition-duration must be flagged",
  );

  // A source-level Tailwind arbitrary duration is caught.
  assert.equal(
    rawMotionInSource('<div className="duration-[250ms]" />').length,
    1,
    "a Tailwind arbitrary duration must be flagged",
  );
  assert.equal(
    rawMotionInSource('<div className="transition-colors duration-fast" />').length,
    0,
    "a named duration utility must not be flagged",
  );
});

test("app/globals.css carries no raw duration in any transition or animation", () => {
  const css = readFileSync(GLOBALS, "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  const offenders = rawMotionInCss(css);
  assert.deepEqual(
    offenders,
    [],
    `raw motion literals in globals.css (tokenize with --dur-*):\n` +
      offenders.map((o) => `  L${o.line}: ${o.raw} — ${o.text}`).join("\n"),
  );
});

test("the global reduced-motion floor is present in app/globals.css", () => {
  const css = readFileSync(GLOBALS, "utf8");
  assert.ok(
    reducedMotionFloorPresent(css),
    "expected a @media (prefers-reduced-motion: reduce) block reaching * and neutralizing animation/transition duration",
  );
});

test("no reader-facing component hardcodes a raw duration", () => {
  const files = sourceFilesUnder(ROOT, ["app", "components"]);
  assert.ok(files.length > 50, `expected the sweep to reach the tree, saw ${files.length} files`);
  const offenders: { file: string; line: number; raw: string }[] = [];
  for (const file of files) {
    for (const hit of rawMotionInSource(readFileSync(join(ROOT, file), "utf8"))) {
      offenders.push({ file, line: hit.line, raw: hit.raw });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `raw motion in components (use transition-*/duration-fast|base|slow):\n` +
      offenders.map((o) => `  ${o.file}:${o.line} — ${o.raw}`).join("\n"),
  );
});
