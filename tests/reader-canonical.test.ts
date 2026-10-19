import assert from "node:assert/strict";
import { test } from "node:test";
import { readCanonicalShelf } from "../lib/reader/canonical.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";

const entry = { recordClass: "FEDERAL_DIRECTORY" as const, scope: "US-AZ:current-congress-directory" };
const payload = { people: [{ name: "An official", sourceUrl: "https://example.gov/member" }] };
const row = { row_kind: "promotion", key: `${entry.recordClass}:${entry.scope}`, record_class: entry.recordClass, scope: entry.scope, source_id: "official-source",
  current_version_id: "version-1", last_known_good_version_id: "version-1", promoted_at: "2026-10-17T00:00:00Z",
  retrieved_at: "2026-10-16T00:00:00Z", validation_receipt: { decision: "GOOD" }, normalized_hash: canonicalCivicDataHash(payload), payload, published: true };

test("canonical shelf preserves publication payload and refuses scopes outside the loaded package", async () => {
  let reads = 0;
  const store = await readCanonicalShelf([entry], async statements => { reads++; assert.equal(statements.length, 1); return [[structuredClone(row)]]; });
  const result = await store.readPromotedEntry!(entry.recordClass, entry.scope);
  assert.equal(reads, 1);
  assert.equal(result.kind, "PROMOTED");
  if (result.kind === "PROMOTED") {
    assert.deepEqual(result.projection.payload, payload);
    assert.equal(result.attested.retrievedAt, row.retrieved_at);
  }
  await assert.rejects(store.readPromotedEntry!("FEDERAL_DIRECTORY", "US-NM:current-congress-directory"), /SCOPE_NOT_SELECTED/);
});

test("canonical shelf refuses a failed publication or changed payload", async () => {
  await assert.rejects(readCanonicalShelf([entry], async () => [[{ ...row, published: false }]]), /POINTER_INVALID/);
  await assert.rejects(readCanonicalShelf([entry], async () => [[{ ...row, payload: { changed: true } }]]), /PAYLOAD_HASH_MISMATCH/);
});

test("canonical shelf answers an absent pointer without fabricating records", async () => {
  const store = await readCanonicalShelf([entry], async () => [[]]);
  assert.deepEqual(await store.readPromotedEntry!(entry.recordClass, entry.scope), { kind: "NOT_RECORDED", ...entry });
});

test("canonical shelf reads recursive parts with metadata in one round trip and retains the last verified payload after a failed refresh", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { partitionCivicPayload } = await import("../lib/civic-data/payload-codec.ts");
  const pg = new PGlite();
  const selection = { recordClass: "FEDERAL_DIRECTORY" as const, scope: "US-AZ:canonical-recursive-parts-test" };
  const key = `${selection.recordClass}:${selection.scope}`;
  const expected = { people: [{ name: "An official", biography: "Public office. ".repeat(6000), offices: [{ phone: "202-555-0100" }] }] };
  const encoded = partitionCivicPayload(expected);
  assert.ok(encoded.parts.length > 1, "the fixture requires recursive payload-part reads");
  const excluded = { key: "rejected-candidate", code: "EXCLUDED", detail: "This candidate was excluded from publication", record: { name: "Rejected candidate", biography: "Not a published fact. ".repeat(1000) } };
  const receipt = (version: string) => ({ decision: "GOOD", candidateId: version, sourceId: "official-source", recordClass: selection.recordClass, scope: selection.scope, excludedFacts: [excluded] });
  let reads = 0;
  const partCounts: number[] = [];
  const query: import("../lib/control-plane/admin-view/promoted-slices.ts").ReadOnlyQuery = async statements => {
    reads++;
    assert.equal(statements.length, 1, "metadata and immutable parts travel in one SQL response");
    const rows = (await pg.query<Record<string, unknown>>(statements[0].text,[...statements[0].params])).rows;
    partCounts.push(rows.filter(row => row.row_kind === "part").length);
    return [rows];
  };
  try {
    await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,source_id text,current_version_id text,
        last_known_good_version_id text,promoted_at timestamptz,validation_receipt jsonb,payload jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,normalized_hash text,retrieved_at timestamptz,state text,acquisition_succeeded boolean,
        promoted_version_id text,last_known_good_version_id text,record_class text,scope text,source_id text);
      CREATE TABLE civic_data_candidate_events(candidate_id text,detail text,sequence bigint);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    const promote = async (version: string) => {
      await pg.query(`INSERT INTO civic_data_candidates VALUES($1,$2,$3,'PROMOTED',true,$1,$1,$4,$5,'official-source') ON CONFLICT DO NOTHING`,
        [version,canonicalCivicDataHash(expected),row.retrieved_at,selection.recordClass,selection.scope]);
      await pg.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,'official-source',$4,$4,$5,$6,$7)
        ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,
          validation_receipt=excluded.validation_receipt,payload=excluded.payload`,
        [key,selection.recordClass,selection.scope,version,row.promoted_at,JSON.stringify(receipt(version)),JSON.stringify(encoded.value)]);
    };
    await promote("parts-version-1");
    const cold = await readCanonicalShelf([selection],query);
    const first = await cold.readPromotedEntry!(selection.recordClass,selection.scope);
    assert.equal(first.kind,"PROMOTED");
    if (first.kind === "PROMOTED") {
      assert.deepEqual(first.projection.payload,expected);
      const { record: _record, ...reason } = excluded;
      assert.deepEqual(first.projection.receipt.excludedFacts,[reason],"readers retain the exclusion reason without copying rejected source rows");
      const stored = (await pg.query<{validation_receipt: {excludedFacts: unknown[]}}>("SELECT validation_receipt FROM civic_data_promotions WHERE key=$1",[key])).rows[0];
      assert.deepEqual(stored.validation_receipt.excludedFacts,[excluded],"the original source evidence stays in the canonical audit store");
    }
    assert.equal(reads,1);
    assert.equal(partCounts[0],encoded.parts.length);
    const combined = await readCanonicalShelf([selection], query, {
      text: "SELECT $1::text AS version_id, $2::jsonb AS geography", params: ["geo-version", JSON.stringify({ type: "state_leg_upper", state: "AZ" })],
    });
    assert.deepEqual(combined.additionalRows, [{ version_id: "geo-version", geography: { type: "state_leg_upper", state: "AZ" } }]);
    assert.equal((await combined.readPromotedEntry!(selection.recordClass, selection.scope)).kind, "PROMOTED");
    await readCanonicalShelf([selection],query);
    assert.equal(partCounts[1],0,"unchanged verified versions do not resend or decode payload parts");
    const packedExclusions = [{ ...excluded, record: { biography: "Excluded source evidence. ".repeat(6000) } }];
    const packedReceipt = partitionCivicPayload(packedExclusions);
    assert.ok(!Array.isArray(packedReceipt.value) && packedReceipt.parts.length > 0,"the receipt fixture requires a packed exclusion array");
    for (const part of packedReceipt.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await pg.query("UPDATE civic_data_promotions SET validation_receipt=$2 WHERE key=$1",[key,JSON.stringify({ ...receipt("parts-version-1"), excludedFacts: packedReceipt.value })]);
    const packed = await (await readCanonicalShelf([selection],query)).readPromotedEntry!(selection.recordClass,selection.scope);
    assert.equal(packed.kind,"PROMOTED");
    if (packed.kind === "PROMOTED") {
      assert.deepEqual(packed.projection.payload,expected);
      assert.deepEqual(packed.projection.receipt.excludedFacts,packedExclusions,"packed receipt metadata keeps its exact decoded proof");
    }
    assert.equal(partCounts.at(-1),packedReceipt.parts.length,"packed receipt parts are read even while the payload reuses its verified version");
    await promote("parts-version-2");
    await pg.query("UPDATE civic_data_payload_parts SET payload=$2 WHERE hash=$1",[encoded.parts[0].hash,JSON.stringify("Corrupt immutable part")]);
    await assert.rejects(readCanonicalShelf([selection],query),/PAYLOAD_HASH_MISMATCH|CIVIC_PAYLOAD_PART_ORDER_INVALID/);
    await promote("parts-version-1");
    const retained = await readCanonicalShelf([selection],query);
    const last = await retained.readPromotedEntry!(selection.recordClass,selection.scope);
    assert.equal(last.kind,"PROMOTED");
    if (last.kind === "PROMOTED") assert.deepEqual(last.projection.payload,expected);
    assert.equal(partCounts.at(-1),0,"failed refreshes leave the prior verified payload available");
    await pg.query("UPDATE civic_data_candidates SET source_id='wrong-source' WHERE id='parts-version-1'");
    await assert.rejects(readCanonicalShelf([selection],query),/POINTER_INVALID/);
  } finally { await pg.close(); }
});

test("independent state packages begin together and retain canonical failures", async () => {
  const { readCanonicalPackages } = await import("../lib/reader/canonical.ts");
  const other = { recordClass: "FEDERAL_DIRECTORY" as const, scope: "US-NH:bs01-parallel-test" };
  const started: string[] = [], releases: (() => void)[] = [];
  const store = readCanonicalPackages([[entry], [other]], async statements => {
    const keys = statements[0].params[0] as string[];
    started.push(...keys);
    await new Promise<void>(resolve => releases.push(resolve));
    if (keys.includes(`${other.recordClass}:${other.scope}`)) throw new Error("Failed state package");
    return [[structuredClone(row)]];
  });
  assert.deepEqual(started, [`${entry.recordClass}:${entry.scope}`, `${other.recordClass}:${other.scope}`]);
  releases.forEach(release => release());
  assert.equal((await store.readPromotedEntry!(entry.recordClass, entry.scope)).kind, "PROMOTED");
  await assert.rejects(store.readPromotedEntry!(other.recordClass, other.scope), /Failed state package/);
  await assert.rejects(store.readPromotedEntry!(other.recordClass, other.scope), /Failed state package/);
  assert.equal(started.length, 2, "failed package reads are not retried in the request");
});
