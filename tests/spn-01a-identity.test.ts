import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { ensureGoverningBody } from "../lib/core/door.ts";
import { openStatesPerson } from "../lib/core/ids.ts";
import { statePeopleScopeForId } from "../lib/officials/people-identity.ts";
import { stateVoteStateForMember } from "../lib/state-rollcalls/reader-vote-visibility.ts";
import { sourcePersonIds } from "../lib/sources/legiscan/dataset.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { bodyNamed, canonicalSubject, ensureFactEntities, officeNamed, resolvePerson } from "../lib/facts/entities.ts";
import { readCampaignMoneyInputs } from "../lib/funding/state-source-probe.ts";
import { factDb } from "./helpers/fact-db.ts";

const UUID = "d3f48e28-4ee5-4027-9670-0d617ca6048e";
const BODY = "tn:city:example#governing";
const STATE = "ocd-division/country:us/state:tn";
const CANDIDACY = "tn-sos-2026-general-tennessee-senate-district-31-brent-taylor";

async function seeded() {
  const db = await factDb();
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ('ocd-division/country:us/state:tn','place','Tennessee','TN',NULL),
    ('ocd-division/country:us/state:tn/place:example','place','Example','TN','ocd-division/country:us/state:tn'),
    ('tn:city:example','government','Example','TN','ocd-division/country:us/state:tn/place:example'),
    ('${BODY}','body','Example governing board','TN','tn:city:example')`);
  return db;
}

const blanks = async (db: Awaited<ReturnType<typeof seeded>>) => (await db.query("SELECT entity_id, field, reason, detail FROM blank ORDER BY entity_id, field"))
  .map(row => ({ entity_id: String(row.entity_id), field: String(row.field), reason: String(row.reason), detail: JSON.parse(String(row.detail)) as { candidates: string[] } }));

test("a new person gets one id built from the strongest key, and every later sight of that key finds the same person", async () => {
  const db = await seeded();
  try {
    const first = await resolvePerson(db, { name: "Brent Taylor", state: "TN", externalIds: [["openstates", `ocd-person/${UUID}`], ["roster-name:" + BODY, "brent taylor"]] });
    assert.equal(first, `person:tn:${UUID}`);
    assert.equal(await resolvePerson(db, { name: "Brent A. Taylor", state: "TN", externalIds: [["openstates", `ocd-person/${UUID}`]] }), first);
    assert.equal(await resolvePerson(db, { name: "Taylor, Brent", state: "TN", externalIds: [["fec", "S6TN00001"], ["openstates", `ocd-person/${UUID}`]] }), first);
    assert.equal(await resolvePerson(db, { name: "Brent Taylor", state: "TN", externalIds: [["fec", "S6TN00001"]] }), first, "a key learned on an earlier sight finds the person");
    assert.deepEqual(await blanks(db), []);
  } finally { await db.pg.close(); }
});

test("the same name in the same seat is the same person; a name alone is added separately and asked about", async () => {
  const db = await seeded();
  try {
    const seat = ["roster-name:" + BODY, "ada sample"] as const;
    const first = await resolvePerson(db, { name: "Ada Sample", state: "TN", externalIds: [seat] }) as string;
    assert.match(first, /^person:tn:ada-sample-[0-9a-f]{8}$/);
    assert.equal(await resolvePerson(db, { name: "Ada Sample", state: "TN", externalIds: [seat] }), first, "a refresh finds her in her seat");
    const namesake = await resolvePerson(db, { name: "Ada Sample", state: "TN", externalIds: [["legistar:pima", "77"]] }) as string;
    assert.notEqual(namesake, first, "nobody is picked on a name");
    const [question] = await blanks(db);
    assert.deepEqual([question!.entity_id, question!.reason, question!.detail.candidates], [namesake, "IDENTITY_NAME_ONLY", [first, namesake].sort()]);
    assert.equal(await resolvePerson(db, { name: "Ada Sample", state: "TN", externalIds: [["legistar:pima", "77"]] }), namesake, "and asking again changes nothing");
    assert.equal((await db.query("SELECT 1 FROM entity WHERE kind='person'")).length, 2);
  } finally { await db.pg.close(); }
});

test("a different Open States id, bioguide id or state is never a namesake", async () => {
  const db = await seeded();
  try {
    const a = await resolvePerson(db, { name: "Jennifer Clark", state: "TN", externalIds: [["openstates", `ocd-person/${UUID}`]] });
    const b = await resolvePerson(db, { name: "Jennifer Clark", state: "TN", externalIds: [["openstates", "ocd-person/5a30542d-49dc-4944-81db-dd1a2f855be6"]] });
    const c = await resolvePerson(db, { name: "Jennifer Clark", state: "KY", externalIds: [["legistar:pima", "5"]] });
    assert.equal(new Set([a, b, c]).size, 3);
    assert.deepEqual(await blanks(db), []);
  } finally { await db.pg.close(); }
});

test("when two held people fit one sighting equally, nobody is picked and nothing is added", async () => {
  const db = await seeded();
  try {
    const first = await resolvePerson(db, { name: "Ana Ruiz", state: "TN", externalIds: [["legistar:pima", "1"]] }) as string;
    const second = await resolvePerson(db, { name: "Ana Ruiz", state: "TN", externalIds: [["legistar:tucson", "2"]] }) as string;
    await db.query("DELETE FROM blank");
    const found = await resolvePerson(db, { name: "Ana Ruiz", state: "TN", externalIds: [["legistar:pima", "1"], ["legistar:tucson", "2"]] });
    assert.deepEqual(found, { tie: [first, second].sort() });
    const [question] = await blanks(db);
    assert.deepEqual([question!.reason, question!.detail.candidates], ["IDENTITY_TIE", [first, second].sort()]);
    assert.equal((await db.query("SELECT 1 FROM entity WHERE kind='person'")).length, 2);
  } finally { await db.pg.close(); }
});

test("an id that was merged into another still reaches it, for readers and for loaders", async () => {
  const db = await seeded();
  try {
    const survivor = await resolvePerson(db, { name: "Brent Taylor", state: "TN", externalIds: [["openstates", `ocd-person/${UUID}`]] }) as string;
    assert.equal(await resolveId(`ocd-person/${UUID}`, db.query), survivor, "the Open States id reaches the person");
    await ensureFactEntities(db, join(import.meta.dirname, ".."), ["tn"]);
    assert.deepEqual((await db.query("SELECT id FROM entity WHERE kind='person' AND name='Brent Taylor'")).map(row => row.id), [survivor], "the state's legislator list adds nobody a second time");
    assert.deepEqual(await db.query("SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1", [`ocd-person/${UUID}`]), [{ entity_id: survivor }], "and its id is saved as an alias of the person");
  } finally { await db.pg.close(); }
});

test("two held boards that both claim to be the governing board: writes go on to the first by id, and a detective is asked", async () => {
  const db = await seeded();
  try {
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('ocd-division/country:us/state:tn/place:example#governing','body','Example governing board','TN','tn:city:example')`);
    assert.equal((await ensureGoverningBody(db.query, "tn:city:example"))?.id, "ocd-division/country:us/state:tn/place:example#governing");
    const [question] = await blanks(db);
    assert.deepEqual([question!.entity_id, question!.reason, question!.detail.candidates],
      ["tn:city:example", "IDENTITY_TIE", [BODY, "ocd-division/country:us/state:tn/place:example#governing"].sort()]);
  } finally { await db.pg.close(); }
});

test("one governing board is found; a board named twice goes on to the first by id and is asked about", async () => {
  const db = await seeded();
  try {
    assert.equal((await ensureGoverningBody(db.query, "tn:city:example"))?.id, BODY);
    assert.deepEqual(await blanks(db), []);
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ('tn:city:example#body:planning','body','Planning Commission','TN','tn:city:example'),
      ('tn:city:example#body:planning-2','body','Planning Commission','TN','tn:city:example'),
      ('tn:city:example#office-recorder','body','Recorder office','TN','tn:city:example'),
      ('tn:city:example#office-recorder-2','body','Recorder office','TN','tn:city:example')`);
    const governing = await ensureGoverningBody(db.query, "tn:city:example");
    assert.equal((await bodyNamed(db.query, "tn:city:example", governing, "Planning Commission"))?.id, "tn:city:example#body:planning");
    assert.equal((await officeNamed(db.query, "tn:city:example", governing, "recorder", "Recorder"))?.id, "tn:city:example#office-recorder");
    assert.deepEqual((await blanks(db)).map(row => row.field), ["identity:body:planning commission", "identity:body:recorder"]);
    assert.equal(await canonicalSubject(db.query, BODY), BODY);
  } finally { await db.pg.close(); }
});

test("a person minted as person:<state>:<open states id> is accepted wherever plural: and ocd-person/ ids are", async () => {
  const minted = `person:tn:${UUID}`;
  assert.deepEqual(openStatesPerson(minted), { id: `ocd-person/${UUID}`, state: "TN" });
  assert.deepEqual(openStatesPerson(`plural:${UUID}`), { id: `ocd-person/${UUID}`, state: null });
  assert.equal(openStatesPerson("person:tn:legistar-pima-77"), null, "a person with no Open States id is not one");
  assert.equal(stateVoteStateForMember(minted), "TN");
  assert.equal(stateVoteStateForMember(`ocd-person/${UUID}`, "US-TN"), "TN");
  assert.equal(statePeopleScopeForId(minted), "US-TN");
  assert.equal(statePeopleScopeForId("person:tn:legistar-pima-77"), null, "a local person is not a state legislator");
  assert.deepEqual(sourcePersonIds({ id: minted }), [`ocd-person/${UUID}`]);
  const { GET } = await import("../app/api/directory/route.ts");
  const refused = await GET(new Request(`https://example.org/api/directory?member=${encodeURIComponent(minted)}`));
  assert.notEqual(refused.status, 400, "the directory route does not refuse the new shape as malformed");
});

test("campaign money files under the surviving person, and the merged id stays one of its aliases", async () => {
  const row = (id: string, aliases: string[]) => ({ id, name: "Brent Taylor", seat: "tn:state#senate-31", office: "State Senator", division: `${STATE}/sldu:31`,
    incumbent: true, source_url: "https://example.org/senate", aliases, dependency_hash: "a".repeat(64) });
  const calls: string[] = [];
  const query = async (text: string) => {
    calls.push(text);
    return text.includes("body-alias") ? [{ value: `ocd-person/${UUID}`, entity_id: `plural:${UUID}` }]
      : [row(`ocd-person/${UUID}`, [`ocd-person/${UUID}`]), row(`plural:${UUID}`, [`plural:${UUID}`, CANDIDACY])];
  };
  const { people } = await readCampaignMoneyInputs(query, "TN");
  assert.deepEqual(people.map(person => person.id), [`plural:${UUID}`], "the two records the registry still lists are one person");
  assert.deepEqual([...people[0]!.aliases!].sort(), [CANDIDACY, `ocd-person/${UUID}`].sort());
  assert.equal(calls.length, 2);
});
