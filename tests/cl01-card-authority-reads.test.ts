import assert from "node:assert/strict";
import test from "node:test";
import type { PromotedEdgeEntry } from "../lib/civic-data/read-model.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { forgetNationalShelf } from "../lib/reader/shelf.ts";
import { readCardMemberOffices, readOfficialActionIdentityAuthorities } from "../lib/officials/card-authorities-read.ts";
import { statePeopleSourcePointers } from "../lib/officials/people-identity.ts";
import { currentOfficialIdentity } from "../lib/funding/campaign-money.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { federalDirectoryScope } from "../lib/officials/federal-directory-data-plane.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import type { MemberOfficeRecord } from "../lib/officials/member-offices.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { registryFixtureForState, registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { GET as directoryGET } from "../app/api/directory/route.ts";
import { GET as actionsGET } from "../app/api/official-actions/[subject]/route.ts";

type Entry = Extract<PromotedEdgeEntry, {kind: "PROMOTED"}>;
function withCanonical(entries: readonly Entry[], run: (reads: readonly (readonly string[])[]) => Promise<void>) {
  const byKey = new Map(entries.map(entry => [entry.projection.key, entry]));
  const reads: string[][] = [];
  forgetNationalShelf();
  installFactReader(async () => []);
  installReaderDatabaseQuery(async statements => statements.map(statement => {
    const keys = statement.params[0] as string[];
    assert.ok(Array.isArray(keys), "these routes need only their batched canonical authorities");
    // A held national part asks only for the version of its entries.
    if (statement.text.includes("p.xmin::text")) return [{value: "a".repeat(64)}];
    reads.push(keys);
    if (statement.text.includes("r.collection='memberOffices'")) {
      const entry = entries.find(entry => entry.projection.recordClass === "CURATED_READER_RECORD" && keys.includes(entry.projection.scope));
      if (!entry) return [];
      const payload = entry.projection.payload as {kind:string;records:MemberOfficeRecord[]};
      const members = statement.params[3] as string[];
      assert.ok(members.includes(person.id) && members.includes(person.personId!), "the keyed lookup retains exact person aliases");
      return [{valid:true, scope:entry.projection.scope,version_id:entry.projection.versionId,source_id:entry.projection.sourceId,
        promoted_at:entry.projection.promotedAt,retrieved_at:entry.attested.retrievedAt, temporal:{},header:{kind:payload.kind},normalization:{},
        receipt:entry.projection.receipt,records:payload.records.filter(record=>members.includes(record.officeholderId)),sources:[]}];
    }
    return keys.flatMap(key => {
      const entry = byKey.get(key);
      return entry ? [{row_kind: "promotion", key, record_class: entry.projection.recordClass, scope: entry.projection.scope,
        source_id: entry.projection.sourceId, current_version_id: entry.projection.versionId, last_known_good_version_id: entry.projection.versionId,
        promoted_at: entry.projection.promotedAt, validation_receipt: entry.projection.receipt, payload: entry.projection.payload,
        normalized_hash: entry.attested.payloadSha256, retrieved_at: entry.attested.retrievedAt, published: true}] : [];
    });
  }));
  return run(reads).finally(() => {installReaderDatabaseQuery(undefined); installFactReader(undefined);});
}

const at = "2026-10-24T12:00:00.000Z", uuid = "00000000-0000-4000-8000-000000000099";
const person: Officeholder = {id: `plural:tx:${uuid}`, personId: `plural:${uuid}`, nativeIds: {"ocd-person": [`ocd-person/${uuid}`]}, name: "Held Person",
  officeTitle: "Lieutenant Governor", level: "STATE", termStart: "2023-01-17", termEnd: "2027-01-19", birthDate: null, partyLabel: null,
  websiteUrl: "https://www.ltgov.texas.gov/", contactFormUrl: null, email: null, phone: null, campaignUrl: null, photo: null, state: "TX",
  provenance: {sourceUrl: "https://data.openstates.org/people/current/tx.csv", sourceOrg: "Open States", collectedAt: at, verifiedAt: null},
  offices: [{name: "Capitol", address: "100 Main St, Austin, TX 78701", email: "capitol@example.gov", sourceUrl: "https://www.ltgov.texas.gov/contact/", collectedAt: at},
    {name: "District", address: "200 Oak St, Houston, TX 77002", phone: "713-555-0100", sourceUrl: "https://www.ltgov.texas.gov/contact/", collectedAt: at}]};
function peopleEntry(holder: Officeholder) {
  return provenEdgeEntry({recordClass: "STATE_LEGISLATOR", scope: "US-TX:openstates-people:v1", sourceId: "plural-openstates", versionId: "test:card-people", value: {
    formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-TX", term: "held", generatedAt: at,
    roster: {scope: "US-TX", generatedAt: at, officeholders: [holder], divisions: [], unmatched: []},
  }});
}

test("native directory offices preserve every office and source without state services or curated fallback", async () => {
  await withCanonical([peopleEntry(person)], async reads => {
    const offices = await readCardMemberOffices(person.personId!, "TX");
    assert.equal(offices.length, 2);
    assert.equal(offices[0].office.email, "capitol@example.gov");
    assert.equal(offices[1].office.phone, "713-555-0100");
    assert.ok(offices.every(row => row.sourceUrl === "https://www.ltgov.texas.gov/contact/" && row.collectedAt === at));
    assert.deepEqual(reads, [statePeopleSourcePointers("US-TX").map(row => `${row.recordClass}:${row.scope}`)]);
  });
});

test("a person without native offices still receives the existing curated offices through exact aliases", async () => {
  const curated = requiredManualProductionContract("member-offices");
  const record: MemberOfficeRecord = {id: "held-curated-office", kind: "MEMBER_OFFICE", officeholderId: person.personId!, officeKind: "DISTRICT",
    office: {address: "300 Pine St", city: "Dallas", state: "TX", zip: "75201", phone: "214-555-0100", lat: null, lng: null},
    sourceUrl: "https://www.ltgov.texas.gov/district/", sourceOrg: "Held Legislature", official: true, collectedAt: at};
  const fallback = provenEdgeEntry({recordClass: curated.recordClass, scope: curated.scope, sourceId: curated.sourceId!, versionId: "test:card-curated", value: {kind: "member-offices", records: [record]}});
  await withCanonical([peopleEntry({...person, offices: []}), fallback], async reads => {
    assert.deepEqual(await readCardMemberOffices(person.id, "TX"), [record]);
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[1], ["US-TX:state-legislator-member-offices", curated.scope]);
  });
});

test("a federal directory hint is verified against the held member and keeps offices, committees and source lineage", async () => {
  const value = normalizeCongressDirectory({"legislators-current": [{id: {bioguide: "T009997"}, name: {first: "Held", last: "Member"}, terms: [{type: "sen", state: "FL", start: "2025-01-03", end: "2031-01-03"}]}],
    "legislators-district-offices": [{id: {bioguide: "T009997"}, offices: [{address: "100 Main St", city: "Tallahassee", state: "FL", zip: "32301", phone: "850-555-0100"}]}]}, "a".repeat(40), at);
  const entry = provenEdgeEntry({recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope("FL"), sourceId: "congress-directory-project", versionId: "test:card-federal", value});
  await withCanonical([entry], async reads => {
    const response = await directoryGET(new Request("https://meanwhile.example/api/directory?member=congress:T009997&state=FL"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.source, value.directory.source);
    assert.equal(body.districtOffices[0].phone, "850-555-0100");
    assert.match(body.officeDetails[0].sourceUrl, /legislators-district-offices\.yaml$/);
    assert.equal(body.officeDetails[0].collectedAt, at);
    assert.deepEqual(body.committees, value.directory.byMember.T009997.committees);
    assert.deepEqual(reads, [[`FEDERAL_DIRECTORY:${federalDirectoryScope("FL")}`]]);
  });
});

test("a different supplied state cannot hide the member's held federal offices", async () => {
  const value = normalizeCongressDirectory({"legislators-current": [{id: {bioguide: "T009996"}, name: {first: "Other", last: "Member"}, terms: [{type: "sen", state: "FL", start: "2025-01-03", end: "2031-01-03"}]}],
    "legislators-district-offices": [{id: {bioguide: "T009996"}, offices: [{address: "200 Pine St", city: "Tallahassee", state: "FL", zip: "32301", phone: "850-555-0200"}]}]}, "b".repeat(40), at);
  const entry = provenEdgeEntry({recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope("FL"), sourceId: "congress-directory-project", versionId: "test:card-federal-fallback", value});
  await withCanonical([entry], async reads => {
    const response = await directoryGET(new Request("https://meanwhile.example/api/directory?member=congress:T009996&state=GA"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.districtOffices[0].phone, "850-555-0200");
    assert.deepEqual(body.source, value.directory.source);
    assert.deepEqual(reads[0], [`FEDERAL_DIRECTORY:${federalDirectoryScope("GA")}`]);
    assert.ok(reads.some(keys => keys.length > 1 && keys.includes(`FEDERAL_DIRECTORY:${federalDirectoryScope("FL")}`)), "the established native-member lookup supplies a different held place");
  });
});

test("non-Arizona official actions verify their own registry without unrelated people or action sources", async () => {
  const registry = registryTransferImport(), scope = stateRegistryRuntimeScope("CA");
  const entry = provenEdgeEntry({recordClass: "REGISTRY_RUNTIME_BINDING", scope, sourceId: registry.projection.sourceId, versionId: "test:card-registry-ca", value: registryFixtureForState("CA")});
  await withCanonical([entry], async reads => {
    const subject = "plural:ca:1529b892-b3da-4958-bb3a-5bf04d7b5e0c";
    const response = await actionsGET(new Request(`https://meanwhile.example/api/official-actions/${subject}?division=ocd-division/country:us/state:ca`), {params: Promise.resolve({subject})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {subjectId: subject, officialIds: [], resolvedTargetId: subject, status: "NO_APPLICABLE_OFFICIAL", withheldRecords: [], count: 0, records: []});
    assert.deepEqual(reads, [[`REGISTRY_RUNTIME_BINDING:${scope}`]]);
  });
});

test("Arizona's exact registry holder keeps its verified action identity without unrelated state services", async () => {
  const registry = registryTransferImport(), value = registryFixtureForState("AZ"), scope = stateRegistryRuntimeScope("AZ");
  const holder = value.statewideExecutives.find(row => row.holder.id === "statewide:az/governor")!.holder;
  const entry = provenEdgeEntry({recordClass: "REGISTRY_RUNTIME_BINDING", scope, sourceId: registry.projection.sourceId, versionId: "test:card-registry-az", value});
  await withCanonical([entry], async reads => {
    await withReaderSelection({states: ["AZ"], keys: new Set([holder.id])}, async () => {
      await readOfficialActionIdentityAuthorities(holder.id, ["AZ"]);
      assert.equal(currentOfficialIdentity(holder.id)?.name, holder.name);
    });
    assert.deepEqual(reads, [[`REGISTRY_RUNTIME_BINDING:${scope}`]]);
  });
});

test("required directory and official identity failures stay explicit unavailable responses", async () => {
  installReaderDatabaseQuery(async () => {throw new Error("held source unavailable");});
  try {
    const directory = await directoryGET(new Request("https://meanwhile.example/api/directory?member=congress:T009998&state=FL"));
    assert.equal(directory.status, 503);
    assert.equal((await directory.json()).holdingStatus, "HOLDING_UNAVAILABLE");
    const subject = "congress:T009998";
    const actions = await actionsGET(new Request(`https://meanwhile.example/api/official-actions/${subject}?division=ocd-division/country:us/state:fl`), {params: Promise.resolve({subject})});
    assert.equal(actions.status, 503);
    assert.deepEqual((await actions.json()).unavailableAuthorities, ["PERSON_IDENTITY"]);
  } finally {installReaderDatabaseQuery(undefined);}
});
