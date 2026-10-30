import { installKeyedRows } from "./helpers/keyed-rows.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { vaultCapture } from "../lib/facts/capture.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { OFFICE_FACT_TARGETS_SQL, officeAddressesOnPage, publishHeldOfficeFacts, streetOfficeAddress } from "../lib/meetings/office-facts.ts";
import { factDb } from "./helpers/fact-db.ts";

const NOW = "2026-10-26T06:30:00.000Z", STATE = "AZ";
const PLACE = "ocd-division/country:us/state:az/school_district:sunnyside_unified_district";
const GOVERNMENT = "az:school:sunnyside-unified", BODY = `${PLACE}#board`;
const ADDRESS = "2238 E. Ginter Road, Tucson, AZ 85706", NCES_ADDRESS = "2238 E GINTER RD, TUCSON, AZ, 85706", NCES_SHA256 = "376539484b400c0c6d72d100766dc7acacc8725f464556062e2920b3a9b6a64c";
const SOURCE = "https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2324.zip";
const provenance = { sourceUrl: SOURCE, sourceOrg: "National Center for Education Statistics", collectedAt: NOW, verifiedAt: null };

async function setup(address = NCES_ADDRESS) {
  const db = await factDb(), vault = new MemoryEvidenceStore();
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ($1,'place','Sunnyside Unified School District','AZ',NULL),
    ($2,'government','Sunnyside Unified School District','AZ',$1),($3,'body','Governing Board','AZ',$2)`, [PLACE, GOVERNMENT, BODY]);
  await db.pg.exec("CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,payload jsonb,scope text DEFAULT 'US-AZ:registration:v1',current_version_id text DEFAULT 'fixture',promoted_at timestamptz DEFAULT now())");
  await installKeyedRows(db.pg);
  await db.query("INSERT INTO civic_data_promotions(key,record_class,payload) VALUES($1,'REGISTRATION',$2)", ["REGISTRATION:US-AZ:registration:v1", JSON.stringify({ governments: [{
    id: "government:US-AZ:nces:0408170", jurisdictionId: GOVERNMENT, state: STATE,
    aliases: [GOVERNMENT], bodyIds: [BODY], name: "Sunnyside Unified School District", officeAddress: address,
    mailingAddress: "PO Box 123, Tucson, AZ 85706", website: null, provenance, nativeIds: { nces_leaid: "0408170" },
  }] })]);
  const hash = NCES_SHA256, releaseId = SOURCE.split("/").at(-1)!;
  const identity = createHash("sha256").update(`nces-ccd\n${releaseId}\n${SOURCE}`).digest("hex");
  const prefix = `project/freshness/source/nces-ccd/releases/${identity}`, key = `${prefix}/${hash}.bin`;
  const body = new TextEncoder().encode("the existing immutable source archive");
  await vault.put(key, body, { contentType: "application/zip", contentHash: `sha256-${hash}`, byteLength: body.length });
  const manifest = new TextEncoder().encode(JSON.stringify({ sourceId: "nces-ccd", releaseId, requestedUrl: SOURCE,
    finalUrl: SOURCE, sha256: hash, key, sourceObservedAt: NOW, retrievedAt: NOW, checkedAt: NOW, byteLength: body.length }));
  await vault.put(`${prefix}/manifest.json`, manifest, { contentType: "application/json", contentHash: "manifest:fixture", byteLength: manifest.length, objectClass: "MUTABLE_INDEX" });
  return { db, vault, key };
}

test("held national physical office fields publish to the owning government through the fact door without rereading the archive", async () => {
  const { db, vault } = await setup();
  const reads: string[] = [], ordinaryGet = vault.get.bind(vault);
  vault.get = async key => { reads.push(key); return ordinaryGet(key); };
  try {
    const first = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.deepEqual(first, { published: 1, confirmed: 0, blanks: 1, failures: [] });
    assert.deepEqual(await db.query("SELECT entity_id,field,value FROM fact WHERE status='live'"), [{ entity_id: GOVERNMENT, field: "office_address", value: NCES_ADDRESS }]);
    const copy = (await db.query("SELECT url,blob_key,fetched_at FROM source_copy"))[0]!;
    assert.equal(copy.url, SOURCE); assert.ok(String(copy.blob_key).startsWith("release:nces-ccd-directory:")); assert.equal(new Date(String(copy.fetched_at)).toISOString(), NOW);
    assert.ok(reads.every(read => read.endsWith("manifest.json")), "only the manifest, never source archive bytes, leaves the vault");
    const blank = (await db.query("SELECT entity_id,field,next_try_at FROM blank WHERE entity_id=$1",[BODY]))[0]!;
    assert.deepEqual(await db.query("SELECT entity_id,reason FROM blank WHERE entity_id=$1",[GOVERNMENT]), []);
    assert.equal(blank.entity_id, BODY); assert.equal(blank.field, "office_address");
    assert.ok(Date.parse(String(blank.next_try_at)) > Date.now());
    const next = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(next.published, 0); assert.equal(next.confirmed, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM fact"))[0]!.n, 1);
  } finally { await db.pg.close(); }
});

test("a government office publishes without any body or meeting referencing it", async () => {
  const { db, vault } = await setup();
  try {
    await db.query("DELETE FROM entity WHERE id=$1", [BODY]);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [GOVERNMENT], more: () => true });
    assert.deepEqual(report, { published: 1, confirmed: 0, blanks: 0, failures: [] });
    assert.deepEqual(await db.query("SELECT entity_id,value FROM fact WHERE field='office_address' AND status='live'"), [{entity_id: GOVERNMENT,value: NCES_ADDRESS}]);
  } finally { await db.pg.close(); }
});

test("a newly verified government office wakes a place-parented subbody's pin work without resetting its attempts",async()=>{
  const {db,vault}=await setup(),subbody=`${PLACE}#body:finance`,meeting="meeting:future-office-retry";
  try{
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{governments,0,aliases}',$1)",[JSON.stringify([GOVERNMENT,`${PLACE}#governing`])]);
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body','Finance','AZ',$2),($3,'meeting','Finance meeting','AZ',$1)",[subbody,PLACE,meeting]);
    await db.query("INSERT INTO blank(entity_id,field,stage,reason,next_try_at,attempts) VALUES($1,'map_pin','ACQUIRE','BODY_OFFICE_ADDRESS_MISSING',$2,7)",[meeting,"2026-10-30T00:00:00Z"]);
    await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true});
    const [blank]=await db.query("SELECT next_try_at,attempts FROM blank WHERE entity_id=$1 AND field='map_pin'",[meeting]);
    assert.equal(new Date(String(blank!.next_try_at)).toISOString(),NOW);
    assert.equal(blank!.attempts,7);
  }finally{await db.pg.close();}
});

test("an unreadable held office citation records a source failure instead of an absent address",async()=>{
  const {db,vault}=await setup("PO Box 123, Tucson, AZ 85706");
  try{
    const report=await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true,
      offices:new Map([[BODY,{bodyId:BODY,name:"Board",officeContact:{address:ADDRESS,phone:null,provenance:{...provenance,sourceUrl:"https://district.az.gov/contact"}}}]]),
      readCapture:async()=>{throw Error("source connection failed");}});
    assert.ok(report.failures.some(detail=>detail.includes("source connection failed")));
    assert.equal((await db.query("SELECT reason FROM blank WHERE entity_id=$1 AND field='office_address'",[BODY]))[0]!.reason,"OFFICE_SOURCE_UNAVAILABLE");
  }finally{await db.pg.close();}
});

test("office repair never fetches a calendar citation to recover an unsaved header",async()=>{
  const {db,vault}=await setup("PO Box 123");
  try{
    const report=await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true,
      offices:new Map([[BODY,{bodyId:BODY,name:"Board",officeContact:{address:ADDRESS,phone:null,provenance:{...provenance,sourceUrl:"https://district.az.gov/common/modules/iCalendar"}}}]]),
      readCapture:async()=>{throw Error("A calendar was fetched by office repair");}});
    assert.equal(report.published,0);assert.deepEqual(report.failures,[]);
    assert.equal((await db.query("SELECT count(*) AS count FROM blank WHERE field='office_address'"))[0]!.count,2);
  }finally{await db.pg.close();}
});

test("a postal box cannot become a street office fact", async () => {
  const { db, vault } = await setup("P.O. Box 123, Tucson, AZ 85706");
  try {
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(report.published, 0); assert.equal(report.blanks, 2);
    assert.deepEqual(await db.query("SELECT field FROM fact"), []);
    assert.equal((await db.query("SELECT count(*)::int n FROM blank WHERE field='office_address'"))[0]!.n, 2);
  } finally { await db.pg.close(); }
});

test("a newly held official physical office replaces an older address through the same fact door", async () => {
  const { db, vault } = await setup();
  try {
    const old = "100 Old Street, Tucson, AZ 85706", at = "2026-10-01T00:00:00.000Z";
    const [copy] = await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
      VALUES('https://district.az.gov/contact','https://district.az.gov/contact',$1,$2,'old-office') RETURNING id`, [at, "f".repeat(64)]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'office_address',$2,$3,'live','OFFICIAL',$4,$3,$5,'fixture')`, [GOVERNMENT, JSON.stringify(old), old, copy!.id, at]);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(report.published, 1);
    assert.deepEqual(await db.query("SELECT value,status FROM fact WHERE entity_id=$1 AND field='office_address' ORDER BY id", [GOVERNMENT]), [
      { value: old, status: "superseded" }, { value: NCES_ADDRESS, status: "live" },
    ]);
  } finally { await db.pg.close(); }
});

test("an NCES address is quoted from the file's own row and checked there; no blank opens", async () => {
  const { db, vault } = await setup();
  try {
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(report.published, 1); assert.deepEqual(report.failures, []);
    const [fact] = await db.query("SELECT value_text,quote,quote_start IS NOT NULL AS checked FROM fact WHERE entity_id=$1 AND field='office_address'", [GOVERNMENT]);
    assert.equal(fact!.value_text, "2238 E GINTER RD,,,TUCSON,AZ,85706", "the address as the file's row writes it");
    assert.ok(String(fact!.quote).startsWith("0408170,2025-2026,AZ,") && fact!.checked);
    assert.deepEqual(await db.query("SELECT reason FROM blank WHERE entity_id=$1", [GOVERNMENT]), []);
  } finally { await db.pg.close(); }
});

test("an NCES address absent from the file's native row never goes live; the one published unchecked before moves to held with the reason", async () => {
  const { db, vault } = await setup("99 Wrong Street, Tucson, AZ 85706");
  try {
    const [copy] = await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
      VALUES($1,$1,$2,$3,'old-nces') RETURNING id`, [SOURCE, NOW, "f".repeat(64)]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'office_address','"99 Wrong Street, Tucson, AZ 85706"','99 Wrong Street, Tucson, AZ 85706','live','OFFICIAL',$2,'99 Wrong Street, Tucson, AZ 85706',$3,'held-office-addresses')`, [GOVERNMENT, copy!.id, NOW]);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(report.published, 0); assert.equal(report.blanks, 2); assert.deepEqual(report.failures, []);
    assert.deepEqual(await db.query("SELECT status,held_reason FROM fact"), [{ status: "held", held_reason: "CHECK_FAILED:NO_EXACT_LINE" }]);
    assert.deepEqual(await db.query("SELECT entity_id,reason FROM blank WHERE entity_id=$1", [GOVERNMENT]), [{ entity_id: GOVERNMENT, reason: "CHECK_FAILED:NO_EXACT_LINE" }]);
  } finally { await db.pg.close(); }
});

test("sharing a place does not give a board either neighboring government's office", async () => {
  const { db, vault } = await setup();
  try {
    await db.query("UPDATE entity SET parent_id=$2 WHERE id=$1", [BODY, PLACE]);
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:school:neighbor','government','Neighbor School District','AZ',$1)", [PLACE]);
    const governments = [GOVERNMENT, "az:school:neighbor"].map((id, index) => ({ id, jurisdictionId: PLACE,
      aliases: [PLACE], bodyIds: [], state: STATE, name: `District ${index}`, officeAddress: ADDRESS, provenance }));
    await db.query("UPDATE civic_data_promotions SET payload=$1", [JSON.stringify({ governments })]);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true });
    assert.equal(report.published, 0); assert.equal(report.blanks, 1);
    assert.deepEqual(await db.query("SELECT field FROM fact"), []);
    assert.deepEqual(await db.query("SELECT entity_id FROM blank WHERE reason NOT LIKE 'CHECK_FAILED%'"), [{ entity_id: BODY }]);
  } finally { await db.pg.close(); }
});

test("a sole directory government sharing only a place alias never supplies a board's office",async()=>{
  const {db,vault}=await setup();
  try{
    await db.query("UPDATE entity SET parent_id=$2 WHERE id=$1",[BODY,PLACE]);
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(jsonb_set(payload,'{governments,0,bodyIds}','[]'),'{governments,0,aliases}',$1)",
      [JSON.stringify([GOVERNMENT,`${PLACE}#governing`])]);
    const [target]=await db.query(OFFICE_FACT_TARGETS_SQL,[[BODY]]);
    assert.equal(target!.government_id,null);assert.equal(target!.registration_address,null);
    const report=await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true});
    assert.equal(report.published,0);assert.deepEqual(await db.query("SELECT field FROM fact"),[]);
  }finally{await db.pg.close();}
});

for (const suffix of ["#governing", "#board"]) test(`a subboard resolves its exact government through its registered body identity beside the ${suffix} alias`, async () => {
  const { db, vault } = await setup();
  try {
    const subbody = `${PLACE}#body:planning`, homepage = "https://sunnyside.example.gov/", neighbor = "az:school:neighbor";
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body','Planning Board','AZ',$2),
      ($3,'government','Neighbor School District','AZ',$2)`, [subbody, PLACE, neighbor]);
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')", [GOVERNMENT]);
    await db.query("UPDATE civic_data_promotions SET payload=$1", [JSON.stringify({ governments: [
      { id: "government:US-AZ:nces:0408170", jurisdictionId: GOVERNMENT, state: STATE, aliases: [GOVERNMENT, `${PLACE}${suffix}`],
        bodyIds: [subbody], name: "Sunnyside Unified School District", officeAddress: NCES_ADDRESS, website: homepage, provenance, nativeIds: { nces_leaid: "0408170" } },
      { id: neighbor, jurisdictionId: neighbor, state: STATE, aliases: [neighbor], bodyIds: [], name: "Neighbor School District",
        officeAddress: "88 Neighbor Street, Tucson, AZ 85706", website: "https://neighbor.example.gov/", provenance },
    ] })]);
    const [target] = await db.query(OFFICE_FACT_TARGETS_SQL, [[subbody]]);
    assert.equal(target!.government_id, GOVERNMENT); assert.equal(target!.government_homepage, homepage);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [subbody], more: () => true,
      readCapture: async () => { throw new Error("The held exact government address needs no site reread"); } });
    assert.equal(report.published, 1); assert.deepEqual(report.failures, []);
    assert.deepEqual(await db.query("SELECT entity_id,value FROM fact WHERE field='office_address' AND status='live'"),
      [{ entity_id: GOVERNMENT, value: NCES_ADDRESS }]);
    assert.deepEqual(await db.query("SELECT entity_id FROM blank WHERE field='office_address' AND reason NOT LIKE 'CHECK_FAILED%'"), [{ entity_id: subbody }]);
  } finally { await db.pg.close(); }
});

test("a canonical subbody's own native government prefix survives its older place parent", async () => {
  const { db, vault } = await setup();
  try {
    const subbody = "government:US-AZ:nces:0408170#body:planning", homepage = "https://sunnyside.example.gov/";
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body','Planning Board','AZ',$2)", [subbody, PLACE]);
    await db.query(`UPDATE civic_data_promotions SET payload=jsonb_set(jsonb_set(payload,'{governments,0,bodyIds}','[]'),
      '{governments,0,website}',$1)`, [JSON.stringify(homepage)]);
    const [target] = await db.query(OFFICE_FACT_TARGETS_SQL, [[subbody]]);
    assert.equal(target!.government_id, GOVERNMENT); assert.equal(target!.government_homepage, homepage);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [subbody], more: () => true });
    assert.equal(report.published, 1); assert.deepEqual(report.failures, []);
    assert.deepEqual(await db.query("SELECT entity_id,value FROM fact WHERE field='office_address' AND status='live'"),
      [{ entity_id: GOVERNMENT, value: NCES_ADDRESS }]);
  } finally { await db.pg.close(); }
});

test("an issuing board's saved office header publishes independently of its government's office", async () => {
  const { db, vault } = await setup();
  try {
    const url = "https://district.az.gov/board/agenda.pdf";
    const saved = await vaultCapture({ vault, url, bytes: new TextEncoder().encode(`Governing Board\nPhysical office\n${ADDRESS}\nAgenda`),
      httpStatus: 200, contentType: "text/plain", retrievedAt: NOW });
    assert.ok("capture" in saved);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      offices: new Map([[BODY, { bodyId: BODY, name: "Governing Board", officeContact: { address: ADDRESS, phone: null,
        provenance: { ...provenance, sourceUrl: url } } }]]),
      readCapture: async requested => requested === url ? saved.capture : null });
    assert.equal(report.published, 2); assert.equal(report.blanks, 0);
    assert.deepEqual((await db.query("SELECT entity_id FROM fact WHERE field='office_address' AND status='live' ORDER BY entity_id")).map(row => row.entity_id), [GOVERNMENT, BODY].sort());
  } finally { await db.pg.close(); }
});

test("a canonical office value cites its literal line-broken mixed-case state header through the ordinary checker", async () => {
  const { db, vault } = await setup();
  try {
    const url = "https://district.az.gov/board/agenda.pdf", quote = "2238 E. Ginter Road\nTucson, Az 85706";
    const saved = await vaultCapture({ vault, url, bytes: new TextEncoder().encode(`Governing Board\n${quote}\nMeeting Agenda`),
      httpStatus: 200, contentType: "text/plain", retrievedAt: NOW });
    assert.ok("capture" in saved);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      offices: new Map([[BODY, { bodyId: BODY, name: "Governing Board", officeContact: { address: ADDRESS, phone: null, quote,
        provenance: { ...provenance, sourceUrl: url } } }]]), readCapture: async requested => requested === url ? saved.capture : null });
    assert.equal(report.published, 2); assert.deepEqual(report.failures, []);
    const [fact] = await db.query("SELECT value,value_text,quote FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'", [BODY]);
    assert.deepEqual(fact, { value: ADDRESS, value_text: quote, quote });
  } finally { await db.pg.close(); }
});

test("an immutable held agenda header supplies the office fact without fetching or restamping the document", async () => {
  const { db, vault } = await setup();
  try {
    const url = "https://district.az.gov/board/agenda.pdf", at = "2026-10-25T09:14:12.883Z";
    const quote = "2238 E. Ginter Road\nTucson, Az 85706", header = `Governing Board\n${quote}\nMeeting Agenda`;
    const fullSavedDocument = `${header}\nCall to order\n1. Approve minutes\n2. Adjourn`;
    const sha256 = createHash("sha256").update(fullSavedDocument).digest("hex"), versionId = "cv-held-agenda-office";
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      offices: new Map([[BODY, { bodyId: BODY, name: "Governing Board", officeContact: { address: ADDRESS, phone: null, quote,
        provenance: { ...provenance, sourceUrl: url, collectedAt: at }, savedSource: { versionId, sha256, text: header } } }]]) });
    assert.equal(report.published, 2); assert.equal(report.blanks, 0); assert.deepEqual(report.failures, []);
    const [fact] = await db.query(`SELECT f.value,f.value_text,s.url,s.sha256,s.blob_key,s.fetched_at,s.http_status FROM fact f
      JOIN source_copy s ON s.id=f.source_copy_id WHERE f.entity_id=$1 AND f.field='office_address' AND f.status='live'`, [BODY]);
    assert.equal(fact!.value, ADDRESS); assert.equal(fact!.value_text, quote); assert.equal(fact!.url, url);
    assert.equal(fact!.sha256, sha256); assert.equal(fact!.blob_key, `civic-data:${versionId}:agenda:${sha256}`);
    assert.equal(new Date(fact!.fetched_at as string).toISOString(), at); assert.equal(fact!.http_status, null);
  } finally { await db.pg.close(); }
});

test("a held header's metadata cannot publish an office quote absent from its actual text", async () => {
  const { db, vault } = await setup();
  try {
    const header = `Governing Board\n${ADDRESS}\nMeeting Agenda`;
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      offices: new Map([[BODY, { bodyId: BODY, name: "Governing Board", officeContact: { address: ADDRESS, phone: null, quote: "An office quote absent from the document",
        provenance: { ...provenance, sourceUrl: "https://district.az.gov/board/agenda.pdf" }, savedSource: {
          versionId: "cv-held-agenda-office", sha256: createHash("sha256").update(header).digest("hex"), text: header } } }]]) });
    assert.equal(report.published, 1, "only the independently held government address publishes");
    assert.deepEqual(await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'", [BODY]), []);
    assert.deepEqual(await db.query("SELECT reason FROM blank WHERE entity_id=$1 AND field='office_address'", [BODY]), [{ reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
  } finally { await db.pg.close(); }
});

test("own-site office acquisition follows contact links using the caller's capture reader and respects the standing retry", async () => {
  const { db, vault } = await setup("PO Box 123");
  try {
    const homepage = "https://sunnyside.example.gov/", contact = `${homepage}contact`;
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')", [BODY]);
    const saved = await Promise.all([`<a href='/contact'>Contact us</a>`, `<h1>Governing Board</h1><h2>Physical Address</h2><address>${ADDRESS}</address>`].map((text, index) =>
      vaultCapture({ vault, url: index ? contact : homepage, bytes: new TextEncoder().encode(text), httpStatus: 200,
        contentType: "text/html", retrievedAt: NOW })));
    const requests: string[] = [];
    const readCapture = async (url: string) => { requests.push(url); const row = saved[url === homepage ? 0 : 1]!; return "capture" in row ? row.capture : null; };
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true, readCapture });
    assert.equal(report.published, 1); assert.equal(report.blanks, 1); assert.deepEqual(requests, [homepage, contact]);
    assert.equal((await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'", [BODY]))[0]!.value, ADDRESS);
    requests.length = 0;
    await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true, readCapture });
    assert.deepEqual(requests, [], "known office and not-yet-due unresolved government make no website request");
  } finally { await db.pg.close(); }
});

test("an office fetched after the pass starts publishes using the current check time",async()=>{
  const {db,vault}=await setup("PO Box 123");
  try{
    const homepage="https://sunnyside.example.gov/",capturedAt="2026-10-26T06:31:00.000Z";
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')",[BODY]);
    const saved=await vaultCapture({vault,url:homepage,bytes:new TextEncoder().encode(`<address>${ADDRESS}</address>`),httpStatus:200,contentType:"text/html",retrievedAt:capturedAt});
    const report=await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(capturedAt)+1000,bodyIds:[BODY],more:()=>true,
      readCapture:async()=>"capture" in saved?saved.capture:null});
    assert.equal(report.published,1);assert.deepEqual(report.failures,[]);
    assert.equal((await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'",[BODY]))[0]!.value,ADDRESS);
  }finally{await db.pg.close();}
});

test("an official HTTP homepage upgrades to HTTPS and follows its relative public contact link", async () => {
  const { db, vault } = await setup("PO Box 123");
  try {
    const original="http://sunnyside.example.gov/",homepage = "https://sunnyside.example.gov/", contact = `${homepage}contact`;
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')", [GOVERNMENT]);
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{governments,0,website}',$1)", [JSON.stringify(original)]);
    const saved = await Promise.all(["<a href='/contact'>Contact</a>", `<address>${ADDRESS}</address>`].map((text, index) =>
      vaultCapture({ vault, url: index ? contact : homepage, bytes: new TextEncoder().encode(text), httpStatus: 200, contentType: "text/html", retrievedAt: NOW })));
    const requested: string[] = [];
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      readCapture: async url => { requested.push(url); const value = saved[url === homepage ? 0 : 1]!; return "capture" in value ? value.capture : null; } });
    assert.equal(report.published, 1); assert.deepEqual(requested, [homepage, contact]);
    assert.equal((await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'", [GOVERNMENT]))[0]!.value, ADDRESS);
  } finally { await db.pg.close(); }
});

test("an unavailable office source stays a source failure with its own retry",async()=>{
  const {db,vault}=await setup("PO Box 123");
  try{
    const homepage="http://sunnyside.example.gov/",requests:string[]=[];
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')",[GOVERNMENT]);
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{governments,0,website}',$1)",[JSON.stringify(homepage)]);
    const input={facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true,
      readCapture:async(url:string)=>{requests.push(url);throw Error("The source connection failed");}};
    const report=await publishHeldOfficeFacts(input);
    assert.deepEqual(requests,[homepage.replace("http:","https:"),homepage]);
    assert.ok(report.failures.some(reason=>reason.includes("source connection failed")));
    const blank=(await db.query("SELECT reason,detail,next_try_at FROM blank WHERE entity_id=$1 AND field='office_address'",[GOVERNMENT]))[0];
    assert.equal(blank.reason,"OFFICE_SOURCE_UNAVAILABLE");assert.equal(JSON.parse(String(blank.detail)).sourceUrl,homepage.replace("http:","https:"));
    assert.ok(Date.parse(String(blank.next_try_at))>Date.parse(NOW));
    await publishHeldOfficeFacts(input);assert.equal(requests.length,2,"the unchanged unavailable source waits for its scheduled retry");
  }finally{await db.pg.close();}
});

test("a government site without HTTPS can still supply its published office over HTTP",async()=>{
  const {db,vault}=await setup("PO Box 123");
  try{
    const homepage="http://sunnyside.example.gov/",requests:string[]=[];
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')",[GOVERNMENT]);
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{governments,0,website}',$1)",[JSON.stringify(homepage)]);
    const saved=await vaultCapture({vault,url:homepage,bytes:new TextEncoder().encode(`<address>${ADDRESS}</address>`),httpStatus:200,contentType:"text/html",retrievedAt:NOW});
    assert.ok("capture" in saved);
    const report=await publishHeldOfficeFacts({facts:db,vault,clocks:factClocks(null),now:NOW,bodyIds:[BODY],more:()=>true,
      readCapture:async url=>{requests.push(url);return url===homepage?saved.capture:null;}});
    assert.equal(report.published,1);assert.deepEqual(report.failures,[]);
    assert.deepEqual(requests,[homepage.replace("http:","https:"),homepage]);
  }finally{await db.pg.close();}
});

test("a newly found own-site route resumes a future office blank without advancing time", async () => {
  const { db, vault } = await setup("PO Box 123");
  try {
    const common = { facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true };
    await publishHeldOfficeFacts(common);
    const [before] = await db.query("SELECT next_try_at,detail FROM blank WHERE entity_id=$1 AND field='office_address'", [BODY]);
    assert.ok(Date.parse(String(before!.next_try_at)) > Date.parse(NOW)); assert.equal(JSON.parse(String(before!.detail)).sourceUrl, null);
    const homepage = "https://sunnyside.example.gov/";
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')", [BODY]);
    const saved = await vaultCapture({ vault, url: homepage, bytes: new TextEncoder().encode(`<address>${ADDRESS}</address>`),
      httpStatus: 200, contentType: "text/html", retrievedAt: NOW });
    assert.ok("capture" in saved);
    const requested: string[] = [];
    const report = await publishHeldOfficeFacts({ ...common, readCapture: async url => { requested.push(url); return saved.capture; } });
    assert.equal(report.published, 1); assert.deepEqual(requested, [homepage]);
    assert.equal((await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'", [BODY]))[0]!.value, ADDRESS);
    assert.deepEqual(await db.query("SELECT entity_id FROM blank WHERE entity_id=$1 AND field='office_address'", [BODY]), []);
  } finally { await db.pg.close(); }
});

test("an unchanged failing office route stays scheduled even when its URL spelling gains a trailing slash", async () => {
  const { db, vault } = await setup("PO Box 123");
  try {
    const common = { facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true };
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'sunnyside.example.gov')", [BODY]);
    const saved = await vaultCapture({ vault, url: "https://sunnyside.example.gov/", bytes: new TextEncoder().encode("Contact us for office information"),
      httpStatus: 200, contentType: "text/plain", retrievedAt: NOW });
    assert.ok("capture" in saved);
    let requests = 0;
    await publishHeldOfficeFacts({ ...common, readCapture: async () => { requests++; return saved.capture; } });
    assert.equal(requests, 1);
    await db.query("UPDATE blank SET detail=jsonb_set(detail::jsonb,'{sourceUrl}','\"https://sunnyside.example.gov\"'::jsonb)::text WHERE entity_id=$1 AND field='office_address'", [BODY]);
    await publishHeldOfficeFacts({ ...common, readCapture: async () => { requests++; throw new Error("Unchanged route retried before due"); } });
    assert.equal(requests, 1);
  } finally { await db.pg.close(); }
});

test("the exact government's saved municipal hall becomes a contact fact as well as a pin fallback", async () => {
  const { db, vault } = await setup("PO Box 123");
  try {
    const url = "https://district.az.gov/meetings/agenda";
    const saved = await vaultCapture({ vault, url, bytes: new TextEncoder().encode(`Sunnyside Unified School District\nTown Hall\n${ADDRESS}`),
      httpStatus: 200, contentType: "text/plain", retrievedAt: NOW });
    assert.ok("capture" in saved);
    const report = await publishHeldOfficeFacts({ facts: db, vault, clocks: factClocks(null), now: NOW, bodyIds: [BODY], more: () => true,
      offices: new Map([[BODY, { bodyId: BODY, name: "Governing Board", governmentOfficeAlternatives: [{ name: "Sunnyside Unified School District",
        address: ADDRESS, provenance: { ...provenance, sourceUrl: url } }] }]]),
      readCapture: async requested => requested === url ? saved.capture : null });
    assert.equal(report.published, 1); assert.equal(report.blanks, 1);
    assert.deepEqual(await db.query("SELECT entity_id,value FROM fact WHERE field='office_address' AND status='live'"), [{ entity_id: GOVERNMENT, value: ADDRESS }]);
  } finally { await db.pg.close(); }
});

test("street office parsing requires a physical address, its state and an office context", () => {
  assert.equal(streetOfficeAddress("P.O. Box 123"), false);
  assert.equal(streetOfficeAddress("123 Main Street, Tucson, AZ 85706"), true);
  assert.deepEqual(officeAddressesOnPage("Meeting at 123 Main Street, Tucson, AZ 85706", "AZ"), []);
  assert.deepEqual(officeAddressesOnPage("Physical Address\n123 Main Street\nTucson, AZ 85706", "AZ"), [{ address: "123 Main Street Tucson, AZ 85706", quote: "123 Main Street Tucson, AZ 85706" }]);
  assert.deepEqual(officeAddressesOnPage("Physical Address\n123 Main Street\nTucson, CA 85706", "AZ"), []);
  assert.deepEqual(officeAddressesOnPage("Physical Address\n123 Main Street\nTucson, Arizona 85706", "AZ"), [{ address: "123 Main Street Tucson, Arizona 85706", quote: "123 Main Street Tucson, Arizona 85706" }],
    "the quote retains the state name as published");
});

test("the government's own footer supplies contact addresses while distinct offices remain ambiguous",()=>{
  const footer="<div class='siteFooter'><p>City government</p><div>123 Main Street<br>Tucson AZ 85706</div></div>";
  assert.deepEqual(officeAddressesOnPage(footer,"AZ"),[{address:"123 Main Street Tucson AZ 85706",quote:"123 Main Street Tucson AZ 85706"}]);
  const other=footer.replace("</div></div>","</div><div>456 Second Street<br>Tucson AZ 85706</div></div>");
  assert.equal(officeAddressesOnPage(other,"AZ").length,2,"different published offices are not chosen by order");
  assert.equal(officeAddressesOnPage(`<address>${ADDRESS}</address>${other}`,"AZ").length,1,"an explicit office block is not held by generic footer addresses");
  const county="<footer><p>Probate Court<br>142 Federal Street<br>Portland ME 04101</p><p>Cumberland County<br>27 Northport Drive<br>Portland ME 04103</p></footer>";
  assert.deepEqual(officeAddressesOnPage(county,"ME","County of Cumberland"),[{address:"27 Northport Drive Portland ME 04103",quote:"27 Northport Drive Portland ME 04103"}],"the government's own labeled office takes precedence over a separate court");
});
