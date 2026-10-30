import assert from "node:assert/strict";
import test from "node:test";

import { claimPlacementQuestions, ensurePlacement, placeBodies, settlePlacement } from "../lib/facts/portal-publication.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { decidePlacement, placementTurn, type PlacementCase } from "../lib/identity/placement-agent.ts";
import type { ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MODELS } from "../lib/models.ts";
import { factDb } from "./helpers/fact-db.ts";

const WA = "ocd-division/country:us/state:wa", TACOMA = `${WA}/place:tacoma`, CITY = "wa:city:city-of-tacoma";
const SHELL = `${TACOMA}#body:city-council-study-session`, COUNCIL = `${TACOMA}#governing`, WHOLE = `${TACOMA}#body:committee-of-the-whole`;
const PEOPLE = ["ocd-person/a", "ocd-person/b"];

async function seeded() {
  const db = await factDb();
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ('ocd-division/country:us','place','United States',NULL,NULL),($1,'place','Washington','WA',NULL),($2,'place','Tacoma','WA',$1),
    ($3,'government','City Of Tacoma','WA',$2),('wa:city:city-of-olympia','government','City Of Olympia','WA',$4),($4,'place','Olympia','WA',$1),
    ($5,'body','City Council','WA',$2),($6,'body','City Council Study Session','WA',$2),($7,'body','Committee of the Whole','WA',$2),
    ('ocd-person/a','person','Latasha Palmer','WA',NULL),('ocd-person/b','person','Olgy Diaz','WA',NULL),
    ('meeting:legistar:tacoma:1','meeting','Study session','WA',$6)`, [WA, TACOMA, CITY, `${WA}/place:olympia`, COUNCIL, SHELL, WHOLE]);
  await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES ($1,'census-pid6','176885'),($2,'body-alias',$3)", [CITY, COUNCIL, SHELL]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://a','https://a','2026-01-01',repeat('a',64),'a'),(2,'https://b','https://b','2026-06-01',repeat('b',64),'b')");
  const fact = (entity: string, field: string, value: string, copy: number) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
    VALUES($1,$2,to_jsonb($3::text),$3,'live','OFFICIAL',$4,$3,now(),now(),'test')`, [entity, field, value, copy]);
  for (const person of PEOPLE) {
    await fact(person, `office:${SHELL}`, "Council Member", 1);
    await fact(person, `term_start:${SHELL}`, "2024-01-01", 1);
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES ($1,$2,$3)", [person, `roster-name:${SHELL}`, person.slice(-1)]);
    await fact(SHELL, `member:${person}`, "seat", 1);
  }
  await fact("ocd-person/a", `office:${COUNCIL}`, "Council Member", 2);
  await db.query("INSERT INTO entity_host(entity_id,host) VALUES ($1,'cityoftacoma.legistar.com'),($2,'cityoftacoma.org')", [SHELL, CITY]);
  await db.query("INSERT INTO blank(entity_id,field,stage,reason) VALUES ($1,'office_address','ACQUIRE','STREET_OFFICE_ADDRESS_MISSING')", [SHELL]);
  await db.query("INSERT INTO place_page(place_id,body) VALUES ($1,'{}')", [SHELL]);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES ($1,$2),('ocd-person/a',$3),('ocd-person/a',$2),('ocd-person/b',$3)", [CITY, TACOMA, CITY]);
  return db;
}

test("a body folded into the council gives the council its people, seats and keys, and Tacoma's bodies hang on the city", async () => {
  const db = await seeded();
  try {
    const report = await placeBodies(db, "WA", async () => ({ purged: true }));
    assert.deepEqual(report, { merged: 1, hung: 2, asked: 0 });
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1", [SHELL]), [], "the study session is no longer a body of its own");
    assert.equal(await resolveId(SHELL, db.query), COUNCIL, "and still reaches the council");
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id IN ($1,$2) ORDER BY id", [COUNCIL, WHOLE]), [{ parent_id: CITY }, { parent_id: CITY }]);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id='meeting:legistar:tacoma:1'"), [{ parent_id: COUNCIL }]);
    const seats = await db.query("SELECT entity_id, field, status FROM fact WHERE field LIKE 'office:%' OR field LIKE 'term_start:%' ORDER BY entity_id, field, status");
    assert.deepEqual(seats.filter(row => row.status === "live").map(row => [row.entity_id, row.field]),
      [["ocd-person/a", `office:${COUNCIL}`], ["ocd-person/a", `term_start:${COUNCIL}`], ["ocd-person/b", `office:${COUNCIL}`], ["ocd-person/b", `term_start:${COUNCIL}`]],
      "each council member has one seat, filed under the council");
    assert.equal(seats.filter(row => String(row.field).includes("study-session")).length, 0);
    assert.deepEqual(await db.query("SELECT scheme FROM entity_external_id WHERE scheme LIKE 'roster-name:%' ORDER BY entity_id"),
      [{ scheme: `roster-name:${COUNCIL}` }, { scheme: `roster-name:${COUNCIL}` }]);
    assert.deepEqual(await db.query("SELECT field FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field", [COUNCIL]), [{ field: "member:ocd-person/a" }, { field: "member:ocd-person/b" }]);
    assert.deepEqual(await db.query("SELECT host FROM entity_host WHERE entity_id=$1", [COUNCIL]), [{ host: "cityoftacoma.legistar.com" }]);
    assert.deepEqual(await db.query("SELECT field FROM blank WHERE entity_id=$1", [COUNCIL]), [{ field: "office_address" }]);
    assert.deepEqual(await db.query("SELECT 1 FROM place_page WHERE place_id=$1", [SHELL]), []);
    assert.deepEqual(await placeBodies(db, "WA"), { merged: 0, hung: 0, asked: 0 }, "a second pass changes nothing");
  } finally { await db.pg.close(); }
});

test("a body folded into one whose page is still waiting to be rebuilt keeps its own page until then", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO rebuild_queue(place_id) VALUES ($1)", [COUNCIL]);
    assert.equal((await placeBodies(db, "WA")).merged, 0);
    assert.equal((await db.query("SELECT 1 FROM entity WHERE id=$1", [SHELL])).length, 1);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id=$1", [SHELL]), [{ parent_id: null }], "off the government, so it cannot count as a second board");
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%'", [SHELL])).length, 0, "everything it held has moved");
    await db.query("UPDATE rebuild_queue SET built_generation=generation");
    assert.equal((await placeBodies(db, "WA")).merged, 1);
    assert.equal((await db.query("SELECT 1 FROM entity WHERE id=$1", [SHELL])).length, 0);
  } finally { await db.pg.close(); }
});

test("a person placed on a government's id is placed on the place it governs, once", async () => {
  const db = await seeded();
  try {
    await placeBodies(db, "WA");
    assert.deepEqual(await db.query("SELECT entity_id, place_id FROM entity_place WHERE entity_id LIKE 'ocd-person/%' ORDER BY entity_id"),
      [{ entity_id: "ocd-person/a", place_id: TACOMA }, { entity_id: "ocd-person/b", place_id: TACOMA }]);
  } finally { await db.pg.close(); }
});

test("a government's two boards, and a body that carries its Census id, are placed from the ids; an undecidable body is asked about", async () => {
  const db = await factDb();
  try {
    const AZ = "ocd-division/country:us/state:az", PIMA = `${AZ}/county:pima`, GOV = "az:county:county-of-pima", FIRST = `${GOV}#governing`, SECOND = `${PIMA}#governing`;
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ($1,'place','Arizona','AZ',NULL),($2,'place','Pima County','AZ',$1),($3,'government','County Of Pima','AZ',$2),
      ('az:special:rta','government','Pima RTA','AZ',$2),
      ($4,'body','County Of Pima governing board','AZ',$3),($5,'body','Pima County Regional Transportation Authority governing board','AZ',$3),
      ('meeting:pima:1','meeting','BOS','AZ',$5),('meeting:pima:2','meeting','BOS','AZ',$5),
      ('government:US-AZ:cog:99#body:flood','body','Flood Board','AZ',NULL),('az:special:fire','government','Fire District','AZ',$6),
      ($6,'place','Fire District','AZ',$1),('az:special:fire2','government','Other District','AZ',$6),($7,'body','Joint Board','AZ',$6)`,
    [AZ, PIMA, GOV, FIRST, SECOND, `${AZ}/special_district:fire`, `${AZ}/special_district:fire#body:joint`]);
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES ($1,'census-pid6','99')", [GOV]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://a','https://a','2026-01-01',repeat('a',64),'a')");
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
      VALUES ($1,'name','"Board of Supervisors"','Board of Supervisors','live','OFFICIAL',1,'Board of Supervisors',now(),now(),'test')`, [SECOND]);
    const report = await placeBodies(db, "AZ");
    assert.deepEqual(report, { merged: 1, hung: 1, asked: 1 });
    assert.deepEqual(await db.query("SELECT id, name FROM entity WHERE kind='body' AND id IN ($1,$2)", [FIRST, SECOND]), [{ id: SECOND, name: "County Of Pima governing board" }],
      "the fuller record survives and takes the name that is the county's board; the other id is an alias");
    assert.equal(await resolveId(FIRST, db.query), SECOND);
    assert.deepEqual(await db.query("SELECT field, value_text FROM fact WHERE entity_id=$1 AND status='live'", [SECOND]), [{ field: "name", value_text: "Board of Supervisors" }]);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id='government:US-AZ:cog:99#body:flood'"), [{ parent_id: GOV }], "its Census id names its government");
    const [ask] = await db.query("SELECT entity_id, field, reason, detail FROM blank WHERE reason='PLACEMENT_QUESTION'");
    assert.deepEqual([ask!.entity_id, ask!.field, JSON.parse(String(ask!.detail)).candidates], [`${AZ}/special_district:fire#body:joint`, "placement:owner", ["az:special:fire", "az:special:fire2"]]);
  } finally { await db.pg.close(); }
});

const answer = (input: Record<string, unknown>, model: string = MODELS.sonnet.model): ModelResponse => ({ model, stop_reason: "tool_use", usage: {} as ModelResponse["usage"],
  content: [{ type: "tool_use", id: "t", name: "place", input }] });
const found = (pages: PlacementCase["pages"]): PlacementCase => ({ question: { kind: "OWNER", subject: "body:x", candidates: ["gov:a", "gov:b"] },
  subject: { id: "body:x", name: "Flood Control District Board", kind: "body", hosts: [], government: null },
  candidates: [{ id: "gov:a", name: "County A", kind: "government", hosts: ["a.gov"], government: null }, { id: "gov:b", name: "City B", kind: "government", hosts: ["b.gov"], government: null }], pages });
const PAGE = { url: "https://a.gov/boards", text: "County A boards\nThe Flood Control District Board is a department of County A.\nContact the clerk." };

test("the placement agent moves a body only on a line it quotes from the government's own page", async () => {
  const sent: string[] = [];
  const good = await decidePlacement(found([PAGE]), async request => { sent.push(request.model); return answer({ action: "MOVE", target: "gov:a", url: PAGE.url, quote: "The Flood Control District Board is a department of County A.", sure: true }); });
  assert.deepEqual(good, { action: "MOVE", subject: "body:x", target: "gov:a", url: PAGE.url, quote: "The Flood Control District Board is a department of County A." });
  assert.deepEqual(sent, [MODELS.sonnet.model], "the mid-level model settles it when it can");
  const invented: string[] = [];
  const tie = await decidePlacement(found([PAGE]), async request => { invented.push(request.model); return answer({ action: "MOVE", target: "gov:a", url: PAGE.url, quote: "The Flood Control District Board is run by County A.", sure: true }, request.model); });
  assert.deepEqual(invented, [MODELS.sonnet.model, MODELS.opus.model], "a quote that is not on the page is asked again on the strongest model");
  assert.equal(tie.action, "TIE");
  const unsure = await decidePlacement(found([PAGE]), async request => answer({ action: "UNSURE", url: PAGE.url, quote: "x", sure: false }, request.model));
  assert.equal(unsure.action, "TIE");
  const elsewhere = await decidePlacement(found([PAGE]), async request => answer({ action: "MOVE", target: "gov:c", url: PAGE.url, quote: "The Flood Control District Board is a department of County A.", sure: true }, request.model));
  assert.equal(elsewhere.action, "TIE", "a government that was not offered is never chosen");
});

test("a due question is claimed once, settled with its quoted page kept, and a tie goes to a detective", async () => {
  const db = await seeded();
  try {
    const ask = async (subject: string, kind: "owner" | "body", candidates: string[]) => db.query(`INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at) VALUES ($1,$2,'DECIDE','PLACEMENT_QUESTION',$3,now() - interval '1 minute')`,
      [subject, `placement:${kind}`, JSON.stringify({ candidates })]);
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('wa:special:port','government','Port Of Tacoma','WA',NULL),('b:port','body','Port Commission','WA',NULL),('b:odd','body','Odd Board','WA',NULL)");
    await ask("b:port", "owner", ["wa:special:port", CITY]);
    await ask("b:odd", "owner", [CITY, "wa:special:port"]);
    assert.equal((await claimPlacementQuestions(db, 5)).length, 2);
    assert.equal((await claimPlacementQuestions(db, 5)).length, 0, "claimed questions wait for their turn to finish");
    await db.query("UPDATE blank SET next_try_at=now() - interval '1 minute'");
    const quote = "Port Commission is the governing body of the Port Of Tacoma.", page = { url: "https://portoftacoma.com/about", text: `About\n${quote}\n` };
    const log: string[] = [];
    const turned = await placementTurn({ query: db.query, claim: n => claimPlacementQuestions(db, n), settle: (decision, question) => settlePlacement(db, decision, question),
      transportFor: () => async request => request.messages[0]!.content && String(request.messages[0]!.content).includes("Odd Board") ? answer({ action: "UNSURE", url: page.url, quote: "x", sure: false }, request.model)
        : answer({ action: "MOVE", target: "wa:special:port", url: page.url, quote, sure: true }, request.model),
      pagesFor: async () => [page], log: line => log.push(line) });
    assert.equal(turned, 2);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id='b:port'"), [{ parent_id: "wa:special:port" }]);
    const [cite] = await db.query("SELECT entity_id, value FROM entity_external_id WHERE scheme='placement-source'");
    assert.equal(cite!.entity_id, "b:port");
    assert.deepEqual(JSON.parse(String(cite!.value)), { subject: "b:port", action: "MOVE", target: "wa:special:port", url: page.url, quote });
    assert.deepEqual(await db.query("SELECT entity_id, field, reason FROM blank WHERE field LIKE 'placement:%' OR field='identity:placement' ORDER BY entity_id"), [{ entity_id: "b:odd", field: "identity:placement", reason: "IDENTITY_TIE" }]);
    assert.equal(log.length, 2);
    await db.query("DELETE FROM blank WHERE field='identity:placement'");
    assert.equal((await ensurePlacement(db, "WA")), true, "the first pass over a state does its work");
    assert.equal((await ensurePlacement(db, "WA")), false, "an unchanged state is not read again");
  } finally { await db.pg.close(); }
});
