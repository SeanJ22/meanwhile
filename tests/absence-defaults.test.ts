import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { sourceFilesUnder } from "../lib/ops/repo-files.ts";
import { RENDER_ROOTS, absenceDefaultsIn, readerCopyViolations } from "../lib/text/absence-defaults.ts";

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "tests", "absence-defaults.json");

/**
 * **Item 3, 2026-08-23 — the absence-to-assertion class, made impossible
 * rather than fixed one instance at a time.**
 *
 * Three named instances, one shape: JUR-1's card asserting *"Governs your
 * area"* beside *"Boundary not published"*; JUR-4's ballot annotating a
 * congressional district as partial when the certainty was `UNKNOWN`; and
 * `cand.partyLabel ?? "No party label filed"`, which stated a fact about a
 * named candidate's FILING out of a null that usually meant nobody had
 * collected it.
 *
 * The baseline ONLY SHRINKS. A new sentence-shaped default fails this test,
 * and making it pass means either fixing the default or writing down, in the
 * baseline, why it is not a claim — which is a diff a reviewer can see.
 */

interface Entry {
  file: string;
  text: string;
  reason: string;
}

function sweep(): { file: string; text: string }[] {
  // RULING 103: the shared walker — see `lib/ops/repo-files.ts`.
  const files = sourceFilesUnder(ROOT, RENDER_ROOTS);
  assert.ok(files.length > 50, `expected the sweep to reach the tree, saw ${files.length} files`);
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    for (const hit of absenceDefaultsIn(readFileSync(join(ROOT, file), "utf8"))) {
      out.push({ file, text: hit.text });
    }
  }
  return out;
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as { entries: Entry[] };
const keyOf = (e: { file: string; text: string }) => `${e.file} :: ${e.text}`;

test("no unrecorded sentence-shaped render default exists", () => {
  const recorded = new Set(baseline.entries.map(keyOf));
  const unrecorded = sweep().filter((f) => !recorded.has(keyOf(f)));
  assert.deepEqual(
    unrecorded,
    [],
    `unrecorded absence-to-assertion defaults:\n${unrecorded
      .map((u) => `  ${u.file}  "${u.text}"`)
      .join("\n")}`,
  );
});

test("every baseline entry carries a reason, and none is a placeholder", () => {
  for (const entry of baseline.entries) {
    assert.ok(
      entry.reason.trim().length > 40,
      `baseline entry has no real reason: ${keyOf(entry)}`,
    );
  }
});

test("the baseline only shrinks — a recorded entry that is gone must be removed", () => {
  const found = new Set(sweep().map(keyOf));
  const stale = baseline.entries.filter((e) => !found.has(keyOf(e)));
  assert.deepEqual(
    stale.map(keyOf),
    [],
    "these baseline entries no longer exist; run `pnpm sweep:absence-defaults --write`",
  );
});

test("the shape catches every instance the class was named from", () => {
  const shipped = [
    '  {cand.partyLabel ?? "No party label filed"}',
    '  const detail = claim ?? "Governs your area";',
    '  const v = position ?? "Did not vote";',
  ];
  for (const line of shipped) {
    assert.ok(absenceDefaultsIn(line).length > 0, `shape missed: ${line}`);
  }
});

test("a single-token type default is not a claim and is not flagged", () => {
  /*
   * `tier ?? "local"` and `commit ?? "unknown"` are type defaults. They are a
   * different defect when they reach a reader, caught by the render-default
   * rule at the component. Flagging them here would bury the sentence-shaped
   * ones this guard exists for under hundreds of tokens.
   */
  for (const line of ['const t = tier ?? "local";', 'const c = commit ?? "unknown";']) {
    assert.deepEqual(absenceDefaultsIn(line), []);
  }
});


test("FE-31: every reader gap uses WorkingOnIt and disclaimers stay retired", () => {
  const violations: string[] = [];
  for (const file of sourceFilesUnder(ROOT, RENDER_ROOTS)) {
    if (!/\.tsx?$/.test(file) || file.startsWith("app/api/") || file.startsWith("app/(admin)/") || file === "components/demand/working-on-it.tsx") continue;
    for (const text of readerCopyViolations(readFileSync(join(ROOT, file), "utf8"))) violations.push(`${file}: ${text}`);
  }
  assert.deepEqual(violations, []);
});

test("FE-31: seeded inline gaps and each banned disclaimer fail the instrument", () => {
  for (const text of ["We’re working on getting this info", "not a statement that", "not evidence that", "We don't hold"]) {
    assert.equal(readerCopyViolations(`<p>${text}</p>`).length, 1);
    assert.deepEqual(readerCopyViolations(`/* ${text} */`), []);
  }
  assert.deepEqual(readerCopyViolations("<WorkingOnIt />"), []);
});
