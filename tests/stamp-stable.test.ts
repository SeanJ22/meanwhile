/**
 * **RL-1 — a no-op refresh is stamp-stable.** (NH326/NH327, 2026-09-05.)
 *
 * The writer compares FACTS, not bytes: every field except the observation
 * stamps it names. Unchanged facts leave the file's bytes untouched and record
 * the observation elsewhere; changed facts write exactly as before, so the
 * exact-byte Reader proof is still invalidated by a real change and never by a
 * re-observation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareFacts,
  factsOf,
  factsSha256,
  readObservations,
  stableSerialize,
  writeStampStable,
  type RefreshObservation,
} from "../lib/ops/stamp-stable.ts";

const STAMPS = { stampKeys: ["collectedAt", "verifiedAt"] } as const;

test("factsOf drops a stamp key at every depth and nothing else", () => {
  const doc = { collectedAt: "2026-09-05", rows: [{ id: "a", verifiedAt: "2026-09-05", nested: { collectedAt: "x", fact: 1 } }] };
  assert.deepEqual(factsOf(doc, STAMPS), { rows: [{ id: "a", nested: { fact: 1 } }] });
});

test("ignoreTopLevel drops a run-accounting block only at the top", () => {
  const doc = { sources: [{ ok: true }], meetings: [{ id: "m", sources: ["kept"] }] };
  assert.deepEqual(factsOf(doc, { stampKeys: [], ignoreTopLevel: ["sources"] }), { meetings: [{ id: "m", sources: ["kept"] }] });
});

test("key order is not a fact; array order is", () => {
  assert.equal(stableSerialize({ b: 1, a: [1, 2] }), stableSerialize({ a: [1, 2], b: 1 }));
  assert.notEqual(stableSerialize({ a: [1, 2] }), stableSerialize({ a: [2, 1] }));
  assert.equal(factsSha256({ b: 1, a: 2, collectedAt: "x" }, STAMPS), factsSha256({ a: 2, b: 1, collectedAt: "y" }, STAMPS));
});

test("compareFacts: a new file, an unchanged re-observation, a changed fact, and unreadable bytes", () => {
  const next = { collectedAt: "2026-09-05", rows: [{ id: "a", verifiedAt: "2026-09-05" }] };
  assert.equal(compareFacts(null, next, STAMPS).verdict, "NEW_FILE");
  assert.equal(compareFacts(JSON.stringify({ collectedAt: "2026-09-04", rows: [{ id: "a", verifiedAt: "2026-09-04" }] }), next, STAMPS).verdict, "FACTS_UNCHANGED");
  assert.equal(compareFacts(JSON.stringify({ collectedAt: "2026-09-04", rows: [{ id: "b", verifiedAt: "2026-09-04" }] }), next, STAMPS).verdict, "FACTS_CHANGED");
  assert.equal(compareFacts("{not json", next, STAMPS).verdict, "FACTS_CHANGED", "bytes a writer cannot read are never kept as equal");
});

test("writeStampStable leaves unchanged facts byte-identical and records the observation; changed facts write", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamp-stable-"));
  const absolutePath = join(dir, "data", "thing.json");
  const observationsPath = join(dir, "observations.jsonl");
  const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const yesterday = { collectedAt: "2026-09-04", rows: [{ id: "a", verifiedAt: "2026-09-04", name: "Alpha" }] };
  const first = writeStampStable({ absolutePath, path: "data/thing.json", next: yesterday, serialize, ...STAMPS, observationsPath, log: () => {} });
  assert.equal(first.verdict, "NEW_FILE");
  const before = readFileSync(absolutePath, "utf8");

  const restamped = { collectedAt: "2026-09-05", rows: [{ id: "a", verifiedAt: "2026-09-05", name: "Alpha" }] };
  const second = writeStampStable({ absolutePath, path: "data/thing.json", next: restamped, serialize, ...STAMPS, observationsPath, log: () => {} });
  assert.equal(second.verdict, "FACTS_UNCHANGED");
  assert.equal(second.written, false);
  assert.equal(readFileSync(absolutePath, "utf8"), before, "a re-observation with unchanged facts moved no byte");
  assert.equal(second.bytesOnDisk, before);

  const changed = { collectedAt: "2026-09-05", rows: [{ id: "a", verifiedAt: "2026-09-05", name: "Alpha (withdrawn)" }] };
  const third = writeStampStable({ absolutePath, path: "data/thing.json", next: changed, serialize, ...STAMPS, observationsPath, log: () => {} });
  assert.equal(third.verdict, "FACTS_CHANGED");
  assert.equal(third.written, true);
  assert.equal(readFileSync(absolutePath, "utf8"), serialize(changed), "a factual change writes exactly the bytes the writer formats, stamps included");

  const observations: RefreshObservation[] = readObservations(observationsPath);
  assert.deepEqual(observations.map((o) => [o.path, o.verdict, o.written]), [
    ["data/thing.json", "NEW_FILE", true],
    ["data/thing.json", "FACTS_UNCHANGED", false],
    ["data/thing.json", "FACTS_CHANGED", true],
  ]);
  assert.deepEqual(observations[1].stampKeys, ["collectedAt", "verifiedAt"]);
  assert.match(observations[1].observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(readObservations(join(dir, "absent.jsonl")).length, 0, "no observations file means no observations, never an error");
  assert.ok(existsSync(absolutePath));
});
