import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { ingestDataset, prlSubjectShard, type PrlSourceOpen } from "../lib/sources/prl/ingest.ts";
import { readReceipt, writeReceipt } from "../lib/sources/prl/holding.ts";
import { readPrlPerson } from "../lib/sources/prl/reader.ts";
import type { PrlIngestReceipt } from "../lib/sources/prl/receipt.ts";

const NOW = Date.parse("2026-09-18T00:00:00Z");
function source(text: string, unchanged = false): () => Promise<PrlSourceOpen> {
  return async () => ({ textChunks: (async function* () {
    if (unchanged) throw new Error("An unchanged release must not be parsed again");
    for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
  })(), sourceSha256: createHash("sha256").update(text).digest("hex"), finalUrl: "https://americaspoliticalpulse.com/data/elite/x.zip",
  member: "x.csv", retrievedAt: new Date(NOW).toISOString(), byteLength: Buffer.byteLength(text), unchanged });
}
function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "prl-ingest-"));
  return { store: new LocalFileArchiveStore(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
async function personRows(store: LocalFileArchiveStore, receipt: PrlIngestReceipt, person: string) {
  const index = JSON.parse(new TextDecoder().decode((await store.get(`${receipt.objectRoot}/people/${prlSubjectShard(person)}/index.json`))!));
  return (await Promise.all((index.keys as string[]).map(async key => JSON.parse(new TextDecoder().decode((await store.get(key))!))))).flat();
}
const FED_CSV = ["id,bioguide_id,date,last_updated,text,source_url", "1,B000944,2017-06-21,2025-01-01 00:00:00,plain,https://example.gov/1",
  '2,B000944,2018-01-01,2025-06-01 00:00:00,"has, a comma",https://example.gov/2',
  "3,C000127,2019-01-01,2026-09-10 04:00:00,recent reclassification,https://example.gov/3"].join("\n") + "\n";

test("complete source releases preserve person partitions, revisions and same-date or late rows", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("statements-national");
    const first = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(FED_CSV), rowsPerObject: 1 });
    assert.equal(first.rowsSeen, 3); assert.equal(first.subjectCount, 2);
    assert.equal((await personRows(store, first, "B000944"))[0].text, "has, a comma");
    const changed = FED_CSV + "4,B000944,2016-01-01,2025-01-01 00:00:00,late row,https://example.gov/4\n" +
      "3,C000127,2019-01-01,2026-09-11 04:00:00,revised label,https://example.gov/3\n";
    const next = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: first, open: source(changed) });
    assert.notEqual(first.objectRoot, next.objectRoot);
    assert.equal((await personRows(store, next, "B000944")).length, 3);
    assert.deepEqual((await personRows(store, next, "C000127")).map(row => row.text), ["revised label"]);
    assert.equal((await personRows(store, first, "C000127"))[0].text, "recent reclassification", "prior evidence remains held");
  } finally { cleanup(); }
});

test("receipt restart reuses a fully validated unchanged source without changing its retrieval date", async () => {
  const { store, cleanup } = tempStore();
  try {
    const dataset = requiredPrlDataset("statements-national");
    const first = await ingestDataset({ dataset, archive: store, now: NOW, priorReceipt: null, open: source(FED_CSV) });
    await writeReceipt(store, first);
    const second = await ingestDataset({ dataset, archive: store, now: NOW + 86400_000, priorReceipt: await readReceipt(store, dataset.id), open: source(FED_CSV, true) });
    assert.equal(second.rowsWritten, 0); assert.equal(second.fetchedAt, first.fetchedAt); assert.equal(second.objectRoot, first.objectRoot);
  } finally { cleanup(); }
});

test("truncated CSV or JSON never accepts a source or publishes completed partitions", async () => {
  const { store, cleanup } = tempStore();
  try {
    for (const [datasetId, raw] of [["statements-national", FED_CSV + '4,B000944,2020-01-01,2025-01-01,"unfinished'],
      ["press-releases", '[{"id":1,"bioguide_id":"B000944","date":"2026-01-01"}']] as const) {
      let accepted = false;
      await assert.rejects(ingestDataset({ dataset: requiredPrlDataset(datasetId), archive: store, now: NOW, priorReceipt: null,
        open: async () => ({ ...await source(raw)(), accept: async () => { accepted = true; } }) }), /TRUNCATED/);
      assert.equal(accepted, false);
    }
    assert.deepEqual(await store.list(""), []);
  } finally { cleanup(); }
});

test("person reader fetches only native partitions and excludes future, blank and undated statements", async () => {
  const { store, cleanup } = tempStore();
  try {
    const raw = '[{"id":9007199254740993,"bioguide_id":"B000944","date":"2026-09-01","text":"We support providing clean water to every household.","source_url":"https://example.gov/water"},' +
      '{"id":2,"bioguide_id":"B000944","date":"2027-01-01","text":"Future statement.","url":"https://example.gov/future"},' +
      '{"id":3,"bioguide_id":"C000127","date":"2026-09-01","text":"Another person.","url":"https://example.gov/other"},' +
      '{"id":4,"bioguide_id":"B000944","date":"2026-09-01","text":"","url":"https://example.gov/blank"}]';
    const receipt = await ingestDataset({ dataset: requiredPrlDataset("press-releases"), archive: store, now: NOW, priorReceipt: null, open: source(raw) });
    assert.equal(receipt.rowsAfterNow, 1); assert.equal(receipt.highWaterMark, "2026-09-01");
    store.list = async () => { throw new Error("A reader must not list the bucket"); };
    const read = await readPrlPerson({ bioguideId: "B000944" }, { archive: store, now: NOW, projection: { formatVersion: 1, datasets: { "press-releases": receipt } } });
    assert.equal(read.statements.length, 1); assert.match(read.statements[0].id, /9007199254740993$/);
    assert.equal(read.statements[0].retrievedAt, new Date(NOW).toISOString());
    assert.equal(read.statements[0].date, "2026-09-01");
    assert.deepEqual((await readPrlPerson({ bioguideId: "Same Name" }, { archive: store })).statements, []);
  } finally { cleanup(); }
});

test("state profile ingestion leaves an absent source measurement date unknown", async () => {
  const { store, cleanup } = tempStore();
  try {
    const csv = "openstates_id,name,state,party,position,district,communication_count,communication_attack_personal_mean,communication_attack_policy_mean,communication_outcome_creditclaiming_mean,communication_policy_mean,communication_outcome_bipartisanship_mean\nocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604,Tim,AL,Republican,lower,14,1200,5.5,10.2,3.1,60.4,2.0\n";
    const receipt = await ingestDataset({ dataset: requiredPrlDataset("profiles-state"), archive: store, now: NOW, priorReceipt: null, open: source(csv) });
    const held = JSON.parse(new TextDecoder().decode((await store.get(`${receipt.objectRoot}/people/${prlSubjectShard("ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604")}/profile.json`))!));
    assert.equal(held.profile.measuredAt, null);
    assert.equal(receipt.profiles, null);
    assert.equal(receipt.coverageThrough, null);
  } finally { cleanup(); }
});
