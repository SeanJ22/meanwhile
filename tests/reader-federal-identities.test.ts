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
import { indexByDivision, type SeatHolder } from "../lib/officials/lookup.ts";
import type { MemberOfficeRecord } from "../lib/officials/member-offices.ts";
import { civicDataReadNotInitialized } from "../lib/civic-data/read-model.ts";
import { heldPersonSources } from "../lib/officials/held-sources.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { primeStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";

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

test("the held Deborah Ross federal membership joins both NC-2 sources without losing the portrait, terms or aliases", () => {
  const root = "ocd-division/country:us/state:nc", district = `${root}/cd:2`;
  const canonical: Officeholder = { ...person("congress:R000305", "Deborah K. Ross", ["R000305"],
    "https://raw.githubusercontent.com/unitedstates/congress-legislators/d5af3d2d2490f8c6532c9490b1f47a76cacca699/legislators-current.yaml",
    "2026-10-09T21:09:30.926Z"), state: "NC", chamber: "house", officeTitle: "U.S. Representative",
    termStart: "2025-01-03", termEnd: "2027-01-03", birthDate: "1963-06-20", websiteUrl: "https://ross.house.gov",
    social: [{ platform: "x", url: "https://x.com/RepDeborahRoss", accountKind: "OFFICIAL", sourceUrl: "https://github.com/unitedstates/congress-legislators", collectedAt: AT }],
    photo: { url: "/api/portraits/officials/a27aceb4708ac5b2102f2fdd9a6e0a321e061bdfd5dd5bb5896d874c6770ff81.webp",
      sourceUrl: "https://www.congress.gov/img/member/r000305_200.jpg", collectedAt: "2026-10-11T22:20:37.981Z",
      attribution: "Portrait: https://api.congress.gov/v3/member/R000305?format=json", license: null } };
  canonical.memberships = ["2021", "2023", "2025"].map(year => ({ id: `${canonical.id}:rep:NC:2:${year}-01-03`,
    personId: canonical.id, officeId: "US:rep:NC:2", jurisdiction: "US", chamber: "rep", district: "2",
    termStart: `${year}-01-03`, termEnd: `${Number(year) + 2}-01-03`, sourceUrl: canonical.provenance.sourceUrl! }));
  const api: Officeholder = { ...person("congress-api:nc:R000305", canonical.name, ["R000305"],
    "https://api.congress.gov/v3/member/R000305?format=json", "2026-10-14T21:52:11.806Z"),
    personId: "congress-api:R000305", state: "NC", chamber: "house", officeTitle: "Representative", termEnd: "",
    phone: "(202) 225-3032", nativeIds: { bioguide: ["R000305"], reader: ["congress-api:nc:R000305", "congress-api:R000305"] } };
  api.memberships = [{ id: "congress-api:nc:R000305:house:2:2025", personId: api.personId!,
    officeId: "congress-office:NC:us_representative:2", jurisdiction: "US-NC", level: "FEDERAL", chamber: "house", current: true,
    divisionId: district, officeTitle: "Representative", district: "2", termStart: "2025", sourceUrl: api.provenance.sourceUrl! }];
  const federalRoster = { ...roster([canonical]), scope: "NC",
    divisions: [{ officeholderId: canonical.id, ocdId: district, bodyId: null }] };
  const sourceRoster = { ...roster([api]), scope: "NC", divisions: [{ officeholderId: api.id, ocdId: district,
    membershipId: api.memberships![0].id, bodyId: null }] };
  const state = packageFor([], []);
  const value = { ...state, state: "NC", federal: { ...state.federal!, roster: federalRoster }, people: sourceRoster, legislativePeople: sourceRoster,
    registry: { ...state.registry, registry: { ...state.registry.registry,
      divisions: [{ ...state.registry.registry.divisions[0], ocdId: district, label: "NC-2", divisionType: "cd", tier: "national" as const }] } } };
  const inputs = structuredClone([canonical, api]);
  const coverage = stateCoverage(value, [district], 35.77, -78.64);
  const representatives = coverage.seats.find(seat => seat.ocdId === district)!.representatives;
  assert.equal(representatives.length, 1);
  const holder = representatives[0];
  assert.equal(holder.id, canonical.id);
  assert.equal(holder.officeTitle, canonical.officeTitle);
  assert.deepEqual(holder.fieldSources?.officeTitle, canonical.provenance);
  assert.equal(holder.photoUrl, canonical.photo!.url);
  assert.equal(holder.fieldSources?.photoUrl?.sourceUrl, canonical.photo!.sourceUrl);
  assert.equal(holder.fieldSources?.portraitImage?.sourceUrl, canonical.photo!.sourceUrl);
  assert.equal(holder.birthDate, canonical.birthDate);
  assert.deepEqual(holder.fieldSources?.birthDate, canonical.provenance);
  assert.equal(holder.termStart, canonical.termStart);
  assert.deepEqual(holder.fieldSources?.termStart, canonical.provenance);
  assert.equal(holder.termEnd, canonical.termEnd);
  assert.deepEqual(holder.fieldSources?.termEnd, canonical.provenance);
  assert.equal(holder.phone, api.phone);
  assert.equal(holder.fieldSources?.phone?.sourceUrl, api.provenance.sourceUrl);
  assert.equal(holder.provenance?.sourceUrl, api.provenance.sourceUrl);
  assert.deepEqual(holder.social, canonical.social);
  assert.deepEqual(holder.memberships?.map(row => row.id).sort(), [...canonical.memberships!, ...api.memberships!].map(row => row.id).sort());
  for (const key of [canonical.id, api.id, api.personId!]) assert.ok(personIdentityKeys(holder).has(key), key);
  assert.deepEqual([canonical, api], inputs, "composition does not rewrite the held source records");

  const primary = indexByDivision([federalRoster]).get(district)![0], additional = indexByDivision([sourceRoster]).get(district)![0];
  const [reversed] = scopedHolders([additional], [primary]);
  assert.equal(reversed.officeTitle, canonical.officeTitle);
  assert.deepEqual(reversed.fieldSources?.officeTitle, canonical.provenance);
  assert.equal(reversed.photoUrl, canonical.photo!.url);
  assert.deepEqual(reversed.fieldSources?.photoUrl, primary.fieldSources?.photoUrl);
  assert.deepEqual(reversed.fieldSources?.portraitImage, primary.fieldSources?.portraitImage);
  assert.deepEqual(reversed.social, canonical.social);
  assert.equal(reversed.termStart, canonical.termStart);
  assert.deepEqual(reversed.fieldSources?.termStart, canonical.provenance);
  assert.deepEqual(reversed.memberships?.map(row => row.id).sort(), holder.memberships?.map(row => row.id).sort());
  for (const key of [canonical.id, api.id, api.personId!]) assert.ok(personIdentityKeys(reversed).has(key), key);
  for (const explicitStateTitle of ["State Representative", "State Senator"]) {
    assert.equal(scopedHolders([primary], [{ ...additional, officeTitle: explicitStateTitle }]).length, 2,
      "even a shared native alias and membership cannot turn an explicit state office into the federal office");
  }
  for (const invalid of [
    { ...additional, nativeIds: undefined },
    { ...additional, officeJurisdictionOcdId: `${root}/cd:3` },
    { ...additional, memberships: additional.memberships!.map(row => ({ ...row, current: false })) },
    { ...additional, memberships: additional.memberships!.map(row => ({ ...row, level: "STATE" as const })) },
    { ...additional, memberships: additional.memberships!.map(row => ({ ...row, chamber: "senate" })) },
  ]) assert.equal(scopedHolders([primary], [invalid]).length, 2, "the native id, division and current federal role are all required");
});

test("a bare Senator title uses only its selected current federal Senate membership", () => {
  for (const [canonicalName, apiName] of [["Zed Reader", "Aaron Reader"], ["Aaron Reader", "Zed Reader"]]) {
    const canonical = person("congress:Z000001", canonicalName, ["Z000001"]);
    const api: Officeholder = { ...person("congress-api:fl:Z000001", apiName, ["Z000001"], "https://www.congress.gov/member/fixture"),
      officeTitle: "Senator", memberships: [{ id: "api:senate:current", personId: "congress-api:fl:Z000001", officeId: "us-senate:FL",
        jurisdiction: "US-FL", level: "FEDERAL", chamber: "senate", current: true, divisionId: ROOT,
        officeTitle: "Senator", sourceUrl: "https://www.senate.gov/member" }] };
    const sources = roster([api]);
    sources.divisions[0].membershipId = api.memberships![0].id;
    const value = packageFor([canonical], [api]);
    const coverage = stateCoverage({ ...value, people: sources, legislativePeople: sources }, [ROOT], 25, -80);
    assert.equal(coverage.senators.length, 1);
    assert.equal(coverage.senators[0].id, canonical.id);
    assert.equal(coverage.senators[0].officeTitle, canonical.officeTitle);
    assert.deepEqual(coverage.senators[0].fieldSources?.officeTitle, canonical.provenance);
    assert.equal(coverage.senators[0].memberships?.[0].officeTitle, api.officeTitle, "the publisher's raw role title stays held");
    assert.ok(personIdentityKeys(coverage.senators[0]).has(api.id));
  }
});

test("compatible held ISO date precision survives either source order with its own field source", () => {
  for (const field of ["termStart", "termEnd", "birthDate"] as const) {
    for (const [short, full] of [["2025", "2025-01"], ["2025", "2025-01-03"], ["2025-01", "2025-01-03"]]) {
      const precise = { ...person("congress:Z000001", "Date Reader", ["Z000001"],
        "https://raw.githubusercontent.com/unitedstates/congress-legislators/held.yaml"), [field]: full };
      const coarse = { ...person("congress-api:fl:Z000001", precise.name, ["Z000001"],
        "https://api.congress.gov/v3/member/Z000001?format=json", "2026-10-14T00:00:00Z"), [field]: short };
      const [preciseHolder, coarseHolder] = indexByDivision([roster([precise, coarse])]).get(ROOT)!;
      for (const [first, second] of [[preciseHolder, coarseHolder], [coarseHolder, preciseHolder]]) {
        const result = scopedHolders([first], [second]);
        assert.equal(result.length, 1);
        assert.equal(result[0][field], full, `${field}: ${short} / ${full}`);
        assert.deepEqual(result[0].fieldSources?.[field], precise.provenance);
      }
    }
  }
});

test("different held ISO dates retain normal source precedence even when the older date has more detail", () => {
  for (const field of ["termStart", "termEnd", "birthDate"] as const) {
    for (const [older, newer] of [["2023-01-03", "2025"], ["2025-01-03", "2025-02"], ["2025-01-03", "2025-01-04"]]) {
      const prior = { ...person("congress:Z000001", "Date Reader", ["Z000001"],
        "https://raw.githubusercontent.com/unitedstates/congress-legislators/held.yaml"), [field]: older };
      const current = { ...person("congress-api:fl:Z000001", prior.name, ["Z000001"],
        "https://api.congress.gov/v3/member/Z000001?format=json", "2026-10-14T00:00:00Z"), [field]: newer };
      const [priorHolder, currentHolder] = indexByDivision([roster([prior, current])]).get(ROOT)!;
      for (const [first, second] of [[priorHolder, currentHolder], [currentHolder, priorHolder]]) {
        const result = scopedHolders([first], [second]);
        assert.equal(result.length, 1);
        assert.equal(result[0][field], newer, `${field}: ${older} / ${newer}`);
        assert.deepEqual(result[0].fieldSources?.[field], current.provenance);
      }
    }
  }
});

test("absent incoming dates and contacts keep the source that actually supplied each retained field in both orders", () => {
  const contacts = { sourceUrl: "https://www.senate.gov/fixture-contact-page", sourceOrg: "Controlled official contact fixture",
    collectedAt: AT, verifiedAt: AT };
  const canonical: Officeholder = { ...person("congress:Z000001", "Source Reader", ["Z000001"],
    "https://raw.githubusercontent.com/unitedstates/congress-legislators/held.yaml"),
    termEnd: "2027-01-03", birthDate: "1966-08-20", email: "fixture@senate.gov", contactFormUrl: "https://www.senate.gov/fixture-contact-form",
    fieldSources: { phone: contacts, email: contacts, contactFormUrl: contacts } };
  const api: Officeholder = { ...person("congress-api:fl:Z000001", canonical.name, ["Z000001"],
    "https://api.congress.gov/v3/member/Z000001?format=json", "2026-10-14T00:00:00Z"),
    termEnd: "", birthDate: null, phone: null, email: "", contactFormUrl: null, websiteUrl: "" };
  const [canonicalHolder, apiHolder] = indexByDivision([roster([canonical, api])]).get(ROOT)!;
  const snapshots = structuredClone([canonicalHolder, apiHolder]);
  for (const [first, second] of [[canonicalHolder, apiHolder], [apiHolder, canonicalHolder]]) {
    const [merged] = scopedHolders([first], [second]);
    assert.deepEqual(merged.provenance, api.provenance, "the overall record can advance independently of a retained field");
    for (const field of ["termEnd", "birthDate", "phone", "email", "contactFormUrl", "websiteUrl"] as const) {
      assert.equal(merged[field], canonical[field], field);
      assert.deepEqual(merged.fieldSources?.[field], canonical.fieldSources?.[field] ?? canonical.provenance, field);
    }
  }
  const updated = { ...apiHolder, phone: "202-555-0199", fieldSources: { phone: api.provenance } };
  for (const [first, second] of [[canonicalHolder, updated], [updated, canonicalHolder]]) {
    const [merged] = scopedHolders([first], [second]);
    assert.equal(merged.phone, updated.phone);
    assert.deepEqual(merged.fieldSources?.phone, api.provenance, "a winning incoming contact updates its value and source together");
  }
  assert.deepEqual([canonicalHolder, apiHolder], snapshots, "source pinning never changes either held input record");
});

test("both held portraits and their exact image sources stay accessible through repeated merges in either order", () => {
  const oldImage = "https://www.senate.gov/fixture-first-portrait.jpg", newImage = "https://office.example.gov/fixture-second-portrait.jpg";
  const prior: Officeholder = { ...person("congress:Z000001", "Portrait Reader", ["Z000001"]),
    photo: { url: "/api/portraits/officials/fixture-first.webp", sourceUrl: oldImage, attribution: "Controlled first portrait fixture", collectedAt: AT, license: null } };
  const current: Officeholder = { ...person("congress-api:fl:Z000001", prior.name, ["Z000001"],
    "https://office.example.gov/member", "2026-10-14T00:00:00Z"),
    photo: { url: "/api/portraits/officials/fixture-second.webp", sourceUrl: newImage, attribution: "Controlled second portrait fixture", collectedAt: "2026-10-14T00:00:00Z", license: null } };
  const originals = indexByDivision([roster([prior, current])]).get(ROOT)!;
  const snapshots = structuredClone(originals);
  for (const [first, second] of [originals, [...originals].reverse()]) {
    const initial = scopedHolders([first], [second]);
    assert.equal(initial.length, 1);
    let merged = initial[0];
    for (let repeat = 0; repeat < 3; repeat++) {
      const sources = heldPersonSources(merged);
      assert.deepEqual(sources, [first, second]);
      assert.equal(sources[0], first, "the original source record is retained");
      assert.equal(sources[1], second, "a merged copy is never stored as another source record");
      assert.ok(sources.every(source => source.sourceHolders === undefined), "source records stay flat");
      assert.deepEqual(new Set(sources.map(source => source.photoUrl)), new Set([prior.photo!.url, current.photo!.url]));
      assert.deepEqual(new Set(sources.map(source => source.fieldSources?.portraitImage.sourceUrl)), new Set([oldImage, newImage]));
      const cardSources = personCardSources(merged).flatMap(source => source.details ?? [source]);
      for (const image of [oldImage, newImage]) assert.ok(cardSources.some(source => source.provenance.sourceUrl === image && source.what.includes("Portrait image")), image);
      const again = scopedHolders([merged], [first, second, merged]);
      assert.equal(again.length, 1);
      merged = again[0];
    }
  }
  assert.deepEqual(originals, snapshots, "retaining the source records never changes their held fields");
  const state=packageFor([], [prior,current]);
  withReaderAuthorityEdge({},()=>withRegistryRuntimeProjection(state.registry,["FL"],()=>{
    primeStatePeopleProjection({formatVersion:1,sourceId:"held people",jurisdiction:"US-FL",term:"2026",generatedAt:AT,roster:state.people!});
    const shared=indexByDivision([state.people!]).get(ROOT)!;
    assert.ok(shared.every(holder=>holder.photoUrl === current.photo!.url),"every card uses the person's selected photo");
    const merged=scopedHolders([shared[0]],[shared[1]])[0];
    const sources=personCardSources(merged).flatMap(source=>source.details ?? [source]);
    for(const image of [oldImage,newImage])assert.ok(sources.some(source=>source.provenance.sourceUrl === image && source.what.includes("Portrait image")),image);
    assert.ok(sources.some(source=>source.provenance.sourceUrl === oldImage && source.provenance.sourceOrg.includes(prior.photo!.attribution!)));
  }));
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
