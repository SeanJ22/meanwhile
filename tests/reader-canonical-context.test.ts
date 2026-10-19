import assert from "node:assert/strict";
import { test } from "node:test";
import { primeReaderCanonicalStore, readerCanonicalEntry, readerCanonicalEntries } from "../lib/reader/canonical-context.ts";
import { withReaderSelection, type ReaderSelection } from "../lib/db/reader-route.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import { stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";

const selection = (state: string): ReaderSelection => ({ states: [state], keys: new Set([`state:${state}`]) });
const absentStore: CivicDataReadStore = {
  async readPromotion() { throw new Error("Unexpected second read"); },
  async readCandidate() { throw new Error("Unexpected second read"); },
  async readPromotedEntry(recordClass, scope) { return { kind: "NOT_RECORDED", recordClass, scope }; },
};

test("a ballot's canonical batch is shared by state readers and streamed cards, isolated from another place", async () => {
  const az = selection("AZ"), nh = selection("NH");
  const ballot = stateAuthorityPointers("ballot-contests", "AZ")[0];
  const filing = { recordClass: "CURATED_READER_RECORD" as const, scope: "US:bs01-test-filings" };
  await withReaderSelection(az, async () => {
    await primeReaderCanonicalStore([ballot, filing], absentStore);
    assert.equal((await readStateAuthorityProjection("ballot-contests", "AZ")).result.kind, "NOT_RECORDED");
    assert.equal((await readPromotedCivicData(filing.recordClass, filing.scope)).kind, "NOT_RECORDED");
    await withReaderSelection(nh, async () => {
      assert.equal(readerCanonicalEntry(ballot.recordClass, ballot.scope), undefined);
      await primeReaderCanonicalStore([filing], absentStore);
      assert.equal(readerCanonicalEntries().size, 1);
    });
    assert.equal(readerCanonicalEntries().size, 2);
  });
  await withReaderSelection(az, async () => assert.equal((await readerCanonicalEntry(filing.recordClass, filing.scope))?.kind, "NOT_RECORDED"));
});

test("a failed canonical batch stays a failed read and never falls back to another query", async () => {
  const ballot = stateAuthorityPointers("ballot-contests", "AZ")[0];
  const filing = { recordClass: "CURATED_READER_RECORD" as const, scope: "US:bs01-test-filings" };
  await withReaderSelection(selection("AZ"), async () => {
    const error = new Error("First canonical read failed");
    await assert.rejects(primeReaderCanonicalStore([ballot, filing], Promise.reject(error)), value => value === error);
    assert.equal((await readStateAuthorityProjection("ballot-contests", "AZ")).result.kind, "STORE_UNREACHABLE");
    assert.equal((await readPromotedCivicData(filing.recordClass, filing.scope)).kind, "STORE_UNREACHABLE");
    await assert.rejects(readerCanonicalEntry(filing.recordClass, filing.scope)!, value => value === error);
  });
});

test("the selected funding slice survives later official aliases without another data read", async () => {
  const { neonConfig } = await import("@neondatabase/serverless");
  const { primeReaderProjection } = await import("../lib/civic-data/read-model.ts");
  const { provenEdgeEntry } = await import("./helpers/promoted-edge-entry.ts");
  const { requiredRoutineContract } = await import("../lib/civic-data/contracts.ts");
  const contract = requiredRoutineContract("fec-funding");
  const entry = provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: contract.scope, sourceId: contract.sourceId,
    versionId: "bs01-funding-slice", value: { candidates: [{ targetKeys: ["ballot-az-federal-candidate"] }] } });
  assert.equal(entry.kind, "PROMOTED");
  if (entry.kind !== "PROMOTED") return;
  const p = entry.projection;
  const row = { key: p.key, source_id: p.sourceId, record_class: p.recordClass, scope: p.scope, current_version_id: p.versionId,
    last_known_good_version_id: p.lastKnownGoodVersionId, promoted_at: p.promotedAt, validation_receipt: p.receipt, payload: p.payload,
    retrieved_at: entry.attested.retrievedAt, temporal: { version: entry.attested.version, sourceThrough: entry.attested.sourceThrough } };
  const originalUrl = process.env.DATABASE_URL, originalReport = process.env.WTP_VITAL_SIGNS_REPORT, originalFetch = neonConfig.fetchFunction;
  let reads = 0;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@canonical-reader.invalid/fixture";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  neonConfig.fetchFunction = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    reads++;
    const request = JSON.parse(String(init?.body));
    const keys = request.queries[0].params[2];
    assert.ok(keys.includes("ballot-az-federal-candidate"));
    assert.ok(!keys.includes("ballot-nh-candidate"));
    const names = Object.keys(row);
    return Response.json({ results: [{ command: "SELECT", rowCount: 1, rowAsArray: true,
      fields: names.map(name => ({ name, dataTypeID: 114 })), rows: [names.map(name => JSON.stringify(row[name as keyof typeof row]))] }] });
  };
  try {
    const place = selection("AZ");
    await withReaderSelection(place, async () => {
      await primeReaderProjection("FEC_FUNDING", contract.scope, ["ballot-az-federal-candidate"]);
      place.keys.add("congress:an-official-alias");
      assert.equal((await readPromotedCivicData("FEC_FUNDING", contract.scope)).kind, "PROMOTED");
      assert.equal(reads, 1);
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    neonConfig.fetchFunction = originalFetch;
  }
});
