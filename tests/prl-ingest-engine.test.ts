import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { parseCsv } from "../lib/sources/prl/index.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { ingestDataset, type PrlSourceOpen } from "../lib/sources/prl/ingest.ts";
import { readReceipt, writeReceipt } from "../lib/sources/prl/holding.ts";
import type { PrlIngestReceipt } from "../lib/sources/prl/receipt.ts";

const NOW = Date.parse("2026-09-18T00:00:00Z");

function source(text: string, member: string): () => Promise<PrlSourceOpen> {
  return async () => ({
    textChunks: (async function* () {
      // chunk oddly to exercise the streaming parsers across boundaries
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    })(),
    sourceSha256: "b".repeat(64),
    finalUrl: "https://americaspoliticalpulse.com/data/elite/x.zip",
    member,
  });
}

function tempStore(): { store: LocalFileArchiveStore; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "prl-ingest-"));
  return { store: new LocalFileArchiveStore(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const FED_CSV = [
  "id,bioguide_id,date,last_updated,text",
  "1,B000944,2017-06-21,2025-01-01 00:00:00,plain",
  '2,B000944,2018-01-01,2025-06-01 00:00:00,"has, a comma"',
  "3,C000127,2019-01-01,2026-09-10 04:00:00,recent reclassification",
].join("\n") + "\n";

test("archive initial load writes every row and marks the newest cursor (capped at now)", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("statements-national");
    const receipt = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(FED_CSV, "rhetoric-all-national.csv"), rowsPerObject: 2 });
    assert.equal(receipt.rowsSeen, 3);
    assert.equal(receipt.rowsWritten, 3);
    assert.equal(receipt.highWaterMark, "2026-09-10 04:00:00", "cursor is last_updated, not date");
    assert.equal(receipt.newObjectKeys.length, 2, "5→ ceil(3/2)=2 partitions");
    // The comma-bearing cell survives the bucket round-trip.
    const stored = (await Promise.all(receipt.newObjectKeys.map((k) => store.get(k)))).map((b) => new TextDecoder().decode(b!));
    const allRows = stored.flatMap((csv) => parseCsv(csv).slice(1).filter((r) => r.length > 1));
    assert.equal(allRows.length, 3);
    assert.ok(allRows.some((r) => r[4] === "has, a comma"), "embedded comma preserved through the store");
  } finally {
    cleanup();
  }
});

test("archive incremental writes only rows whose cursor beats the stored mark", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("statements-national");
    const prior: PrlIngestReceipt = {
      ...(await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(FED_CSV, "x.csv"), rowsPerObject: 100 })),
      highWaterMark: "2025-06-01 00:00:00",
    };
    // Second run a week later; only row 3 (last_updated 2026-09-10) is newer.
    const later = Date.parse("2026-09-25T00:00:00Z");
    const receipt = await ingestDataset({ dataset, archive: store, now: later, priorReceipt: prior, open: source(FED_CSV, "x.csv"), rowsPerObject: 100 });
    assert.equal(receipt.rowsSeen, 3, "still streams the whole file");
    assert.equal(receipt.rowsWritten, 1, "only the reclassified row is new");
    assert.equal(receipt.previousMark, "2025-06-01 00:00:00");
    assert.equal(receipt.highWaterMark, "2026-09-10 04:00:00");
    assert.ok(receipt.objectKeys.length > receipt.newObjectKeys.length, "keeps the prior objects and adds a delta");
  } finally {
    cleanup();
  }
});

test("a future-dated row is stored but never advances the mark (the 2027 hazard)", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("press-releases"); // json, cursor = date
    const json = JSON.stringify([
      { id: 1, date: "2026-09-01", bioguide_id: "L000582", text: "a" },
      { id: 2, date: "2027-01-15", bioguide_id: "L000582", text: "future press release" },
      { id: 3, date: "2026-09-10", bioguide_id: "T000001", text: "c" },
    ]);
    const receipt = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(json, "statements.json"), rowsPerObject: 100 });
    assert.equal(receipt.rowsWritten, 3, "the future row IS stored — we drop nothing");
    assert.equal(receipt.rowsAfterNow, 1, "and it is counted as future");
    assert.equal(receipt.highWaterMark, "2026-09-10", "the mark is capped at now, not pushed to 2027");
    assert.equal(receipt.coverageThrough, "2026-09-10");
  } finally {
    cleanup();
  }
});

test("state profiles ingest carries precomputed percentages and touches no bucket", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("profiles-state");
    const header = "openstates_id,name,state,party,position,district,communication_count,communication_attack_personal_mean,communication_attack_policy_mean,communication_outcome_creditclaiming_mean,communication_policy_mean,communication_outcome_bipartisanship_mean";
    const csv = [header, "ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604,Tim,AL,Republican,lower,14,1200,5.5,10.2,3.1,60.4,2.0"].join("\n") + "\n";
    const receipt = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(csv, "state-profiles.csv"), rowsPerObject: 100 });
    assert.equal(receipt.profileKind, "state");
    assert.equal((receipt.profiles as unknown[]).length, 1);
    assert.equal(receipt.highWaterMark, null, "aggregate profiles have no per-row cursor");
    assert.equal(receipt.objectStore, "none");
    assert.equal((await store.list("")).length, 0, "no raw rows written to object storage");
  } finally {
    cleanup();
  }
});

test("the receipt round-trips through the store and drives a zero-write restart", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("statements-national");
    const first = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(FED_CSV, "x.csv"), rowsPerObject: 100 });
    await writeReceipt(store, first);

    // A later run reads the prior receipt back from the store...
    const prior = await readReceipt(store, "statements-national");
    assert.equal(prior?.highWaterMark, "2026-09-10 04:00:00");

    // ...and re-ingesting the same file writes nothing new, because every row's
    // cursor is at or below the stored mark. That is the file-level restart.
    const later = Date.parse("2026-09-25T00:00:00Z");
    const second = await ingestDataset({ dataset, archive: store, now: later, priorReceipt: prior, open: source(FED_CSV, "x.csv"), rowsPerObject: 100 });
    assert.equal(second.rowsSeen, 3);
    assert.equal(second.rowsWritten, 0, "nothing beats the stored mark, so nothing is re-written");
    assert.equal(second.newObjectKeys.length, 0);
  } finally {
    cleanup();
  }
});
