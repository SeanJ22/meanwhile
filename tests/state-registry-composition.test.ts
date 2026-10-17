import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Provenance } from "../lib/sources/types.ts";
import { withStateRegistryFacts } from "../lib/registry/state-composition.ts";
import type { BodyFacts } from "../lib/facts/registry-overlay.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { BodyRoster,RosterMember } from "../lib/registry/body-rosters.ts";

const member=(id:string):RosterMember=>({id,name:id,officeTitle:"Member",termNote:null,email:null,phone:null,websiteUrl:null});
const roster=(members:RosterMember[],collectedAt="2026-10-01"):BodyRoster=>({bodyId:"az-body",bodyName:"Arizona board",members,
  sourceUrl:"https://example.gov/board",sourceOrg:"Arizona board",collectedAt,partisanship:"NONPARTISAN"});
function held():RegistryRuntimeReadModel {
  return {formatVersion:1,registry:{divisions:[],bodies:[{id:"az-body",name:"Arizona board",officeAddress:"10 Main St",officePhone:"520-555-0111"}]},
    statewideExecutives:[],officialCandidacies:{},officialPhotos:{photos:[{officeholderId:"old-member",sourceUrl:"https://example.gov/photo"}]},
    rosterPhotos:{"old-member":"https://example.gov/photo"},bodyRosters:[roster([{...member("same-member"),email:"held@example.gov"},member("old-member")])],
    rosterReaderDispositions:[{sourceId:"old-member",canonicalId:"old-member",state:"READER_ELIGIBLE",reason:"Official roster"}]} as unknown as RegistryRuntimeReadModel;
}
const facts=(value:Partial<BodyFacts>):BodyFacts=>({id:"az-body",division:"az",fields:{},roster:null,dispositions:[],comment:null,sittings:[],...value});

test("missing fact overlays preserve held rosters, contact details, photos, and exact identities",()=>{
  const old=held(),result=withStateRegistryFacts(old,[]);
  assert.deepEqual(result,old);
  assert.equal(result.bodyRosters[0],old.bodyRosters[0]);
  assert.equal(result.registry.bodies[0],old.registry.bodies[0]);
  assert.equal(result.officialPhotos,old.officialPhotos);
  assert.equal(result.rosterPhotos,old.rosterPhotos);
});

test("an identical fact roster reuses the held record without adding fields or sources", () => {
  const old = held(), prior = old.bodyRosters[0];
  const result = withStateRegistryFacts(old, [facts({ roster: structuredClone(prior) })]);
  assert.equal(result.bodyRosters[0], prior);
  assert.deepEqual(result.bodyRosters, old.bodyRosters);
});

test("newer facts add people and update matching IDs without dropping held people or unknown fields",()=>{
  const old=held(),newRoster=roster([{...member("same-member"),name:"New official name",phone:"520-555-0112"},member("new-member")],"2026-10-15");
  const result=withStateRegistryFacts(old,[facts({roster:newRoster,fields:{officePhone:"520-555-0222"},
    dispositions:[{sourceId:"same-member",canonicalId:"official:same",state:"READER_ELIGIBLE",reason:"Current official roster"}]})]);
  assert.deepEqual(result.bodyRosters[0].members.map(row=>row.id),["same-member","old-member","new-member"]);
  assert.equal(result.bodyRosters[0].members[0].name,"New official name");
  assert.equal(result.bodyRosters[0].members[0].email,"held@example.gov");
  assert.equal(result.bodyRosters[0].members[0].phone,"520-555-0112");
  assert.equal(result.bodyRosters[0].members[0].fieldSources?.phone.collectedAt,"2026-10-15");
  assert.equal(result.registry.bodies[0].officeAddress,"10 Main St");
  assert.equal(result.registry.bodies[0].officePhone,"520-555-0222");
  assert.equal(result.bodyRosters[0].members[1].membershipSource?.collectedAt,"2026-10-01");
  assert.equal(result.bodyRosters[0].members[0].fieldSources?.email.collectedAt,"2026-10-01");
  assert.deepEqual(result.rosterReaderDispositions.map(row=>row.sourceId),["old-member","same-member"]);
  assert.equal(old.bodyRosters[0].members[0].name,"same-member","composition must not mutate the proven state payload");
});

test("older fact membership cannot overwrite newer held membership",()=>{
  const old=held(),result=withStateRegistryFacts(old,[facts({roster:roster([{...member("same-member"),name:"Earlier name",phone:"520-555-0999"}],"2025-01-01")})]);
  assert.equal(result.bodyRosters[0].members[0].name,"same-member");
  assert.equal(result.bodyRosters[0].members[0].phone,"520-555-0999","an older verified contact still fills an unknown field");
  assert.equal(result.bodyRosters[0].members.length,2);
});

const source = (day: string, label: string): Provenance => ({
  sourceUrl: `https://example.gov/${label}`, sourceOrg: "Official board", collectedAt: day, verifiedAt: day,
});

test("each contact uses its own check date and retains the matching source and contact scope", () => {
  const old = held(), prior = old.bodyRosters[0].members[0];
  Object.assign(prior, { phone: "520-555-0100", contactScope: "SHARED_OFFICE", nativeIds: { official: ["held-id"] },
    partyLabel: "Democratic", partySourceUrl: "https://example.gov/party", partyCollectedAt: "2026-10-14",
    fieldSources: { email: source("2026-10-14", "held-email"), phone: source("2026-10-14", "held-phone") } });
  const current = { ...member("same-member"), email: "outdated@example.gov", phone: "520-555-0101",
    websiteUrl: "https://example.gov/current-member", contactScope: "INDIVIDUAL_OFFICE" as const,
    nativeIds: { official: ["next-id"] }, partyLabel: "Republican", partySourceUrl: "https://example.gov/old-party", partyCollectedAt: "2025-01-01",
    fieldSources: { email: source("2025-01-01", "old-email"), phone: source("2026-10-16", "current-phone"),
      websiteUrl: source("2026-10-16", "current-website") } };
  const result = withStateRegistryFacts(old, [facts({ roster: roster([current], "2026-10-15") })]).bodyRosters[0].members[0];
  assert.equal(result.email, prior.email);
  assert.deepEqual(result.fieldSources?.email, prior.fieldSources?.email);
  assert.equal(result.phone, current.phone);
  assert.deepEqual(result.fieldSources?.phone, current.fieldSources.phone);
  assert.equal(result.contactScope, current.contactScope);
  assert.equal(result.websiteUrl, current.websiteUrl);
  assert.equal(result.partyLabel, prior.partyLabel);
  assert.equal(result.partySourceUrl, prior.partySourceUrl);
  assert.equal(result.partyCollectedAt, prior.partyCollectedAt);
  assert.deepEqual(result.nativeIds, { official: ["held-id", "next-id"] });
});

test("an older membership can carry a newer contact without changing the held identity or disposition", () => {
  const old = held(), prior = old.bodyRosters[0].members[0];
  prior.fieldSources = { email: source("2026-10-01", "old-email") };
  Object.assign(old, { rosterReaderDispositions: [{ sourceId: prior.id, canonicalId: prior.id, state: "READER_ELIGIBLE", reason: "Held source" }] });
  const result = withStateRegistryFacts(old, [facts({
    roster: roster([{ ...member(prior.id), name: "Older name", email: "current@example.gov",
      fieldSources: { email: source("2026-10-16", "current-email") } }], "2025-01-01"),
    dispositions: [{ sourceId: prior.id, canonicalId: null, state: "IDENTITY_UNRESOLVED", reason: "Older identity" }],
  })]);
  assert.equal(result.bodyRosters[0].members[0].name, prior.name);
  assert.equal(result.bodyRosters[0].members[0].email, "current@example.gov");
  assert.equal(result.bodyRosters[0].members[0].fieldSources?.email.collectedAt, "2026-10-16");
  assert.deepEqual(result.rosterReaderDispositions, old.rosterReaderDispositions);
});

test("partial body facts preserve newer held fields and provenance while adding newer sourced fields", () => {
  const old = held(), prior = old.registry.bodies[0];
  Object.assign(prior, { provenance: source("2026-10-14", "held-name"), bodyOrigin: "SOURCED",
    meetingCadence: "Second Tuesday", meetingCadenceSource: { sourceUrl: "https://example.gov/held-cadence", collectedAt: "2026-10-14" },
    fieldSources: { officePhone: source("2026-10-14", "held-phone"), officeAddress: source("2026-10-01", "held-address") } });
  const result = withStateRegistryFacts(old, [facts({ fields: { name: "Old board name", provenance: source("2025-01-01", "old-name"),
    officePhone: "520-555-0999", officeAddress: "20 Main St", meetingCadence: "First Tuesday",
    meetingCadenceSource: { sourceUrl: "https://example.gov/old-cadence", collectedAt: "2025-01-01" },
    fieldSources: { officePhone: source("2025-01-01", "old-phone"), officeAddress: source("2026-10-16", "current-address") },
  } })]).registry.bodies[0];
  assert.equal(result.name, prior.name);
  assert.deepEqual(result.provenance, prior.provenance);
  assert.equal(result.officePhone, prior.officePhone);
  assert.deepEqual(result.fieldSources?.officePhone, prior.fieldSources?.officePhone);
  assert.equal(result.officeAddress, "20 Main St");
  assert.equal(result.fieldSources?.officeAddress.collectedAt, "2026-10-16");
  assert.equal(result.meetingCadence, prior.meetingCadence);
  assert.deepEqual(result.meetingCadenceSource, prior.meetingCadenceSource);
});

test("an incomplete roster overlay retains known partisanship and its source", () => {
  const old = held(), prior = old.bodyRosters[0];
  prior.partisanship = "PARTISAN";
  prior.partisanshipSourceUrl = "https://example.gov/election";
  const overlay = { ...roster([member("new-member")], "2026-10-16"), partisanship: "UNDETERMINED" as const };
  const result = withStateRegistryFacts(old, [facts({ roster: overlay })]).bodyRosters[0];
  assert.equal(result.partisanship, "PARTISAN");
  assert.equal(result.partisanshipSourceUrl, prior.partisanshipSourceUrl);
  assert.equal(result.members.length, 3);
});

test("the held Arizona registry keeps every roster, member, disposition, contact, source, and photo through a partial overlay", () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/registry-transfer-import.json.gz", import.meta.url))).toString("utf8"));
  const original = fixture.projection.payload as RegistryRuntimeReadModel;
  const bodyRosters = original.bodyRosters.filter(row => row.bodyId.includes("/state:az/"));
  const ids = new Set(bodyRosters.flatMap(row => row.members.map(member => member.id)));
  const old = { ...original, bodyRosters,
    rosterReaderDispositions: original.rosterReaderDispositions.filter(row => ids.has(row.sourceId)) };
  const before = JSON.stringify(old), prior = bodyRosters[0], priorMember = prior.members[0];
  const result = withStateRegistryFacts(old, [facts({ id: prior.bodyId,
    roster: { ...prior, collectedAt: "2026-10-16", members: [{ ...member(priorMember.id), name: priorMember.name, officeTitle: priorMember.officeTitle }] },
  })]);
  assert.equal(bodyRosters.length, 8);
  assert.equal(ids.size, 55);
  assert.equal(old.rosterReaderDispositions.length, 55);
  assert.deepEqual(result.bodyRosters.map(row => row.bodyId), bodyRosters.map(row => row.bodyId));
  for (const heldRoster of bodyRosters) {
    const served = result.bodyRosters.find(row => row.bodyId === heldRoster.bodyId)!;
    assert.deepEqual(served.members.map(row => row.id), heldRoster.members.map(row => row.id));
    for (const heldMember of heldRoster.members) {
      const current = served.members.find(row => row.id === heldMember.id)!;
      for (const field of ["email", "phone", "websiteUrl", "termNote", "termStart", "termEnd", "partyLabel"] as const) assert.equal(current[field], heldMember[field]);
      for (const [field, receipt] of Object.entries(heldMember.fieldSources ?? {})) {
        if (field !== "name" && field !== "officeTitle") assert.deepEqual(current.fieldSources?.[field], receipt);
      }
      if (heldMember.id !== priorMember.id) assert.equal(current.membershipSource?.sourceUrl ?? served.sourceUrl, heldMember.membershipSource?.sourceUrl ?? heldRoster.sourceUrl);
    }
  }
  assert.deepEqual(result.rosterReaderDispositions, old.rosterReaderDispositions);
  assert.strictEqual(result.officialPhotos, old.officialPhotos);
  assert.strictEqual(result.rosterPhotos, old.rosterPhotos);
  assert.equal(JSON.stringify(old), before, "the published state graph must remain unchanged");
});
