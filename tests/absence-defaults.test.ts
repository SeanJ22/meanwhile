import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

import { RENDER_ROOTS, absenceDefaultsIn } from "../lib/text/absence-defaults.ts";

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

function sweep(): { file: string; text: string }[] {
  const files = RENDER_ROOTS.flatMap((r) => walk(join(ROOT, r), []));
  assert.ok(files.length > 50, `expected the sweep to reach the tree, saw ${files.length} files`);
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    for (const hit of absenceDefaultsIn(readFileSync(file, "utf8"))) {
      out.push({ file: relative(ROOT, file), text: hit.text });
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
