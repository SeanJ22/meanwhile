import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { heldSubjectDetails, heldSubjectEnrichmentObligations } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import { publishHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-publication.ts";
import { HELD_FACT_CLOCKS_SQL, HELD_SUBJECT_PROGRESS_SQL, readHeldFactClocks, readHeldSubjectProgress } from "../lib/control-plane/scheduler/providers/held-subject-progress.ts";
import { HELD_MEMBER_IDENTITIES_SQL, indexHeldMemberIdentities, readHeldMemberIdentities } from "../lib/control-plane/scheduler/providers/held-subject-member-identities.ts";
import { readHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-loader.ts";
import { HELD_ROSTER_SUBJECTS_SQL, readHeldRosterSubjects } from "../lib/control-plane/scheduler/providers/held-subject-rosters.ts";
import { FRESHNESS_HOURS_DEFAULT, factClocks } from "../lib/facts/clocks.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { rosterForBody, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { withStateRegistryFacts } from "../lib/registry/state-composition.ts";
import { heldSubjectDb } from "./helpers/held-subject-db.ts";

const AT = "2026-10-20T07:00:00.000Z", OLD = "2026-09-01T07:00:00.000Z", NOW = new Date(AT);
const DIVISION = "ocd-division/country:us/state:az/place:sample", BODY = `${DIVISION}#governing`;
const MEMBER = `native-roster:${BODY}#ada`, PERSON = "ocd-person/ada-sample", SOURCE = "https://sample.example.gov/council";
const capture = (text: string): WorkerPublicationCapture => ({ observedAt: AT, httpStatus: 200, transport: "REACHABLE", partial: false,
  evidence: { text, artifactId: "native-first", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    acquiredByAttemptId: "native-source-read", canonicalUrl: SOURCE, retrievedAt: AT, sourceId: "sample.example.gov", methodRouteId: "held-subject-details" } });
function runtime(): RegistryRuntimeReadModel {
  return { registry: { generatedAt: OLD, divisions: [{ ocdId: DIVISION, label: "Sample" }], bodies: [{ id: BODY, ocdId: DIVISION,
    name: "Sample Council", bodyClass: "GOVERNING", homepageUrl: SOURCE, agendaSourceRef: null, meetingCadence: null,
    provenance: { sourceUrl: SOURCE, collectedAt: OLD } }] },
    bodyRosters: [{ bodyId: BODY, bodyName: "Sample Council", sourceUrl: SOURCE, sourceOrg: "Sample", collectedAt: OLD,
      members: [{ id: MEMBER, personId: PERSON, name: "Ada Sample", officeTitle: "Council Member", phone: null, email: null }] }],
    statewideExecutives: [], officialCandidacies: { rows: [] }, rosterPhotos: {}, officialPhotos: { photos: [] }, rosterReaderDispositions: [] } as unknown as RegistryRuntimeReadModel;
}
const official = (value = runtime()) => heldSubjectDetails(value, "AZ", AT).find(subject => subject.subjectKind === "official")!;

test("first saved native-body roster keeps its canonical person and native reader link without a prior fact roster", async () => {
  const db = await heldSubjectDb();
  try {
    const native = runtime();
    await db.saveRegistry("AZ", { ...native, unneededCountry: { $civicPayloadPart: "MUST_NOT_LOAD" } });
    await db.saveRegistry("NH", { ...native, bodyRosters: [{ ...native.bodyRosters[0], members: [{ id: "wrong-state", name: "Ada Sample", personId: "wrong-person" }] }] });
    const subject = heldSubjectDetails(native, "AZ", AT).find(row => row.subjectKind === "body")!;
    const page = '<main><h1>Sample Council</h1><h2>Council members</h2><table><tr><th>Name</th><th>Office</th></tr>' +
      '<tr><td>Ada Sample</td><td>Council Member</td></tr></table></main>';
    assert.deepEqual((await readFactRosters(db.query, [BODY])).rosters, []);
    const identities = await readHeldMemberIdentities(db.query, "AZ", BODY);
    assert.deepEqual(identities, [{ id: MEMBER, name: "Ada Sample", personId: PERSON }]);
    assert.deepEqual(await readHeldMemberIdentities(db.query, "AZ", `${BODY}:other`), []);
    assert.deepEqual(await readHeldMemberIdentities(db.query, "NH", BODY), [], "a named body cannot borrow another state's native roster");
    const result = await publishHeldSubjectDetails({ subject, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(result.refused, null); assert.deepEqual(result.rosterIdentityGaps, []); assert.ok(result.roster!.live > 0);
    const published = await readFactRosters(db.query, [BODY]);
    assert.equal(published.rosters[0]!.members[0]!.id, MEMBER);
    assert.equal(published.rosters[0]!.members[0]!.personId, PERSON);
    assert.deepEqual((await db.query("SELECT id FROM entity WHERE kind='person'")).map(row => row.id), [PERSON], "no replacement UUID person is minted");
    const value = withStateRegistryFacts(native, [{ id: BODY, division: DIVISION, fields: {}, roster: published.rosters[0]!, dispositions: published.dispositions, comment: null, sittings: [] }]);
    assert.equal(value.bodyRosters[0]!.members.length, 1, "native and fact members merge on the existing reader link");
    const holders = withRegistryRuntimeProjection(value, ["AZ"], () => rosterHoldersForBody(BODY));
    assert.equal(holders[0]!.id, MEMBER);
    assert.equal(withRegistryRuntimeProjection(value, ["AZ"], () => rosterForBody(BODY))!.members[0]!.personId, PERSON);
    assert.ok(HELD_MEMBER_IDENTITIES_SQL.includes("member->>'personId'"));
  } finally { await db.pg.close(); }
});

test("same-name native members stay an identity gap while independently verified body facts publish", async () => {
  const db = await heldSubjectDb();
  try {
    const native = runtime();
    await db.saveRegistry("AZ", { ...native, bodyRosters: [{ ...native.bodyRosters[0], members: [native.bodyRosters[0]!.members[0],
      { id: "other-native-member", personId: "other-canonical-person", name: "Ada Sample", officeTitle: "Council Member" }] }] });
    const subject = heldSubjectDetails(native, "AZ", AT).find(row => row.subjectKind === "body")!;
    const page = '<main><h1>Sample Council</h1><p>Office phone: 520-555-0100</p><h2>Council members</h2>' +
      '<table><tr><th>Name</th><th>Office</th></tr><tr><td>Ada Sample</td><td>Council Member</td></tr></table></main>';
    const result = await publishHeldSubjectDetails({ subject, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.deepEqual(result.rosterIdentityGaps, ["ada sample"]); assert.equal(result.roster, null);
    assert.equal((await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='office_phone' AND status='live'", [BODY]))[0]!.value, "520-555-0100");
    assert.equal((await db.query("SELECT reason FROM blank WHERE field='member-row:ada sample'"))[0]!.reason, "HELD_MEMBER_IDENTITY_AMBIGUOUS");
    assert.deepEqual(indexHeldMemberIdentities([{ id: MEMBER, name: "Ada Sample", personId: PERSON },
      { id: "other", name: "Ada Sample", personId: "other" }]).get("ada sample"), null);
  } finally { await db.pg.close(); }
});

test("published contact metadata closes only that held official's owed field on its actual Admin fact clock", async () => {
  const db = await heldSubjectDb();
  try {
    const value = runtime(), held = official(value);
    await db.saveRegistry("AZ", value);
    const body = heldSubjectDetails(value, "AZ", AT).find(row => row.subjectKind === "body")!;
    await publishHeldSubjectDetails({ subject: body,
      capture: capture('<main><h1>Sample Council</h1><h2>Members</h2><table><tr><th>Name</th><th>Office</th></tr><tr><td>Ada Sample</td><td>Council Member</td></tr></table></main>'),
      db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    await publishHeldSubjectDetails({ subject: held, capture: capture('<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p></main>'),
      db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    let configReads = 0;
    const clocks = await readHeldFactClocks(async (sql, params) => {
      configReads++; assert.equal(sql, HELD_FACT_CLOCKS_SQL); assert.equal(params, undefined);
      return [{ freshness_hours: { ...FRESHNESS_HOURS_DEFAULT, contact: 2 } }];
    });
    const fields = await readHeldSubjectProgress(async (sql, params) => {
      assert.equal(sql, HELD_SUBJECT_PROGRESS_SQL);
      const rows = await db.query(sql, params);
      assert.ok(rows.every(row => !("value" in row) && !("quote" in row)), "no contact, portrait, committee or statement payload leaves the server");
      return rows;
    }, heldSubjectDetails(value, "AZ", AT), clocks);
    assert.equal(configReads, 1); assert.equal(fields.length, 1);
    assert.equal(fields[0]!.checkedAt, AT); assert.equal(fields[0]!.freshUntil, "2026-10-20T09:00:00.000Z");
    assert.deepEqual(fields[0]!.value, { liveField: "phone" });
    const after = heldSubjectDetails(value, "AZ", AT, [], [], fields), target = after.find(row => row.subjectId === MEMBER)!;
    assert.ok(!target.checklistIds.includes("OFF-09")); assert.ok(target.checklistIds.includes("OFF-06")); assert.ok(target.checklistIds.includes("OFF-12"));
    assert.equal(target.checkedAt, AT); assert.equal(heldSubjectEnrichmentObligations(after).find(row => row.subjectId === MEMBER)!.lastWorkedAt, AT);
    assert.ok(heldSubjectDetails(value, "AZ", "2026-10-20T09:00:00.001Z", [], [], fields).find(row => row.subjectId === MEMBER)!.checklistIds.includes("OFF-09"));
    assert.ok(heldSubjectDetails(value, "AZ", AT).find(row => row.subjectId === MEMBER)!.checklistIds.includes("OFF-09"), "immutable native blanks are not rewritten");
  } finally { await db.pg.close(); }
});

test("stored details without an unchanged reader path remain owed, including a native member without a live fact membership", async () => {
  const db = await heldSubjectDb();
  try {
    const held = official();
    const page = '<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p><p>Office address: 10 Public Plaza</p><p>Term ends: 2028</p></main>';
    const result = await publishHeldSubjectDetails({ subject: held, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(result.readerSupportedNewFacts, 0);
    assert.ok(result.readerDependencies.some(row => row.field === "office_address"));
    assert.deepEqual(await readHeldSubjectProgress(db.query, [held], factClocks(null)), []);
    const unsupported = [
      { ...held, bodyId: null },
      { ...held, subjectId: "government:sample", subjectKind: "government" as const },
    ];
    const fields = ["office_address", "portrait", "committee:held", "statement:held", "term_end:office:Councilmember", "office_phone", "body:held"];
    for (const subject of [held, ...unsupported]) assert.deepEqual(await readHeldSubjectProgress(async () => fields.map(field => ({
      subject_id: subject.subjectId, field, value_type: ["portrait", "committee:held", "statement:held", "body:held"].includes(field) ? "object" : "string",
      nonempty: true, checked_at: AT, source_url: SOURCE,
    })), [subject], factClocks(null)), []);
  } finally { await db.pg.close(); }
});

test("progress rejects foreign identities, wrong role terms, empty values and unavailable Admin clocks", async () => {
  const held = official();
  assert.deepEqual(await readHeldSubjectProgress(async () => [{ subject_id: "other", field: "phone", value_type: "string", nonempty: true, checked_at: AT, source_url: SOURCE },
    { subject_id: held.subjectId, field: "term_end:another-body", value_type: "string", nonempty: true, checked_at: AT, source_url: SOURCE },
    { subject_id: held.subjectId, field: "phone", value_type: "string", nonempty: false, checked_at: AT, source_url: SOURCE }], [held], factClocks(null)), []);
  await assert.rejects(() => readHeldFactClocks(async () => { throw Error("OFFLINE"); }), /OFFLINE/);
  await assert.rejects(() => readHeldFactClocks(async () => []), /HELD_FACT_CLOCKS_UNREADABLE/);
  assert.deepEqual(await readHeldSubjectProgress(async () => { throw Error("EMPTY_MUST_NOT_QUERY"); }, [], factClocks(null)), []);
});

test("an existing contradictory member alias is never rebound to the newly read native person", async () => {
  const db = await heldSubjectDb();
  try {
    const value = runtime(); await db.saveRegistry("AZ", value);
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('person:conflicting','person','Different native identity','AZ')");
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES('person:conflicting','roster-member',$1)", [MEMBER]);
    const subject = heldSubjectDetails(value, "AZ", AT).find(row => row.subjectKind === "body")!;
    const page = '<main><h1>Sample Council</h1><h2>Council members</h2><table><tr><th>Name</th><th>Office</th></tr>' +
      '<tr><td>Ada Sample</td><td>Council Member</td></tr></table></main>';
    const result = await publishHeldSubjectDetails({ subject, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.deepEqual(result.rosterIdentityGaps, ["ada sample"]); assert.equal(result.roster, null);
    assert.equal((await db.query("SELECT entity_id FROM entity_external_id WHERE scheme='roster-member' AND value=$1", [MEMBER]))[0]!.entity_id, "person:conflicting");
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE field LIKE 'member:%'"))[0]!.n, 0);
  } finally { await db.pg.close(); }
});

test("a newly published member absent from the native registry is enumerated and exact-loaded with other details still owed", async () => {
  const db = await heldSubjectDb();
  try {
    const native = { ...runtime(), bodyRosters: [] };
    await db.saveRegistry("AZ", { ...native, unrelatedCountry: { $civicPayloadPart: "MUST_NOT_LOAD" } });
    const before = heldSubjectDetails(native, "AZ", AT), body = before.find(subject => subject.subjectKind === "body")!;
    assert.ok(!before.some(subject => subject.subjectKind === "official"));
    const page = '<main><h1>Sample Council</h1><h2>Council members</h2><table><tr><th>Name</th><th>Office</th></tr>' +
      '<tr><td>Sam Example</td><td>Chair</td></tr></table></main>';
    const published = await publishHeldSubjectDetails({ subject: body, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.ok(published.roster!.live > 0);
    const live = await readHeldRosterSubjects(async (sql, params) => {
      assert.equal(sql, HELD_ROSTER_SUBJECTS_SQL); assert.deepEqual(params, [[BODY], AT]);
      const rows = await db.query(sql, params);
      assert.ok(rows.every(row => Object.keys(row).sort().join(",") === "body_id,checked_at,name,office_title,person_id,source_url"));
      return rows;
    }, native, "AZ", AT);
    assert.deepEqual(live.identityGaps, []); assert.equal(live.registry.registry.bodies.length, 1);
    const subjects = heldSubjectDetails(live.registry, "AZ", AT), member = subjects.find(subject => subject.subjectKind === "official")!;
    assert.ok(member); assert.equal(member.personName, "Sam Example"); assert.equal(member.officeTitle, "Chair"); assert.equal(member.bodyId, BODY);
    assert.ok(member.checklistIds.includes("OFF-09")); assert.ok(member.checklistIds.includes("OFF-06")); assert.ok(member.checklistIds.includes("OFF-12"));
    assert.equal(member.checkedAt, AT); assert.deepEqual(member.sourceUrls, [SOURCE]);
    const loaded = await readHeldSubjectDetails(db.query, "AZ", member.subjectId, AT);
    assert.ok(loaded); assert.equal(loaded.subjectId, member.subjectId); assert.equal(loaded.personId, member.personId);
    assert.equal(loaded.personName, "Sam Example"); assert.deepEqual(loaded.sourceUrls, [SOURCE]); assert.ok(loaded.checklistIds.includes("OFF-09"));
    assert.equal(await readHeldSubjectDetails(db.query, "NH", member.subjectId, AT), null, "the exact same person cannot borrow another state registry");
    assert.equal(await readHeldSubjectDetails(db.query, "AZ", `${member.subjectId}:other`, AT), null);
    const rejected = await readHeldRosterSubjects(async () => [
      { body_id: "invented-body", person_id: "invented-person", name: "Invented Person", office_title: "Chair", source_url: SOURCE, checked_at: AT },
      { body_id: BODY, person_id: "bad-source", name: "Wrong Source", office_title: "Chair", source_url: "https://user:password@example.gov", checked_at: AT },
      { body_id: BODY, person_id: "future-source", name: "Future Person", office_title: "Chair", source_url: SOURCE, checked_at: "2026-10-21T07:00:00Z" },
    ], native, "AZ", AT);
    assert.deepEqual(rejected.registry.bodyRosters, []);
    const ambiguous = await readHeldRosterSubjects(async () => [{ body_id: BODY, person_id: "different-person", name: "Ada Sample", office_title: "Chair", source_url: SOURCE, checked_at: AT }],
      runtime(), "AZ", AT);
    assert.equal(ambiguous.identityGaps.length, 1); assert.equal(ambiguous.registry.bodyRosters[0]!.members.length, 1);
  } finally { await db.pg.close(); }
});
