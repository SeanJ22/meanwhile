import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { doorsFromWiringRow } from "../lib/doors/seed-meetings.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { memberProbe } from "../lib/sources/legistar/members-model.ts";
import { makeLegistarMembersReader } from "../lib/sources/legistar/members.ts";
import { legistarMembersPackage, publishLegistarMembers } from "../lib/sources/legistar/members-publication.ts";
import { refreshLegistarMembers } from "../lib/sources/legistar/members-refresh.ts";
import { factDb } from "./helpers/fact-db.ts";
import { NOW, rawFor, recordedMemberFetch, wiring } from "./helpers/legistar-member-fixtures.ts";

test("unseated meeting selectors cannot block real bodies and seated unidentified labels stay open", () => {
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix");
  const study = raw.bodies.find(body => body.BodyName === "Board of Supervisors Study Session")!;
  assert.ok(study);
  const unseated = { ...raw, offices: raw.offices.filter(office => office.OfficeRecordBodyId !== study.BodyId) };
  const prepared = legistarMembersPackage(unseated, rows, NOW);
  assert.ok(!prepared.bound.some(row => Number(row.config.eventBodyId) === study.BodyId));
  assert.ok(prepared.members > 0);
  const unnamed = { ...study, BodyId: 987654, BodyName: "Special Meeting" };
  const office = { ...raw.offices[0], OfficeRecordId: 987654, OfficeRecordBodyId: unnamed.BodyId };
  const withUnnamed = { ...raw, bodies: [...raw.bodies, unnamed], offices: [...raw.offices, office] };
  const result = legistarMembersPackage(withUnnamed, wiring(withUnnamed, "AZ", "America/Phoenix"), NOW);
  assert.ok(result.unbound.some(gap => gap.key === `pima:body:${unnamed.BodyId}`));
  assert.ok(result.members > 0);
});

test("HTTP reads finish before publication is dated; identical probes stop without opening stored pages", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix");
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  const vault = new MemoryEvidenceStore(), calls: URL[] = [];
  vault.get = async () => { throw new Error("Publication must not download saved evidence"); };
  const fetchSource = recordedMemberFetch(() => source, calls);
  const fetchImpl: typeof fetch = async (...args) => {
    t.mock.timers.tick(100);
    return fetchSource(...args);
  };
  const defaults = factClocks(null), clocks = { ...defaults, windowHours: () => 1 };
  const startedAt = new Date().toISOString();
  const first = await refreshLegistarMembers({ facts, clocks, now: startedAt, slug: "pima", vault, doors, fetchImpl });
  assert.ok(Date.parse(first.checkedAt) > Date.parse(startedAt), "the source's actual capture follows the pass start");
  assert.equal(first.members, 15);
  const aliases = await facts.query("SELECT entity_id, value FROM entity_external_id WHERE scheme='body-alias' ORDER BY value");
  const board = rows.find(row => Number(row.config.eventBodyId) === 138)!.bodyId;
  for (const id of [286, 287]) assert.ok(aliases.some(alias => alias.entity_id === board && alias.value === rows.find(row => Number(row.config.eventBodyId) === id)!.bodyId));
  assert.deepEqual(await facts.query("SELECT id FROM entity WHERE id=$1", [rows.find(row => Number(row.config.eventBodyId) === 228)!.bodyId]), [],
    "an unseated addendum does not become a body");
  const expectedPeople = [...new Set(source.offices.filter(office => [138, 228, 286, 287].includes(office.OfficeRecordBodyId)
    && (!office.OfficeRecordStartDate || office.OfficeRecordStartDate.slice(0, 10) <= "2026-10-13")
    && (!office.OfficeRecordEndDate || office.OfficeRecordEndDate.slice(0, 10) >= "2026-10-13"))
    .map(office => String(office.OfficeRecordPersonId)))].sort();
  const livePeople = await facts.query(`SELECT DISTINCT x.value FROM fact f JOIN entity_external_id x ON x.entity_id=substr(f.field,8)
    WHERE f.entity_id=$1 AND f.field LIKE 'member:%' AND f.status='live' AND x.scheme='legistar:pima' ORDER BY x.value`, [board]);
  assert.deepEqual(livePeople.map(row => row.value), expectedPeople, "all selectors' current members remain live on the real board");
  const stored = await facts.query("SELECT id,xmin::text AS version,ctid::text AS slot FROM fact ORDER BY id");
  const firstChecks = await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id");
  const copies = await facts.query("SELECT id, fetched_at, blob_key FROM source_copy ORDER BY id");
  assert.equal(copies.length, 2, "the body's name and its office records retain their own saved source pages");
  assert.ok((await readFactRosters(facts.query, rows.map(row => row.bodyId))).rosters.flatMap(row => row.members).some(member => member.name === "Rex Scott"));

  t.mock.timers.tick(2 * 3_600_000);
  const later = new Date().toISOString();
  calls.length = 0;
  const second = await refreshLegistarMembers({ facts, clocks, now: later, slug: "pima", vault, doors, fetchImpl });
  assert.equal(second.unchanged, true, "the member values remain exactly the same");
  assert.ok(calls.length > 0 && calls.every(memberProbe), "unchanged fingerprints stop before the full pages");
  assert.deepEqual(await facts.query("SELECT id, fetched_at, blob_key FROM source_copy ORDER BY id"), copies,
    "reading identical bytes again preserves the original immutable saved-copy row and fetched date");
  assert.deepEqual(await facts.query("SELECT id,xmin::text AS version,ctid::text AS slot FROM fact ORDER BY id"),stored);
  const secondChecks = await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id");
  assert.equal(secondChecks.length, firstChecks.length);
  assert.deepEqual(secondChecks, firstChecks, "a probe does not redate the full source evidence");

  calls.length = 0;
  t.mock.timers.tick(1_000);
  const third = await refreshLegistarMembers({ facts, clocks, now: new Date().toISOString(), slug: "pima", vault, doors, fetchImpl });
  assert.equal(third.unchanged, true);
  assert.ok(calls.length > 0 && calls.every(memberProbe));
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id"), secondChecks,
    "a fresh probe alone does not invent a new full capture or advance the facts' checked dates");
});

test("a Date-valued load clock retains milliseconds when comparing cached full evidence with a later load", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix");
  const vault = new MemoryEvidenceStore(), calls: URL[] = [];
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  await refreshLegistarMembers({ facts, clocks: factClocks(null), now: NOW, slug: "pima", vault, doors,
    fetchImpl: recordedMemberFetch(() => source, calls) });
  const raw = await makeLegistarMembersReader(vault, recordedMemberFetch(() => source, []))("pima");
  assert.ok(raw);
  const pageAt = Date.parse(NOW) + 300;
  raw.readings = raw.readings.map(reading => ({ ...reading, artifact: { ...reading.artifact, retrievedAt: new Date(pageAt).toISOString() } }));
  const [prior] = await facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", ["legistar-members:pima"]);
  let transactions = 0;
  const held = { query: async (text: string, params?: readonly unknown[]) => text === "SELECT sha256, loaded_at FROM fact_store_load WHERE source = $1"
    ? [{ sha256: prior.sha256, loaded_at: new Date(Date.parse(NOW) + 500) }] : facts.query(text, params),
    transaction: async <T>(work: (query: import("../lib/facts/publish.ts").Query) => Promise<T>) => { transactions++; return facts.transaction(work); } };
  const before = await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id");
  const result = await publishLegistarMembers({ facts: held, vault, raw, rows, clocks: factClocks(null), now: new Date(Date.parse(NOW) + 1_000).toISOString() });
  assert.equal(result.unchanged, true);
  assert.equal(transactions, 0, "a .300 full capture is older than the Date-valued .500 load, not newer than a truncated whole second");
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id"), before);
});

test("a changed source whose full read fails leaves existing facts dated at the last complete read", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix"), vault = new MemoryEvidenceStore();
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  const clocks = { ...factClocks(null), windowHours: () => 1 }, calls: URL[] = [];
  let current = source;
  const originalFetch = recordedMemberFetch(() => current, calls);
  await refreshLegistarMembers({ facts, clocks, now: NOW, slug: "pima", vault, doors, fetchImpl: originalFetch });
  const before = await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id");
  t.mock.timers.tick(2 * 3_600_000);
  current = { ...source, offices: source.offices.map((office, i) => i ? office : { ...office, OfficeRecordRowVersion: "changed" }) };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    return !memberProbe(url) && url.pathname.endsWith("officerecords") ? new Response("unavailable", { status: 500 }) : originalFetch(input, init);
  };
  await assert.rejects(refreshLegistarMembers({ facts, clocks, now: new Date().toISOString(), slug: "pima", vault, doors, fetchImpl }), /not a Legistar client/);
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM checked_fact ORDER BY id"), before);
});
