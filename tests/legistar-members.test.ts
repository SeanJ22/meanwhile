import assert from "node:assert/strict";
import test from "node:test";
import { legistarMemberRosters,makeLegistarMembersReader } from "../lib/sources/legistar/members.ts";
import { legistarMembersPackage } from "../lib/sources/legistar/members-publication.ts";
import { publishLegistarFixture as publishLegistarMembers } from "./helpers/legistar-core.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { saveLegistarReading } from "../lib/sources/legistar/members-cache.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { NOW,rawFor,wiring,storeMemberFixtures } from "./helpers/legistar-member-fixtures.ts";
import { readFileSync } from "node:fs";
const fixture=(tenant:string,file:string)=>readFileSync(new URL(`./fixtures/legistar-members/${tenant}/${file}`,import.meta.url),"utf8");
const officePage=(reading:{artifact:{canonicalUrl:string}})=>{const url=new URL(reading.artifact.canonicalUrl);return url.pathname.endsWith("/officerecords");};
for (const [tenant, state, zone] of [["pima", "AZ", "America/Phoenix"], ["seattle", "WA", "America/Los_Angeles"], ["madison", "WI", "America/Chicago"]]) {
  test(`${state}: ${tenant}'s real office records retain exact people, bodies and term dates`, () => {
    const raw = rawFor(tenant), rows = wiring(raw, state, zone);
    assert.equal(JSON.parse(fixture(tenant, "bodies.meta.json")).state, state);
    const rosters = [...legistarMemberRosters(raw, rows, NOW)];
    assert.equal(rosters.length, raw.bodies.length);
    const members = rosters.flatMap(roster => roster.members);
    assert.ok(members.length > 0);
    for (const roster of rosters) for (const member of roster.members) {
      const office = raw.offices.find(office => member.id === `legistar:${tenant}:person:${office.OfficeRecordPersonId}:office:${office.OfficeRecordId}`)!;
      assert.equal(member.personId, `legistar:${tenant}:person:${office.OfficeRecordPersonId}`);
      assert.equal(roster.bodyId, rows.find(row => Number(row.config.eventBodyId) === office.OfficeRecordBodyId)!.bodyId);
      assert.equal(member.termStart, office.OfficeRecordStartDate?.slice(0, 10) ?? null);
      assert.equal(member.termEnd, office.OfficeRecordEndDate?.slice(0, 10) ?? null);
      assert.equal(member.name, office.OfficeRecordFullName.trim());
    }
  });
}

test("terms advance on the body's date without dropping open-ended or future memberships", () => {
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix");
  const office = raw.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const control = { ...raw, offices: [{ ...office, OfficeRecordStartDate: "2026-10-14T00:00:00", OfficeRecordEndDate: null }] };
  assert.equal([...legistarMemberRosters(control, rows, NOW)].flatMap(row => row.members).length, 0);
  assert.equal([...legistarMemberRosters(control, rows, "2026-10-14T12:00:00Z")].flatMap(row => row.members).length, 1);
  assert.throws(() => [...legistarMemberRosters({ ...control, offices: [{ ...office, OfficeRecordStartDate: "2026-02-30T00:00:00" }] }, rows, NOW)], /TERM_INVALID/);
});


test("a shared tenant binds only the exact governments named by its own doors", () => {
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix").slice(0, 2);
  rows[1] = { ...rows[1], ocdId: "ocd-division/country:us/state:az/place:other" };
  const prepared = legistarMembersPackage(raw, rows, NOW);
  assert.deepEqual(prepared.bound.map(row => row.bodyId), rows.map(row => row.bodyId));
  assert.equal(prepared.unbound.filter(gap => gap.key.includes(":body:")).length, raw.bodies.length - rows.length);
});

test("the indexed door read returns one tenant's manual and derived bindings without duplicates", async t => {
  const { legistarTenantDoors, LEGISTAR_TENANT_SQL } = await import("../lib/doors/legistar-tenant.ts");
  const { doorsFromWiringRow } = await import("../lib/doors/seed-meetings.ts");
  const db = await factDb(); t.after(() => db.pg.close());
  await db.pg.exec(`CREATE TABLE cp_doors (id text PRIMARY KEY, value jsonb NOT NULL); CREATE INDEX tenant_idx ON cp_doors ((${LEGISTAR_TENANT_SQL}));`);
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix");
  const manual = doorsFromWiringRow(rows[0])[0];
  const derived = { ...manual, doorId: "derived-insite", config: { slug: "derived-unused", insiteHost: "pima.legistar.com", insiteBodyName: raw.bodies[1].BodyName, sourceRoutes: "legistar-insite" },
    bodyIds: [rows[1].bodyId], meeting: { ...manual.meeting!, agendaSourceType: "LEGISTAR_INSITE", family: "US-AZ" } };
  for (const door of [manual, { ...manual, doorId: "other-tenant", config: { ...manual.config, slug: "seattle" } }, derived,
    { ...manual, doorId: "suspended", status: "SUSPENDED" }, { ...manual, doorId: "duplicate" }]) {
    await db.query("INSERT INTO cp_doors VALUES ($1, $2)", [door.doorId, JSON.stringify(door)]);
  }
  const own = await legistarTenantDoors(db.query, "pima");
  assert.deepEqual(new Set(own.map(row => row.bodyId)), new Set(rows.slice(0, 2).map(row => row.bodyId)));
  assert.ok(own.every(row => row.config.slug === "pima"));
  await db.pg.exec("SET enable_seqscan = off");
  assert.match(JSON.stringify(await db.query(`EXPLAIN SELECT value FROM cp_doors WHERE (${LEGISTAR_TENANT_SQL}) = $1`, ["pima"])), /tenant_idx/);
});

test("the office records supply every holder without fetching an unused person collection",async t=>{
  t.mock.timers.enable({apis:["Date"],now:Date.parse(NOW)});
  const {recordedMemberFetch}=await import("./helpers/legistar-member-fixtures.ts");
  const raw=rawFor("pima"),calls:URL[]=[];
  const read=await makeLegistarMembersReader(new MemoryEvidenceStore(),recordedMemberFetch(()=>raw,calls))("pima");
  assert.ok(!("unchanged"in read));
  assert.equal([...legistarMemberRosters(read,wiring(raw,"AZ","America/Phoenix"),NOW)].flatMap(row=>row.members).length,15);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>!url.pathname.endsWith("persons")));
});

test("two tenant bodies with one name are one body while a single one holds seats, and a named gap when both do", () => {
  const source = rawFor("pima"), seat = source.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const twin = (name: string, id: number) => ({ BodyId: id, BodyName: name, BodyRowVersion: `b${id}` });
  const bodies = [twin("Parks, Arts, & Commission", 901), twin("Parks, Arts, and Commission", 902)];
  const only = { ...source, bodies, offices: [{ ...seat, OfficeRecordBodyId: 902 }] };
  const rows = [{ ...wiring(source, "AZ", "America/Phoenix")[0], config: { slug: "pima", sourceRoutes: "legistar" } }];
  const one = legistarMembersPackage(only, rows, NOW);
  assert.equal(one.bound.length, 1);
  assert.equal(one.bound[0].config.eventBodyId, "902");
  assert.equal(one.unbound.length, 0);
  assert.equal(one.members, 1);
  const both = legistarMembersPackage({ ...only, offices: [{ ...seat, OfficeRecordBodyId: 901 }, { ...seat, OfficeRecordId: seat.OfficeRecordId + 1, OfficeRecordBodyId: 902 }] }, rows, NOW);
  assert.equal(both.bound.length, 0);
  assert.deepEqual(both.unbound.map(gap => gap.key).sort(), ["pima:body:901", "pima:body:902"]);
});

test("current seats on a body the tenant does not list are a named gap, never a silent empty roster", () => {
  const source = rawFor("pima"), seat = source.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const rows = wiring(source, "AZ", "America/Phoenix");
  const raw = { ...source, offices: [seat, { ...seat, OfficeRecordId: seat.OfficeRecordId + 1000, OfficeRecordBodyId: 987654 }] };
  const report = legistarMembersPackage(raw, rows, NOW);
  assert.deepEqual(report.unbound.map(gap => gap.key), ["pima:office-body:987654"]);
  assert.equal(report.members, 1);
});

test("a person with two current records on one body is one member, spoken for by the most recent record", async t => {
  const db = await factDb(); t.after(() => db.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix"), seat = source.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const earlier = { ...seat, OfficeRecordStartDate: "2019-01-01T00:00:00", OfficeRecordEndDate: "2099-01-01T00:00:00", OfficeRecordTitle: "District 2 - First Deputy" };
  const later = { ...seat, OfficeRecordId: seat.OfficeRecordId + 5000, OfficeRecordStartDate: "2026-06-23T00:00:00", OfficeRecordEndDate: "2099-07-31T00:00:00", OfficeRecordTitle: "District 2 - Second Deputy" };
  const vault = new MemoryEvidenceStore(), page = source.readings.find(officePage)!, offices = [earlier, later];
  await storeMemberFixtures(vault, source);
  const reading = await saveLegistarReading(vault, "pima", { url: page.artifact.canonicalUrl, text: JSON.stringify(offices), body: offices, retrievedAt: page.artifact.retrievedAt });
  const raw = { ...source, offices, readings: [...source.readings.filter(read => read !== page), reading] };
  const members = [...legistarMemberRosters(raw, rows, NOW)].flatMap(roster => roster.members);
  assert.deepEqual(members.map(member => [member.officeTitle, member.termStart]), [["District 2 - Second Deputy", "2026-06-23"]]);
  const report = await publishLegistarMembers({ facts: db, vault, raw, rows, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
  assert.equal(report.held, 0);
});

test("a seat with no title still lists its holder, and a record with no name is skipped rather than failing the tenant", async t => {
  const db = await factDb(); t.after(() => db.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix"), seat = source.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const untitled = { ...seat, OfficeRecordTitle: null, OfficeRecordMemberType: null };
  const nameless = { ...seat, OfficeRecordId: seat.OfficeRecordId + 7000, OfficeRecordPersonId: seat.OfficeRecordPersonId + 7000, OfficeRecordFullName: " " };
  const vault = new MemoryEvidenceStore(), page = source.readings.find(officePage)!, offices = [untitled, nameless];
  await storeMemberFixtures(vault, source);
  const reading = await saveLegistarReading(vault, "pima", { url: page.artifact.canonicalUrl, text: JSON.stringify(offices), body: offices, retrievedAt: page.artifact.retrievedAt });
  const raw = { ...source, offices, readings: [...source.readings.filter(read => read !== page), reading] };
  const report = await publishLegistarMembers({ facts: db, vault, raw, rows, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
  assert.equal(report.members, 1);
  const live = (await readFactRosters(db.query, rows.map(row => row.bodyId))).rosters.flatMap(roster => roster.members);
  assert.deepEqual(live.map(member => member.name), [seat.OfficeRecordFullName.trim()]);
});
