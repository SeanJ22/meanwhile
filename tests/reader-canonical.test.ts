import assert from "node:assert/strict";
import { test } from "node:test";
import { readCanonicalShelf } from "../lib/reader/canonical.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { stateContainersStatement } from "../lib/control-plane/admin-view/promoted-slices.ts";

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
    const city = { ocdId: "ocd-division/country:us/state:az/place:tucson", label: "Tucson", divisionType: "place", tier: "local" };
    await pg.query(`INSERT INTO civic_data_promotions(key,record_class,scope,payload)
      VALUES('REGISTRATION:US-AZ:registration:v1','REGISTRATION','US-AZ:registration:v1',$1)`,
      [JSON.stringify({ divisions: [city, { ...city, ocdId: "another-place" }] })]);
    const local = await readCanonicalShelf([selection], query, stateContainersStatement("AZ", [city.ocdId]));
    assert.deepEqual(local.additionalRows[0].local_divisions, [city], "the same state query includes the selected local seat's sourced division even if Census is not held");
    assert.equal(local.additionalRows[0].version_id, null);
    await readCanonicalShelf([selection],query);
    assert.equal(partCounts[1],0,"unchanged verified versions do not resend or decode payload parts");
    const district = (type: string, geoid: string, zcta5 = "85701", state = "AZ") => ({ type, version: `${type}:fixture`, versionMeta: {},
      groupings: [{ geoid, ocdId: null, label: geoid, stateAbbr: state, stateFips: geoid.slice(0,2), overlaps: [{ zcta5, whole: true }] }] });
    await pg.query(`INSERT INTO civic_data_promotions(key,record_class,scope,payload,current_version_id)
      VALUES('CENSUS_GEOGRAPHY:US:zcta-geography-overlaps','CENSUS_GEOGRAPHY','US:zcta-geography-overlaps',$1,'geography-fixture')`,
      [JSON.stringify({ scopes: [district("congressional_district","0407"), district("congressional_district","0407"),
        district("state_leg_upper","04003"), district("state_leg_lower","04A-B"), district("congressional_district","0409","85001"),
        district("congressional_district","0200","99501","AK"),district("congressional_district","1198","20001","DC"),
        district("state_leg_lower","3300B","03255","NH")] })]);
    const translation = { recordClass: "CURATED_READER_RECORD" as const, scope: "US:plain-english-translations:ocd-division/country:us/state:az/cd:7" };
    const { provenEdgeEntry } = await import("./helpers/promoted-edge-entry.ts");
    const translated = provenEdgeEntry({ ...translation, sourceId: "official-source", versionId: "zip-translation-version", value: expected });
    await pg.query(`INSERT INTO civic_data_candidates VALUES($1,$2,$3,'PROMOTED',true,$1,$1,$4,$5,'official-source')`,
      [translated.projection.versionId,translated.attested.payloadSha256,row.retrieved_at,translation.recordClass,translation.scope]);
    await pg.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,'official-source',$4,$4,$5,$6,$7)`,
      [translated.projection.key,translation.recordClass,translation.scope,translated.projection.versionId,row.promoted_at,JSON.stringify(translated.projection.receipt),JSON.stringify(encoded.value)]);
    const beforeFolded = reads;
    const folded = await readCanonicalShelf([selection],query,stateContainersStatement("AZ",[],"85701"));
    assert.equal(reads,beforeFolded+1,"ZIP district pointers and state geography use the same single SQL query");
    assert.deepEqual(folded.additionalEntries.map(entry=>entry.scope).sort(),[
      translation.scope,"US:plain-english-translations:ocd-division/country:us/state:az/sldu:3",
      "US:plain-english-translations:ocd-division/country:us/state:az/sldl:a_b",
    ].sort(),"only the requested ZIP's district identities are preloaded across held plans, including absent pointers");
    const heldTranslation = await folded.readPromotedEntry!(translation.recordClass,translation.scope);
    assert.equal(heldTranslation.kind,"PROMOTED");
    if (heldTranslation.kind === "PROMOTED") assert.deepEqual(heldTranslation.projection.payload,expected);
    assert.equal((await folded.readPromotedEntry!("CURATED_READER_RECORD",folded.additionalEntries.find(entry=>entry.scope.endsWith("/sldu:3"))!.scope)).kind,"NOT_RECORDED");
    await assert.rejects(folded.readPromotedEntry!("CURATED_READER_RECORD",translation.scope.replace("cd:7","cd:9")),/SCOPE_NOT_SELECTED/);
    await readCanonicalShelf([selection],query,stateContainersStatement("AZ",[],"85701"));
    assert.equal(partCounts.at(-1),0,"unchanged ZIP-derived pointers reuse their verified payloads too");
    for (const [state,zip,id] of [["AK","99501","state:ak/cd:at-large"],["DC","20001","district:dc/cd:at-large"],["NH","03255","state:nh/sldl:00b"]]) {
      const selected = await readCanonicalShelf([selection],query,stateContainersStatement(state,[],zip));
      assert.deepEqual(selected.additionalEntries.map(entry=>entry.scope),[`US:plain-english-translations:ocd-division/country:us/${id}`],"district pointer identities preserve at-large, delegate and alphanumeric rules");
    }
    await pg.query("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id=$1",[translated.projection.versionId]);
    await assert.rejects(readCanonicalShelf([selection],query,stateContainersStatement("AZ",[],"85701")),/POINTER_INVALID/);
    await pg.query("UPDATE civic_data_candidates SET acquisition_succeeded=true WHERE id=$1",[translated.projection.versionId]);
    const { readCanonicalPackages } = await import("../lib/reader/canonical.ts");
    const batchedEntries=[{...selection,scope:`${selection.scope}:batch-first`},{...translation,scope:`${translation.scope}:batch-second`},
      {...selection,scope:`${selection.scope}:batch-corrupt`}];
    const privatePlan=partitionCivicPayload({privateText:"Only this family holds these words. ".repeat(6000)});
    assert.ok(privatePlan.parts.length>0);
    for (const part of privatePlan.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    for (const [index,pointer] of batchedEntries.entries()) {
      const value=index === 2 ? {privateText:"Only this family holds these words. ".repeat(6000)} : expected;
      const publication=provenEdgeEntry({...pointer,sourceId:"official-source",versionId:`batch-version:${index}`,value});
      await pg.query(`INSERT INTO civic_data_candidates VALUES($1,$2,$3,'PROMOTED',true,$1,$1,$4,$5,'official-source')`,
        [publication.projection.versionId,publication.attested.payloadSha256,row.retrieved_at,pointer.recordClass,pointer.scope]);
      await pg.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,'official-source',$4,$4,$5,$6,$7)`,
        [publication.projection.key,pointer.recordClass,pointer.scope,publication.projection.versionId,row.promoted_at,JSON.stringify(publication.projection.receipt),JSON.stringify(index === 2 ? privatePlan.value : encoded.value)]);
    }
    await pg.query("UPDATE civic_data_payload_parts SET payload=$2 WHERE hash=$1",[privatePlan.parts[0].hash,JSON.stringify({$civicPayloadPart:privatePlan.parts[0].hash})]);
    let batchReads=0;
    const batch=readCanonicalPackages(batchedEntries.map(pointer=>[pointer]),async statements=>{
      batchReads++;
      assert.equal(statements.length,1);
      assert.deepEqual(statements[0].params[0],batchedEntries.map(pointer=>`${pointer.recordClass}:${pointer.scope}`));
      const rows=(await pg.query<Record<string,unknown>>(statements[0].text,[...statements[0].params])).rows;
      const hashes=rows.filter(row=>row.row_kind === "part").map(row=>row.part_hash);
      assert.equal(new Set(hashes).size,hashes.length,"a part shared by independent families crosses the network only once");
      for (const part of encoded.parts) assert.ok(hashes.includes(part.hash));
      return [rows];
    });
    const batchResults=await Promise.allSettled(batchedEntries.map(pointer=>batch.readPromotedEntry!(pointer.recordClass,pointer.scope)));
    for (const result of batchResults.slice(0,2)) {
      assert.equal(result.status,"fulfilled","unrelated corrupt parts cannot break a valid family");
      if (result.status === "fulfilled" && result.value.kind === "PROMOTED") assert.deepEqual(result.value.projection.payload,expected);
    }
    assert.equal(batchResults[2].status,"rejected");
    if (batchResults[2].status === "rejected") assert.match(String(batchResults[2].reason),/CIVIC_PAYLOAD_PART_CYCLE/);
    assert.equal(batchReads,1,"independent decoding and failure checks add no database round trip");
    const broken=readCanonicalPackages([[selection],[translation]],async()=>{throw new Error("The shared network read failed");});
    await assert.rejects(broken.readPromotedEntry!(selection.recordClass,selection.scope),/shared network read failed/);
    await assert.rejects(broken.readPromotedEntry!(translation.recordClass,translation.scope),/shared network read failed/);
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

test("one canonical network read keeps each group's pointer failure independent", async () => {
  const { readCanonicalPackages } = await import("../lib/reader/canonical.ts");
  const other = { recordClass: "FEDERAL_DIRECTORY" as const, scope: "US-NH:bs01-parallel-test" };
  const started: string[] = [], releases: (() => void)[] = [];
  let reads=0;
  const store = readCanonicalPackages([[entry], [other]], async statements => {
    reads++;
    const keys = statements[0].params[0] as string[];
    started.push(...keys);
    await new Promise<void>(resolve => releases.push(resolve));
    return [[structuredClone(row),{...row,key:`${other.recordClass}:${other.scope}`,scope:other.scope,published:false}]];
  });
  assert.deepEqual(started, [`${entry.recordClass}:${entry.scope}`, `${other.recordClass}:${other.scope}`]);
  releases.forEach(release => release());
  assert.equal((await store.readPromotedEntry!(entry.recordClass, entry.scope)).kind, "PROMOTED");
  await assert.rejects(store.readPromotedEntry!(other.recordClass, other.scope), /POINTER_INVALID/);
  await assert.rejects(store.readPromotedEntry!(other.recordClass, other.scope), /POINTER_INVALID/);
  assert.equal(reads,1,"the failed family does not retry or add a network read");
  const changed=readCanonicalPackages([[entry],[other]],async()=>[[structuredClone(row),
    {...row,key:`${other.recordClass}:${other.scope}`,scope:other.scope,normalized_hash:"f".repeat(64)}]]);
  assert.equal((await changed.readPromotedEntry!(entry.recordClass,entry.scope)).kind,"PROMOTED");
  await assert.rejects(changed.readPromotedEntry!(other.recordClass,other.scope),/PAYLOAD_HASH_MISMATCH/);
});
