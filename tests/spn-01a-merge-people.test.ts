import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { decide } from "../lib/core/door.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";

const MIGRATION = readFileSync(join(import.meta.dirname, "..", "lib", "db", "migrations", "SPN-01A_people_merged.sql"), "utf8").replaceAll("--> statement-breakpoint", "");
const UUID = "d3f48e28-4ee5-4027-9670-0d617ca6048e";
const STATE = "ocd-division/country:us/state:tn";
const DISTRICT = `${STATE}/sldu:31`;
const CANDIDACY = "tn-sos-2026-general-tennessee-senate-district-31-brent-taylor";
const OTHER_CANDIDACY = "tn-sos-2026-general-united-states-house-of-representatives-district-9-brent-taylor";

async function seeded() {
  const db = await factDb();
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ('ocd-division/country:us','place','United States',NULL,NULL),($1,'place','Tennessee','TN',NULL),($2,'place','Senate 31','TN',$1),
    ('tn:city:example#governing','body','Example council','TN',NULL),
    ('ocd-person/${UUID}','person','Brent Taylor','TN',NULL),('plural:${UUID}','person','Brent Taylor','TN',NULL),
    ('${CANDIDACY}','person','Brent Taylor','TN',NULL),('${OTHER_CANDIDACY}','person','Brent Taylor','TN',NULL),
    ('plural:11111111-2222-3333-4444-555555555555','person','Ada Sample','TN',NULL),
    ('ocd-person/5a30542d-49dc-4944-81db-dd1a2f855be6','person','Jennifer Clark','TN',NULL),
    ('ocd-person/16d7d555-b2e9-4b9a-9ab8-847d460ba203','person','Jennifer Clark','TN',NULL),
    ('ocd-person/99999999-2222-3333-4444-555555555555','person','Ada Sample','TN',NULL),('tn-sos-ada','person','Ada Sample','TN',NULL)`, [STATE, DISTRICT]);
  await db.query(`INSERT INTO entity_external_id(entity_id,scheme,value) VALUES
    ('ocd-person/${UUID}','openstates','ocd-person/${UUID}'),
    ('plural:${UUID}','campaign-person:TN','plural:tn:${UUID}'),('plural:${UUID}','campaign-person:TN','${UUID}'),
    ('plural:${UUID}','campaign-person:TN','${CANDIDACY}'),('plural:${UUID}','roster-name:tn:city:example#governing','brent taylor'),
    ('ocd-person/16d7d555-b2e9-4b9a-9ab8-847d460ba203','campaign-person:TN','ocd-person/5a30542d-49dc-4944-81db-dd1a2f855be6')`);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://a','https://a','2026-01-01',repeat('a',64),'a'),(2,'https://b','https://b','2026-06-01',repeat('b',64),'b')");
  const fact = (entity: string, field: string, value: string, status: string, kind: string, copy: number | null) =>
    db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
      VALUES($1,$2,to_jsonb($3::text),$3,$4,$5,$6,$3,now(),CASE WHEN $4='live' THEN now() END,'test')`, [entity, field, value, status, kind, copy]);
  await fact(`ocd-person/${UUID}`, "name", "Brent Taylor", "live", "REFERENCE", 1);
  await fact(`ocd-person/${UUID}`, "phone", "old", "superseded", "OFFICIAL", 1);
  await fact(`plural:${UUID}`, "name", "Brent A. Taylor", "live", "OFFICIAL", 1);
  await fact(`plural:${UUID}`, "email", "bt@example.org", "live", "OFFICIAL", 1);
  await fact(`plural:${UUID}`, "website", "https://old.example", "live", "CAMPAIGN", 1);
  await fact(CANDIDACY, "website", "https://new.example", "live", "CAMPAIGN", 2);
  await fact(CANDIDACY, "campaign-money:a", "x", "live", "OFFICIAL", 2);
  await fact("tn:city:example#governing", `member:ocd-person/${UUID}`, "seat", "live", "OFFICIAL", 1);
  await fact("tn:city:example#governing", `member:plural:${UUID}`, "seat again", "live", "OFFICIAL", 2);
  await fact("tn:city:example#governing", `member:${OTHER_CANDIDACY}`, "somebody else", "live", "OFFICIAL", 2);
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('campaign-committee:TN:abc','committee','Taylor for Senate','TN','${CANDIDACY}')`);
  await db.query(`INSERT INTO entity_place(entity_id,place_id) VALUES ('ocd-person/${UUID}',$1),('plural:${UUID}',$1),('plural:${UUID}',$2),('${CANDIDACY}',$2)`, [STATE, DISTRICT]);
  await db.query(`INSERT INTO entity_host(entity_id,host) VALUES ('plural:${UUID}','taylor.example'),('${CANDIDACY}','taylor.example')`);
  await db.query(`INSERT INTO blank(entity_id,field,stage,reason) VALUES ('${CANDIDACY}','phone','ACQUIRE','NOT_FOUND'),('plural:${UUID}','phone','ACQUIRE','NOT_FOUND')`);
  await db.query(`INSERT INTO place_page(place_id,body) VALUES ($1,'{}')`, [DISTRICT]);
  await db.query(`INSERT INTO place_page_dependency(page_id,entity_id) VALUES ($1,'${CANDIDACY}'),($1,'plural:${UUID}')`, [DISTRICT]);
  return db;
}

const ids = async (db: Awaited<ReturnType<typeof seeded>>) => (await db.query("SELECT id FROM entity WHERE kind='person' ORDER BY id")).map(row => String(row.id));

test("the same Open States id in any spelling, and a listed candidacy key, become one person", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(MIGRATION);
    const people = await ids(db);
    assert.deepEqual(people.filter(id => id.includes(UUID) || id === CANDIDACY), [`plural:${UUID}`], "the record holding the most facts, children and keys survives");
    assert.ok(people.includes(OTHER_CANDIDACY), "a namesake with no key in common stays a separate person");
    assert.ok(["plural:11111111-2222-3333-4444-555555555555", "ocd-person/99999999-2222-3333-4444-555555555555", "tn-sos-ada"].every(id => people.includes(id)), "the same name alone merges nothing");
    for (const old of [`ocd-person/${UUID}`, CANDIDACY]) {
      assert.equal(await resolveId(old, db.query), `plural:${UUID}`, `${old} still reaches the person`);
    }
    assert.equal(await resolveId(`plural:${UUID}`, db.query), `plural:${UUID}`);
    for (const old of [`ocd-person/${UUID}`, CANDIDACY, `plural:tn:${UUID}`, UUID]) {
      assert.deepEqual(await db.query("SELECT reader_resolve_id($1) AS id", [old]), [{ id: `plural:${UUID}` }], `the reader lookup resolves ${old}`);
    }
  } finally { await db.pg.close(); }
});

test("facts, history, places, hosts, keys, children and dependencies move to the survivor", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(MIGRATION);
    const survivor = `plural:${UUID}`;
    const live = new Map((await db.query("SELECT field, value_text FROM fact WHERE entity_id=$1 AND status='live'", [survivor])).map(row => [String(row.field), String(row.value_text)]));
    assert.deepEqual([...live.keys()].sort(), ["campaign-money:a", "email", "name", "website"]);
    assert.equal(live.get("name"), "Brent A. Taylor", "an official source beats a reference one");
    assert.equal(live.get("website"), "https://new.example", "equal provenance: the newer source copy wins");
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND field='phone' AND status='superseded'", [survivor])).length, 1, "history moves with its dates");
    assert.equal((await db.query("SELECT 1 FROM fact WHERE entity_id=$1 AND status='superseded' AND field IN ('name','website')", [survivor])).length, 2, "the fact that lost is kept as history");
    assert.deepEqual((await db.query("SELECT field FROM fact WHERE entity_id='tn:city:example#governing' AND status='live' ORDER BY field")).map(row => row.field),
      [`member:${survivor}`, `member:${OTHER_CANDIDACY}`], "the body lists the person once, under the survivor");
    assert.deepEqual((await db.query("SELECT parent_id FROM entity WHERE id='campaign-committee:TN:abc'")), [{ parent_id: survivor }]);
    assert.deepEqual((await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1 ORDER BY place_id", [survivor])).map(row => row.place_id), [STATE, DISTRICT]);
    assert.deepEqual(await db.query("SELECT host FROM entity_host WHERE entity_id=$1", [survivor]), [{ host: "taylor.example" }]);
    assert.deepEqual(await db.query("SELECT field FROM blank WHERE entity_id=$1 AND field NOT LIKE 'identity:%'", [survivor]), [{ field: "phone" }], "one open blank, not two");
    assert.deepEqual((await db.query("SELECT entity_id FROM place_page_dependency")).map(row => row.entity_id), [survivor]);
    assert.ok((await db.query("SELECT 1 FROM rebuild_queue WHERE place_id=$1", [DISTRICT])).length, "the page that showed the duplicate is queued to rebuild");
    assert.deepEqual((await db.query("SELECT scheme, value FROM entity_external_id WHERE entity_id=$1 AND scheme='body-alias' ORDER BY value", [survivor])),
      [{ scheme: "body-alias", value: `ocd-person/${UUID}` }, { scheme: "body-alias", value: CANDIDACY }]);
    assert.ok((await db.query("SELECT 1 FROM entity_external_id WHERE entity_id=$1 AND scheme='openstates'", [survivor])).length, "its keys come with it");
  } finally { await db.pg.close(); }
});

test("two records tied together that hold different Open States ids stay two and go to a detective", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(MIGRATION);
    const clark = ["ocd-person/16d7d555-b2e9-4b9a-9ab8-847d460ba203", "ocd-person/5a30542d-49dc-4944-81db-dd1a2f855be6"].sort();
    assert.equal((await ids(db)).filter(id => clark.includes(id)).length, 2);
    const [blank] = await db.query("SELECT entity_id, reason, detail FROM blank WHERE field='identity:key-conflict'");
    assert.equal(blank!.entity_id, clark[0]);
    assert.equal(blank!.reason, "IDENTITY_TIE");
    assert.deepEqual(JSON.parse(String(blank!.detail)), { candidates: clark, why: "KEY_CONFLICT" });
    const names = await db.query("SELECT entity_id, reason, detail FROM blank WHERE field='identity:name-only' ORDER BY entity_id");
    assert.deepEqual(names.map(row => [row.entity_id, row.reason, JSON.parse(String(row.detail)).candidates]), [
      ["ocd-person/99999999-2222-3333-4444-555555555555", "IDENTITY_NAME_ONLY", ["ocd-person/99999999-2222-3333-4444-555555555555", "plural:11111111-2222-3333-4444-555555555555", "tn-sos-ada"]],
      [`plural:${UUID}`, "IDENTITY_NAME_ONLY", [`plural:${UUID}`, OTHER_CANDIDACY]],
    ], "namesakes with no key in common wait for a detective; two different Open States ids are known to be two people");
  } finally { await db.pg.close(); }
});

test("a government's two records of its own governing board become one, and a board that is provably another body stays and is asked about", async () => {
  const db = await factDb();
  try {
    const CITY = "tn:city:city-of-cocoa", LOSER = "tn:city:city-of-cocoa#governing", SURVIVOR = "ocd-division/country:us/state:tn/place:cocoa#governing";
    const COUNTY = "tn:county:county-of-pima", PIMA = "tn:county:county-of-pima#governing", RTA = "ocd-division/country:us/state:tn/county:pima#governing";
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ('${STATE}','place','Tennessee','TN',NULL),('${CITY}','government','City Of Cocoa','TN','${STATE}'),('${COUNTY}','government','County Of Pima','TN','${STATE}'),
      ('${LOSER}','body','City Of Cocoa governing board','TN','${CITY}'),('${SURVIVOR}','body','City Council','TN','${CITY}'),
      ('${PIMA}','body','County Of Pima governing board','TN','${COUNTY}'),('${RTA}','body','Pima County Regional Transportation Authority governing board','TN','${COUNTY}'),
      ('meeting:tn:a','meeting','Council meeting','TN','${SURVIVOR}')`);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://a','https://a','2026-01-01',repeat('a',64),'a'),(2,'https://b','https://b','2026-06-01',repeat('b',64),'b')");
    const fact = (entity: string, field: string, value: string, copy: number) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
      VALUES($1,$2,to_jsonb($3::text),$3,'live','OFFICIAL',$4,$3,now(),now(),'test')`, [entity, field, value, copy]);
    await fact(LOSER, "homepage", "https://old.example", 1);
    await fact(LOSER, "mailing_address", "1 Main St", 1);
    await fact(SURVIVOR, "homepage", "https://new.example", 2);
    await fact(SURVIVOR, "office_phone", "555", 2);
    await fact(RTA, "homepage", "https://rta.example", 2);
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES ($1,'cocoa.example'),($2,'cocoa.example')", [LOSER, SURVIVOR]);
    await db.query("INSERT INTO place_page(place_id,body) VALUES ($1,'{}')", [LOSER]);
    await db.query("INSERT INTO rebuild_queue(place_id) VALUES ($1)", [LOSER]);
    await db.pg.exec(MIGRATION);
    const bodies = (await db.query("SELECT id FROM entity WHERE kind='body' ORDER BY id")).map(row => String(row.id));
    assert.deepEqual(bodies, [SURVIVOR, PIMA, RTA].sort(), "Cocoa's two records are one; Pima's other record is another body and stays");
    assert.equal(await resolveId(LOSER, db.query), SURVIVOR);
    assert.deepEqual((await db.query("SELECT field, value_text FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field", [SURVIVOR])).map(row => [row.field, row.value_text]),
      [["homepage", "https://new.example"], ["mailing_address", "1 Main St"], ["office_phone", "555"]], "the newer homepage wins; the rest of both records' facts is kept");
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id='meeting:tn:a'"), [{ parent_id: SURVIVOR }]);
    assert.deepEqual(await db.query("SELECT host FROM entity_host WHERE entity_id=$1", [SURVIVOR]), [{ host: "cocoa.example" }]);
    assert.deepEqual(await db.query("SELECT 1 FROM place_page WHERE place_id=$1", [LOSER]), [], "the removed board's page goes with it");
    assert.deepEqual((await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id")).map(row => row.place_id), [SURVIVOR], "and the surviving board's page is queued, behind the existing backlog");
    assert.deepEqual((await db.query("SELECT 1 FROM rebuild_queue WHERE next_queued_at IS NOT NULL")), [], "no queued page jumps the line");
    const [tie] = await db.query("SELECT entity_id, reason, detail FROM blank WHERE field='identity:governing-body'");
    assert.deepEqual([tie!.entity_id, tie!.reason, JSON.parse(String(tie!.detail)).candidates], [COUNTY, "IDENTITY_TIE", [PIMA, RTA].sort()]);
  } finally { await db.pg.close(); }
});

test("running the merge again changes nothing", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(MIGRATION);
    const once = JSON.stringify([await ids(db), await db.query("SELECT entity_id, field, status FROM fact ORDER BY id"), await db.query("SELECT * FROM entity_external_id ORDER BY scheme, value")]);
    await db.pg.exec(MIGRATION);
    assert.equal(JSON.stringify([await ids(db), await db.query("SELECT entity_id, field, status FROM fact ORDER BY id"), await db.query("SELECT * FROM entity_external_id ORDER BY scheme, value")]), once);
  } finally { await db.pg.close(); }
});

test("a state load cannot bring a merged person back", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(MIGRATION);
    const ROOT = join(import.meta.dirname, "..");
    await ensureFactEntities(db, ROOT, ["tn"]);
    assert.deepEqual((await ids(db)).filter(id => id.includes(UUID)), [`plural:${UUID}`]);
  } finally { await db.pg.close(); }
});

test("the migration's winner among two live facts is the one the Slide's rule picks", async () => {
  const db = await factDb();
  try {
    const kinds = ["OWNER", "OFFICIAL", "FILING", "REFERENCE", "NEWS", "CAMPAIGN", "OTHER"] as const;
    const times = ["2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"] as const;
    const combos = kinds.flatMap(kind => times.map(at => ({ kind, at })));
    const cases = combos.flatMap(current => combos.filter(incoming => !(current.kind === "OWNER" && incoming.kind === "OWNER") && !(current.kind === incoming.kind && current.at === incoming.at))
      .map(incoming => ({ current, incoming })));
    for (const [n, { current, incoming }] of cases.entries()) {
      const uuid = `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES ($1,'person','Ada Sample','TN'),($2,'person','Ada Sample','TN')", [`ocd-person/${uuid}`, `plural:${uuid}`]);
      for (const [entity, side, value] of [[`ocd-person/${uuid}`, current, "current"], [`plural:${uuid}`, incoming, "incoming"]] as const) {
        const [copy] = side.kind === "OWNER" ? [null] : await db.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES ($1,$1,$2,repeat('c',64),$1) RETURNING id", [`https://x/${n}/${value}`, side.at]);
        await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
          VALUES($1,'f',to_jsonb($2::text),$2,'live',$3,$4,$2,$5,now(),'test')`, [entity, value, side.kind, copy?.id ?? null, side.at]);
      }
    }
    await db.pg.exec(MIGRATION);
    const winners = new Map((await db.query("SELECT value_text, count(*)::int AS n FROM fact WHERE status='live' GROUP BY value_text")).map(row => [String(row.value_text), Number(row.n)]));
    const expected = { current: 0, incoming: 0 };
    for (const { current, incoming } of cases) {
      const side = (s: typeof current) => ({ value: s.kind, provenance: s.kind, fetchedAt: new Date(s.at) });
      expected[decide(side(current), { ...side(incoming), value: "other" }) === "PUBLISH" ? "incoming" : "current"]++;
    }
    assert.deepEqual({ current: winners.get("current") ?? 0, incoming: winners.get("incoming") ?? 0 }, expected);
    assert.equal((await db.query("SELECT 1 FROM fact WHERE field='f' AND status='live'")).length, cases.length, "one live fact per person");
  } finally { await db.pg.close(); }
});
