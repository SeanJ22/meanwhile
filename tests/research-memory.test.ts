import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { projectRecord, type ArtifactRecord, type ChangedRecords } from "../lib/control-plane/repository/types.ts";
import { LINEAGE_ARTIFACT_FIELDS } from "../lib/control-plane/workers/standing-lineage.ts";
import { nativeAbortLine } from "../lib/ops/fatal-line.ts";
import { databaseReadsOf } from "../lib/control-plane/admin-view/v6-workers-read.ts";

const capture = (i: number) => ({ artifactId: `art-${i}`, workItemId: `wi-${i % 7}`, attemptId: `at-${i}`, partial: i % 5 === 0,
  canonicalUrl: `https://county.example.gov/agenda/${i}`, recordedAt: "2026-10-13T18:00:00.000Z",
  extraction: { text: "x".repeat(4_000), complete: true }, contentHash: "h".repeat(64) }) as unknown as ArtifactRecord;

test("whole-store lineage reads hold only the five capture fields, from the held copy and from every store", async () => {
  const records = Array.from({ length: 300 }, (_, i) => ({ key: `wi-${i % 7}`, recordId: `art-${i}`, position: i + 1, record: capture(i) }));
  const copies = openHeldCopies(mkdtempSync(join(tmpdir(), "narrowed-")), { log: () => {} });
  const changedSince = async (): Promise<ChangedRecords<ArtifactRecord>> => ({ records, through: "2026-10-13T19:00:00.000Z" });
  const project = (record: ArtifactRecord) => projectRecord(record, LINEAGE_ARTIFACT_FIELDS);
  for (const narrowed of [await copies.logReadAll("cp_log_artifacts", changedSince, project),
    await copies.logReadAll("cp_log_artifacts", changedSince, project)]) {
    assert.equal(narrowed.length, 300);
    assert.deepEqual(Object.keys(narrowed[0] as object).sort(), ["artifactId", "attemptId", "canonicalUrl", "partial", "workItemId"]);
    assert.ok(JSON.stringify(narrowed).length < JSON.stringify(records).length / 20, "a capture's text never enters the round's memory");
  }
  const repos = createMemoryRepositories();
  for (const row of records.slice(0, 3)) await repos.artifacts.append(row.key, row.recordId, row.record, row.record.recordedAt);
  assert.deepEqual(await repos.artifacts.readAllNarrowed(LINEAGE_ARTIFACT_FIELDS), (await repos.artifacts.readAll()).map(project));
});

test("a native abort's own line leads the heartbeat's error, ahead of its stack and the workers' disconnects", () => {
  const stderr = ["<--- Last few GCs --->", "[1203:0x6a3c000]  431211 ms: Mark-Compact 4034.1 (4130.4) -> 4021.8 (4131.6) MB",
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", "----- Native stack trace -----", "",
    ...Array.from({ length: 10 }, (_, i) => `${String(i + 1).padStart(2)}: 0x${(0xf14a4a + i).toString(16)}  [/usr/bin/node]`),
    ...Array(4).fill("LEASE_WORKER_BROKER_DISCONNECTED")].join("\n");
  assert.equal(nativeAbortLine(stderr), "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");
  assert.equal(nativeAbortLine("Error: ordinary failure\n    at main (file.ts:1:1)"), null);
});

test("Admin reads the runner's database bytes for its last full hour, largest callers first", () => {
  const reading = databaseReadsOf({ hour: "2026-10-13T18:00:00.000Z", controlPlaneBytes: 366_170_703, readerBytes: 226_549_568, requests: 92_420, processCount: 533,
    byCaller: [{ caller: "cp_log_costs.readSince ← scripts/freshness-shadow.mts:1681", bytes: 94_768_773 }, { caller: "", bytes: 1 }, { caller: "other", bytes: 104_789_140 }] });
  assert.deepEqual(reading?.byCaller.map(row => row.bytes), [94_768_773, 104_789_140]);
  assert.equal(reading?.controlPlaneBytes, 366_170_703);
  assert.equal(databaseReadsOf(null), null);
  assert.equal(databaseReadsOf({ hour: "not a time" }), null);
});
