import assert from "node:assert/strict";
import { test } from "node:test";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import { stateMemberDirectories, zipMemberDirectories } from "../lib/reader/member-directories.ts";
import { scopedHolders } from "../lib/officials/scoped-holders.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { MemberOfficeRecord } from "../lib/officials/member-offices.ts";
import { civicDataReadNotInitialized } from "../lib/civic-data/read-model.ts";

const ROOT = "ocd-division/country:us/state:fl", AT = "2026-10-12T00:00:00.000Z";
function person(id: string, name: string, bioguides: string[], source = "https://www.senate.gov/member", collectedAt = AT): Officeholder {
  return { id, personId: id, nativeIds: { bioguide: bioguides }, name, officeTitle: "U.S. Senator", level: "FEDERAL", state: "FL", chamber: "senate",
    termStart: "2025-01-01", termEnd: "2031-01-01", birthDate: null, partyLabel: null, websiteUrl: source, phone: "202-555-0100", email: null,
    contactFormUrl: null, campaignUrl: null, photo: null, provenance: { sourceUrl: source, sourceOrg: "Official publisher", collectedAt, verifiedAt: collectedAt } };
}
function roster(people: Officeholder[]): OfficeholderSet {
  return { scope: "FL", generatedAt: AT, officeholders: people, divisions: people.map(person => ({ officeholderId: person.id, ocdId: ROOT, bodyId: null })), unmatched: [] };
}
function packageFor(federal: Officeholder[], additional: Officeholder[]): ReaderStatePackage {
  return { state: "FL", version: "fixture", boundaryUrl: "/boundaries.pmtiles", districts: { kind: "NOT_PUBLISHED" },
    registry: { formatVersion: 1, registry: { generatedAt: AT, divisions: [{ ocdId: ROOT, label: "Florida", divisionType: "state", tier: "state" }], bodies: [] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } } as unknown as RegistryRuntimeReadModel,
    federal: { roster: roster(federal) } as FederalDirectoryReadModel,
    people: roster(additional), legislativePeople: roster(additional),
    stateLegislatorAuthority: { scope: "US-FL", kind: "NOT_RECORDED", metadata: {}, code: null, detail: "fixture" },
  } as ReaderStatePackage;
}

test("cached state coverage carries a person's held candidate photo into its own composition context", () => {
  const canonical=person("congress:Z000001","Photo Reader",["Z000001"]);
  const base=packageFor([canonical],[]);
  const state={...base,candidateProfilesRead:{kind:"BOOTSTRAP" as const,detail:"Held candidate profiles",
    metadata:civicDataReadNotInitialized("CANDIDATE_PROFILE","US-FL:profiles","fixture").metadata,
    value:{cards:{curatedAt:AT,note:"",hunts:[],cards:{[canonical.id]:{personId:canonical.id,
      photoUrl:"/candidates/photo-reader.jpg",photoSource:"Reader campaign",bio:null,bioSourceUrl:null,bioSourceLabel:null,
      email:null,phone:null,phoneLabel:null,filedAddress:null,filedAddressSource:null}}},
      links:{curatedAt:AT,note:"",hunts:[],links:{}}}}};
  for(let read=0;read<2;read++){
    const shown=stateCoverage(state,[ROOT],25,-80).senators[0];
    assert.equal(shown.id,canonical.id);
    assert.equal(shown.photoUrl,"/candidates/photo-reader.jpg");
  }
});

test("Congress directory identity stays canonical when source-native people sort before or after it", () => {
  for (const [canonicalName, apiName] of [["Zed Reader", "Aaron Reader"], ["Aaron Reader", "Zed Reader"]]) {
    const canonical = person("congress:Z000001", canonicalName, ["Z000001"]);
    const api = { ...person("congress-api:fl:Z000001", apiName, ["Z000001"], "https://www.congress.gov/member/fixture", "2026-10-13T00:00:00.000Z"), phone: "202-555-0199" };
    const coverage = stateCoverage(packageFor([canonical], [api]), [ROOT], 25, -80);
    assert.equal(coverage.senators.length, 1);
    const holder = coverage.senators[0];
    assert.equal(holder.id, canonical.id);
    assert.equal(holder.name, api.name);
    assert.equal(holder.phone, api.phone);
    assert.equal(holder.provenance?.sourceUrl, api.provenance.sourceUrl);
    assert.ok(personIdentityKeys(holder).has(api.id));
    assert.ok(personIdentityKeys(holder).has(canonical.id));
  }
});

test("a source-native record naming two held Congress identities never selects either directory arbitrarily", () => {
  const first = person("congress:Z000001", "First Reader", ["Z000001"]), second = person("congress:Z000002", "Second Reader", ["Z000002"]);
  const ambiguous = person("ambiguous-source:fl:member", "Aaron Reader", ["Z000001", "Z000002"]);
  const coverage = stateCoverage(packageFor([first, second], [ambiguous]), [ROOT], 25, -80);
  assert.equal(coverage.senators[0].id, ambiguous.id);
  assert.ok(personIdentityKeys(coverage.senators[0]).has(first.id));
  assert.ok(personIdentityKeys(coverage.senators[0]).has(second.id));
});

test("shared state and place indexes retain new photo and federal publications", () => {
  const canonical = person("congress:Z000001", "First Reader", ["Z000001"]);
  const state = packageFor([canonical], []);
  const first = stateCoverage(state, [ROOT], 25, -80);
  assert.deepEqual(stateCoverage({ ...state, registry: { ...state.registry, bodyRosters: [] } }, [ROOT], 25, -80), first);
  const updated = { ...state, federal: { ...state.federal!, roster: roster([{ ...canonical, phone: "202-555-0199" }]) },
    registry: { ...state.registry, officialPhotos: { photos: [{ officeholderId: canonical.id, name: canonical.name, url: "https://www.senate.gov/new-photo.jpg", license: null }] } } };
  const after = stateCoverage(updated, [ROOT], 25, -80);
  assert.equal(after.senators[0].phone, "202-555-0199");
  assert.equal(after.senators[0].photoUrl, "https://www.senate.gov/new-photo.jpg");
});

test("state office directories retain exact aliases, order, and provenance without priming ambiguous or missing offices", () => {
  const holder = { ...person("fl-legislature:member", "State Reader", []), nativeIds: { reader: ["plural:fl:member"] }, officeTitle: "State Representative", level: "STATE" as const,
    offices: [{ name: "District office", address: "1 Main St, Tallahassee, FL 32399", phone: "850-555-0101", sourceUrl: "https://www.myfloridahouse.gov/member", collectedAt: AT },
      { name: "Capitol office", address: "2 Capitol St, Tallahassee, FL 32399", phone: "850-555-0102", sourceUrl: "https://www.myfloridahouse.gov/member", collectedAt: AT }] };
  const duplicate = { ...person("fl-legislature:another", "Another Reader", []), nativeIds: { reader: ["plural:fl:member"] } };
  const directories = stateMemberDirectories(roster([holder, duplicate]));
  assert.equal(directories.length, 1);
  assert.ok(directories[0].ids.includes(holder.id));
  assert.ok(!directories[0].ids.includes("plural:fl:member"));
  assert.deepEqual(directories[0].directory.officeDetails?.map(row => row.officeKind), ["CAPITOL", "DISTRICT"]);
  assert.equal(directories[0].directory.districtOffices[1].address, "1 Main St");
  assert.equal(directories[0].directory.officeDetails?.[0].sourceUrl, holder.offices[1].sourceUrl);
  assert.equal(stateMemberDirectories(roster([duplicate])).length, 0);
});

test("indexed multi-seat identities keep first-match order and never join another office", () => {
  const holder = (id: string, aliases: string[], officeTitle = "State Representative"): SeatHolder => ({
    ...person(id, id, []), officeTitle, partyLabel: null, websiteUrl: null, sourceUrl: "https://www.myfloridahouse.gov/member", photoUrl: null,
    nativeIds: { reader: aliases }, social: [],
  });
  const first = holder("first", ["shared-first"]), second = holder("second", ["shared-second"]);
  const bridge = holder("bridge", ["shared-second", "shared-first"]);
  const differentOffice = holder("senator", ["shared-first"], "State Senator");
  const result = scopedHolders([first, second], [bridge, differentOffice]);
  assert.deepEqual(result.map(row => row.id), [first.id, second.id, differentOffice.id]);
  assert.ok(personIdentityKeys(result[0]).has(bridge.id));
  assert.ok(!personIdentityKeys(result[1]).has(bridge.id));
});

test("state directories use exact curated fallback offices and retain native office precedence", () => {
  const holder = { ...person("plural:fl:member", "State Reader", []), officeTitle: "State Representative", nativeIds: { reader: ["fl-legislature:member"] } };
  const curated: MemberOfficeRecord = { id: "office:fl-legislature:member", kind: "MEMBER_OFFICE", officeholderId: "fl-legislature:member", officeKind: "CAPITOL",
    office: { address: "2 Capitol St", city: "Tallahassee", state: "FL", zip: "32399", phone: "850-555-0101", lat: null, lng: null },
    sourceUrl: "https://www.myfloridahouse.gov/member", sourceOrg: "Florida House", official: true, collectedAt: AT };
  const fallback = stateMemberDirectories(roster([holder]), [curated, { ...curated, id: "another-office", officeholderId: "another-member" }]);
  assert.equal(fallback.length, 1);
  assert.deepEqual(fallback[0].directory.districtOffices, [curated.office]);
  assert.equal(fallback[0].directory.officeDetails?.[0].official, true);
  assert.ok(fallback[0].ids.includes(holder.id));
  assert.ok(fallback[0].ids.includes(curated.officeholderId));
  const native = { ...holder, offices: [{ name: "Capitol", address: "1 Held St, Tallahassee, FL 32399", phone: "850-555-0199", sourceUrl: curated.sourceUrl, collectedAt: AT }] };
  assert.equal(stateMemberDirectories(roster([native]), [curated])[0].directory.districtOffices[0].address, "1 Held St");
  const duplicate = { ...holder, id: "another-member" };
  assert.deepEqual(stateMemberDirectories(roster([holder, duplicate]), [curated]), [], "a shared native alias cannot select either person's office");
});

test("a ZIP carries only its people's offices and held empty directories without another lookup", () => {
  const known = {...person("fl-legislature:member", "State Reader", []),officeTitle:"State Representative",nativeIds:{reader:["plural:fl:member"]}};
  const empty = person("fl-legislature:empty", "No recorded office", []);
  const elsewhere = person("fl-legislature:elsewhere", "Elsewhere", []);
  const senator = person("congress:Z000001", "Senator", ["Z000001"]);
  const other = person("congress:Z000002", "Other senator", ["Z000002"]);
  const office = {address:"1 Main St",city:"Tallahassee",state:"FL",zip:"32399",phone:"850-555-0101",lat:30,lng:-84};
  const curated: MemberOfficeRecord = {id:"office:fl-legislature:member",kind:"MEMBER_OFFICE",officeholderId:known.id,officeKind:"CAPITOL",
    office,sourceUrl:"https://www.myfloridahouse.gov/member",sourceOrg:"Florida House",official:true,collectedAt:AT};
  const federal = {...packageFor([senator,other],[]).federal!,directory:{source:{sha:"held",sourceOrg:"Held directory",collectedAt:AT},
    byMember:{Z000001:{districtOffices:[office],committees:[]},Z000002:{districtOffices:[],committees:[]}},committees:{}}} as unknown as FederalDirectoryReadModel;
  const result=zipMemberDirectories(roster([known,empty,elsewhere]),[curated],federal,[known,empty,senator]);
  assert.equal(result.length,3);
  assert.deepEqual(result.find(row=>row.ids.includes(known.id))?.directory.districtOffices,[office]);
  assert.deepEqual(result.find(row=>row.ids.includes(empty.id))?.directory.districtOffices,[]);
  assert.deepEqual(result.find(row=>row.ids.includes(senator.id))?.directory.districtOffices,[office]);
  assert.ok(result.every(row=>!row.ids.includes(elsewhere.id)&&!row.ids.includes(other.id)));
  assert.equal(result.find(row=>row.ids.includes(known.id))?.directory.officeDetails?.[0].sourceUrl,curated.sourceUrl);
});
