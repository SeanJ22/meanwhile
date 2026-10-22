import assert from "node:assert/strict";
import test from "node:test";
import { durableRoutineRunnerReceiptIssue, type DurableReceiptStore } from "../lib/civic-data/runner-receipt.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { legistarMemberRosters, makeLegistarMembersReader } from "../lib/sources/legistar/members.ts";
import { memberProbe } from "../lib/sources/legistar/members-model.ts";
import { legistarMembersPackage, publishLegistarMembers } from "../lib/sources/legistar/members-publication.ts";
import { legistarMemberTasks, legistarMemberClocks, legistarMemberReceiptIssue } from "../lib/sources/legistar/members-tasks.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { loadLegistarMembers, saveLegistarMembers, saveLegistarReading } from "../lib/sources/legistar/members-cache.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { NOW, rawFor, wiring, storeMemberFixtures } from "./helpers/legistar-member-fixtures.ts";
import { readFileSync } from "node:fs";

const fixture = (tenant: string, file: string) => readFileSync(new URL(`./fixtures/legistar-members/${tenant}/${file}`, import.meta.url), "utf8");

const officePage = (reading: { artifact: { canonicalUrl: string } }) => {
  const url = new URL(reading.artifact.canonicalUrl);
  return url.pathname.endsWith("/officerecords");
};

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


test("member probes exclude ended offices and historic people, and detect a low-id edit or deletion", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const { recordedMemberFetch } = await import("./helpers/legistar-member-fixtures.ts");
  let raw = rawFor("pima");
  const current = raw.offices[0];
  raw = { ...raw, offices: [...raw.offices, { ...current, OfficeRecordId: 999999, OfficeRecordEndDate: "2000-01-01T00:00:00", OfficeRecordPersonId: 999999 }],
    persons: [...raw.persons, { PersonId: 999999, PersonFullName: "Historic Member", PersonRowVersion: "old" }] };
  const calls: URL[] = [];
  const read = makeLegistarMembersReader(new MemoryEvidenceStore(), recordedMemberFetch(() => raw, calls));
  const first = await read("pima");
  assert.ok(!first.offices.some(row => row.OfficeRecordId === 999999));
  assert.ok(!first.persons.some(row => row.PersonId === 999999));
  assert.deepEqual(calls.slice(0, 3).map(url => url.pathname.split("/").at(-1)), ["bodies", "officerecords", "persons"]);
  assert.ok(calls.filter(url => url.pathname.endsWith("officerecords")).every(url => url.searchParams.get("$filter")!.includes("OfficeRecordEndDate ge")));
  assert.ok(calls.filter(url => url.pathname.endsWith("persons")).every(url => url.searchParams.get("$filter")!.includes("PersonId eq")));
  calls.length = 0;
  assert.equal((await read("pima")).signature, first.signature);
  assert.ok(calls.every(memberProbe));
  raw = { ...raw, offices: raw.offices.map((row, i) => i === 0 ? { ...row, OfficeRecordRowVersion: "changed" } : row) };
  assert.notEqual((await read("pima")).signature, first.signature);
  raw = { ...raw, offices: raw.offices.slice(1) };
  assert.ok(!(await read("pima")).offices.some(row => row.OfficeRecordId === current.OfficeRecordId));
});

test("a changed source never opens the prior full roster, and an unchanged probe opens it only afterward", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const { recordedMemberFetch } = await import("./helpers/legistar-member-fixtures.ts");
  const { legistarMemberSignature } = await import("../lib/sources/legistar/members-model.ts");
  const source = rawFor("pima"), vault = new MemoryEvidenceStore();
  const raw = await makeLegistarMembersReader(vault, recordedMemberFetch(() => source, []))("pima");
  await saveLegistarMembers(vault, raw, NOW);
  const cached = (await loadLegistarMembers(vault, "pima"))!;
  let loads = 0;
  const calls: URL[] = [];
  const prior = { ...cached, read: async () => {
    loads++;
    assert.ok(calls.length > 0 && calls.every(memberProbe));
    return cached.read();
  } };
  const current = await makeLegistarMembersReader(vault, recordedMemberFetch(() => raw, calls), prior)("pima");
  assert.equal(loads, 1);
  assert.equal(current.signature, legistarMemberSignature(raw));
  const changed = { ...raw, offices: raw.offices.map((office, i) => i ? office : { ...office, OfficeRecordRowVersion: "changed" }) };
  await makeLegistarMembersReader(vault, recordedMemberFetch(() => changed, []), { ...cached, read: async () => {
    throw new Error("Prior payload must stay unopened when the source changes");
  } })("pima");
});

test("tenant facts retain dates, leave an unchanged roster intact, and remove every departed member", async t => {
  const db = await factDb(); t.after(() => db.pg.close());
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix");
  const vault = new MemoryEvidenceStore(), clocks = factClocks(null);
  let copies = 0;
  const facts = { query: db.query, transaction: <T>(work: (query: import("../lib/facts/publish.ts").Query) => Promise<T>) => db.transaction(query => work(async (text, params) => {
    if (text.startsWith("INSERT INTO source_copy")) copies++;
    return query(text, params);
  })) };
  await storeMemberFixtures(vault, raw);
  const input = { facts, raw, rows, vault, clocks, now: NOW };
  const first = await publishLegistarMembers(input);
  assert.equal(first.members, 15);
  assert.equal(first.unchanged, false);
  assert.equal(copies, 1);
  assert.equal((await db.query("SELECT blob_key FROM source_copy"))[0]!.blob_key, `artifact:${raw.readings.find(officePage)!.artifact.id}`);
  const before = await db.query("SELECT id, checked_at FROM fact ORDER BY id");
  const live = await readFactRosters(db.query, rows.map(row => row.bodyId));
  const rex = live.rosters.flatMap(row => row.members).find(row => row.name === "Rex Scott")!;
  assert.equal(rex.termStart, "2021-01-01"); assert.equal(rex.termEnd, "2028-12-31");
  const later = "2026-10-14T08:00:00.000Z";
  const second = await publishLegistarMembers({ ...input, now: later, raw: { ...raw, collectedAt: later, signature: "transport-only-change" } });
  assert.equal(second.versionId, first.versionId);
  assert.equal(second.records, 0); assert.equal(second.unchanged, true);
  assert.deepEqual(await db.query("SELECT id, checked_at FROM fact ORDER BY id"), before);
  const clock = (await legistarMemberClocks(db.query, ["legistar-members:pima"])).get("legistar-members:pima")!;
  assert.equal(clock.lastSucceededObservedAt, later);
  const receipt = { source: "legistar-members:pima", candidateId: second.versionId, acquisitionSucceeded: true, state: "PROMOTED" as const,
    decision: "GOOD" as const, promotedVersion: second.versionId, lastKnownGoodVersion: second.versionId, confirmedAt: later,
    structuralReleaseContract: ZERO_RELEASE_EVENTS };
  assert.equal(await legistarMemberReceiptIssue(db.query, receipt, receipt.source), null);
  installFactReader(db.query); t.after(() => installFactReader(undefined));
  const national = { readCandidateSummary: () => { throw new Error("National candidate read"); },
    readPromotionIdentity: () => { throw new Error("National pointer read"); } } as unknown as DurableReceiptStore;
  assert.equal(await durableRoutineRunnerReceiptIssue(receipt, legistarMemberTasks(["pima"])[0], national, "SUCCESS"), null);
  const expired = { ...raw, offices: raw.offices.map(row => ({ ...row, OfficeRecordEndDate: "2026-10-12T00:00:00" })) };
  await publishLegistarMembers({ ...input, raw: expired, now: later });
  assert.equal((await readFactRosters(db.query, rows.map(row => row.bodyId))).rosters.length, 0);
  assert.match((await legistarMemberReceiptIssue(db.query, receipt, receipt.source))!, /differs/);
  assert.ok(legistarMemberTasks(["pima"])[0].command.includes("--legistar-client=pima"));
});

test("publication streams source pages across bodies without losing members from another page", async t => {
  const db = await factDb(); t.after(() => db.pg.close());
  const raw = rawFor("pima"), original = raw.readings.find(officePage)!;
  const vault = new MemoryEvidenceStore();
  await storeMemberFixtures(vault, raw);
  raw.readings = raw.readings.filter(read => read !== original);
  for (let start = 0; start < raw.offices.length; start += 2) {
    const url = new URL(original.artifact.canonicalUrl); url.searchParams.set("$skip", String(start));
    const body = raw.offices.slice(start, start + 2);
    raw.readings.push(await saveLegistarReading(vault, raw.slug, { url: url.href, text: JSON.stringify(body), body, retrievedAt: original.artifact.retrievedAt }));
  }
  const rows = wiring(raw, "AZ", "America/Phoenix");
  const report = await publishLegistarMembers({ facts: db, vault, raw, rows, clocks: factClocks(null), now: NOW });
  assert.equal(report.members, 15);
  const live = await readFactRosters(db.query, rows.map(row => row.bodyId));
  assert.equal(live.rosters.reduce((total, roster) => total + roster.members.length, 0), report.members);
});

test("latest-manifest reads never list vault history and still reject corrupt source bytes", async () => {
  const vault = new MemoryEvidenceStore(), raw = rawFor("pima");
  vault.list = async () => { throw new Error("History enumeration is forbidden"); };
  await storeMemberFixtures(vault, raw);
  await saveLegistarMembers(vault, raw, NOW);
  const held = await (await loadLegistarMembers(vault, "pima"))!.read();
  assert.deepEqual(held.offices, raw.offices);
  const changed = { ...raw, collectedAt: "2026-10-14T08:00:00.000Z", offices: raw.offices.map((office, i) => i ? office : { ...office, OfficeRecordRowVersion: "changed" }) };
  changed.readings = await Promise.all(raw.readings.map(reading => officePage(reading)
    ? saveLegistarReading(vault, raw.slug, { url: reading.artifact.canonicalUrl, text: JSON.stringify(changed.offices), body: changed.offices, retrievedAt: changed.collectedAt })
    : reading));
  await saveLegistarMembers(vault, changed, changed.collectedAt);
  assert.deepEqual((await (await loadLegistarMembers(vault, "pima"))!.read()).offices, changed.offices);
  const get = vault.get.bind(vault);
  vault.get = async key => {
    const held = await get(key);
    return held && key.endsWith(".json") && !key.endsWith("manifest.json") && !key.endsWith("latest.json") ? { ...held, bytes: Buffer.from("[]") } : held;
  };
  await assert.rejects(async () => (await loadLegistarMembers(vault, "pima"))!.read(), /HASH_INVALID|hash/);
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

test("a tenant with many seated people is read in filters Legistar accepts and still returns every person", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const { recordedMemberFetch } = await import("./helpers/legistar-member-fixtures.ts");
  const source = rawFor("pima"), template = source.offices[0], base = 5000;
  const offices = Array.from({ length: 47 }, (_, i) => ({ ...template, OfficeRecordId: base + i, OfficeRecordPersonId: base + i, OfficeRecordEndDate: null }));
  const raw = { ...source, offices, persons: offices.map((office, i) => ({ PersonId: office.OfficeRecordPersonId, PersonFullName: `Member ${i}`, PersonRowVersion: `v${i}` })) };
  const calls: URL[] = [];
  const read = await makeLegistarMembersReader(new MemoryEvidenceStore(), recordedMemberFetch(() => raw, calls))("pima");
  assert.equal(read.persons.length, 47);
  const personCalls = calls.filter(url => url.pathname.endsWith("persons"));
  assert.ok(personCalls.length >= 4);
  for (const url of personCalls) assert.ok([...url.searchParams.get("$filter")!.matchAll(/PersonId eq/g)].length <= 15, "Legistar rejects more than 100 filter nodes");
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
  const reading = await saveLegistarReading(vault, "pima", { url: page.artifact.canonicalUrl, text: JSON.stringify(offices), body: offices, retrievedAt: page.artifact.retrievedAt });
  const raw = { ...source, offices, readings: [...source.readings.filter(read => read !== page), reading] };
  const report = await publishLegistarMembers({ facts: db, vault, raw, rows, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
  assert.equal(report.members, 1);
  const live = (await readFactRosters(db.query, rows.map(row => row.bodyId))).rosters.flatMap(roster => roster.members);
  assert.deepEqual(live.map(member => member.name), [seat.OfficeRecordFullName.trim()]);
});
