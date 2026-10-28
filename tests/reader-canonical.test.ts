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

test("a saved page carries recursive source facts, exclusions and Checked metadata without reopening any bundle", async()=>{
  const {migratedReaderDb}=await import("./helpers/migrated-reader-db.ts");
  const {writeReadyAuthorities}=await import("./helpers/ready-authorities.ts");
  const {partitionCivicPayload}=await import("../lib/civic-data/payload-codec.ts");
  const {pg,publish}=await migratedReaderDb();
  const source={recordClass:"CURATED_READER_RECORD" as const,scope:"US:ready-recursive-test"};
  const expected={people:[{name:"An official",biography:"Public office. ".repeat(6000),offices:[{phone:"202-555-0100"}]}]};
  const encoded=partitionCivicPayload(expected),key=`${source.recordClass}:${source.scope}`;
  const excluded={key:"rejected",code:"EXCLUDED",detail:"Not admitted",record:{biography:"Source text".repeat(1000)}};
  try {
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await publish({...source,id:"source-v1",sourceId:"source",at:"2026-10-19T00:00:00.000Z",value:encoded.value,
      payloadHash:canonicalCivicDataHash(expected),excludedFacts:[excluded]});
    await writeReadyAuthorities(pg,[key]);
    let calls=0;
    const query:import("../lib/control-plane/admin-view/promoted-slices.ts").ReadOnlyQuery=async statements=>{
      calls++;return Promise.all(statements.map(({text,params})=>{
        assert.doesNotMatch(text,/civic_data_(?:candidates|promotions|candidate_events|payload_parts)/);
        return pg.query<Record<string,unknown>>(text,[...params]).then(result=>result.rows);
      }));
    };
    const first=await (await readCanonicalShelf([source],query)).readPromotedEntry!(source.recordClass,source.scope);
    assert.equal(first.kind,'PROMOTED');
    if(first.kind==='PROMOTED'){
      assert.deepEqual(first.projection.payload,expected);
      assert.deepEqual(first.projection.receipt.excludedFacts,[{key:excluded.key,code:excluded.code,detail:excluded.detail}]);
      assert.equal(first.attested.retrievedAt,'2026-10-19T00:00:00.000Z');
    }
    // Independent source storage damage cannot make a ready page open its old source path.
    await pg.query("UPDATE civic_data_payload_parts SET payload='null' WHERE hash=$1",[encoded.parts[0].hash]);
    const next=await (await readCanonicalShelf([source],query)).readPromotedEntry!(source.recordClass,source.scope);
    assert.deepEqual(next,first);assert.equal(calls,2);
    await assert.rejects(readCanonicalShelf([source],async()=>{throw Error('Page unavailable');}),/Page unavailable/);
    await pg.query("UPDATE place_page SET context=jsonb_set(context,$1,'false')",[['authorities',key,'published']]);
    await assert.rejects(readCanonicalShelf([source],query),/POINTER_INVALID/);
  }finally{await pg.close();}
});

test("one canonical network read keeps each group's pointer failure independent", async () => {
  const { readCanonicalPackages } = await import("../lib/reader/canonical.ts");
  const other = { recordClass: "FEDERAL_DIRECTORY" as const, scope: "US-NH:bs01-parallel-test" };
  const started: string[] = [], releases: (() => void)[] = [];
  let reads=0;
  const store = readCanonicalPackages([[entry], [other]], async statements => {
    reads++;
    const keys = (JSON.parse(String(statements[0].params[0])) as {key:string}[]).map(row=>row.key);
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
