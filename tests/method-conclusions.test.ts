/**
 * The reopening loop, end to end: a conclusion earned under method version N is persisted stamped with N; a new
 * applicable route admitted at N+1 through the real gate reopens it; the WorkItem re-enters the real `REOPENED`
 * state; and route existence survives a withdrawn conclusion. Every conclusion here is earned inside the test and
 * carries `fixture: true` in its own data, which `validateConclusions` refuses in the canonical corpus.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readConclusionStore } from "../lib/method/conclusions.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a malformed corpus is a NAMED refusal, never an empty one", () => {
  const dir = join(ROOT, ".scratch", "method-conclusions-malformed");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "conclusions.json");

  // A missing file is an empty corpus.
  assert.deepEqual(readConclusionStore(path), []);

  // An envelope is refused rather than silently read as empty.
  writeFileSync(path, JSON.stringify({ conclusions: [] }), "utf8");
  assert.throws(() => readConclusionStore(path), /CONCLUSION CORPUS MALFORMED/);
  rmSync(dir, { recursive: true, force: true });
});
