import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL, PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { normalize, yamlToPeople, pluralRosterIssue } from "../lib/sources/plural/index.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { holdRawCapture, type RawCaptureRef } from "../lib/civic-data/raw-capture-vault.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { collectNationalPlaceSources } from "../lib/sources/plural/place.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { capturedText, publishStatePeople, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { keyRefFor } from "../lib/doors/seed-feeds.ts";
import { publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { refreshMemberOfficesFromPromoted, currentMemberOffices, readMemberOffices } from "../lib/officials/member-offices-read.ts";
import { indexByDivision, indexByOfficeholderId, seatHolderForMembership } from "../lib/officials/lookup.ts";
import { heldOfficialStateLegislatorsFromRead } from "../lib/state-rollcalls/legislators.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { candidateChangeSet, canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "../lib/civic-data/types.ts";
import { statePeopleRetirementSourceCheck } from "../lib/sources/plural/retirement.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";

const vault = new MemoryEvidenceStore();

const sha = "a".repeat(40), at = "2026-10-01T00:00:00.000Z";
const yaml = (id: string, name: string) => `id: ocd-person/${id}
name: ${name}
email: member@legislature.example.gov
image: https://legislature.example.gov/portraits/${id}.jpg
party:
  - name: Independent
roles:
  - type: lower
    district: '3'
    start_date: '2023-01-01'
    end_date: '2024-12-31'
  - type: upper
    district: '7'
    start_date: '2025-01-01'
  - type: mayor
    district: City
    end_date: '2020-01-01'
offices:
  - classification: capitol
    address: 'Room 1, State Capitol'
    voice: '555-1000'
  - classification: district
    address: '100 Main St.'
    voice: '555-2000'
links:
  - url: https://legislature.example.gov/members/${id}
other_identifiers:
  - scheme: legacy_openstates
    identifier: '${id}'
`;
test("two states use one validated archive and keep complete native identity, contacts, terms and extraction origin", async () => {
  const archive = zip([
    { name: `people-${sha}/data/az/legislature/One.yml`, data: Buffer.from(yaml("one", "Member One")) },
    { name: `people-${sha}/data/nh/legislature/Two.yml`, data: Buffer.from(yaml("two", "Member Two")) },
    { name: `people-${sha}/data/az/executive/Governor.yml`, data: Buffer.from("id: ocd-person/governor\nname: Source Governor\nroles:\n  - type: governor\n    jurisdiction: ocd-jurisdiction/country:us/state:az/government\n    start_date: '2025-01-01'\n") },
  ], "2026-10-01");
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), requests: string[] = [];
  let now = at;
  const fetchImpl = (async (url, init) => { requests.push(String(url)); return String(url) === PLURAL_REVISION_URL
    ? new Headers(init?.headers).has("if-none-match") ? new Response(null, {status:304})
      : new Response(JSON.stringify([{ sha }]), { headers: { etag: "revision" } }) : new Response(archive); }) as typeof fetch;
  const acquire = (state: string) => acquireStatePeople({ state, store, locks, fetchImpl, now: () => now,
    signal: AbortSignal.timeout(10_000), divisions: [] });
  const [az, nh] = await Promise.all([acquire("az"), acquire("nh")]);
  assert.equal(requests.length, 2); assert.equal(az.roster.officeholders.length, 2); assert.equal(nh.roster.officeholders.length, 1);
  const person = az.roster.officeholders.find(row=>row.personId === "plural:one")!;
  assert.equal(person.id, "plural:az:one"); assert.equal(person.personId, "plural:one");
  assert.equal(person.nativeIds?.legacy_openstates[0], "one"); assert.equal(person.termStart, "2025-01-01");
  assert.equal(person.memberships?.length, 2); assert.equal(person.offices?.length, 2); assert.equal(person.email, "member@legislature.example.gov");
  assert.equal(az.roster.currentMembershipComplete, true, "completeness follows parsed native source members, without a seat-count threshold");
  assert.equal(person.photo, null); assert.match(person.portraitCandidate?.imageUrl ?? "", /one\.jpg$/);
  assert.deepEqual(az.roster.divisions.map(row=>row.ocdId), ["ocd-division/country:us/state:az"]);
  assert.equal(az.roster.officeholders.find(row=>row.personId === "plural:governor")?.officeTitle, "Governor");
  assert.equal(az.roster.unmatched.length, 1, "missing legislative maps cannot withhold a sourced person or the exact statewide role");
  assert.equal(az.acquisitions.length, 2); assert.match(az.acquisitions[0].requestedUrl, /^https:\/\/codeload\.github\.com/);
  assert.equal(az.acquisitions[0].extractedFrom?.sha256, az.acquisitions[0].rawHash);
  assert.deepEqual(az.gaps, []);
  await acquire("az"); assert.equal(requests.length, 2, "reader/member-office consumers reuse the same release");
  const canonical = new MemoryRoutineDataStore();
  const published = await publishStatePeople({ vault, store: canonical, ...az, now: at });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
  const read = await readStatePeopleProjection("US-AZ", { store: canonical, now: at, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.ok(read.value.roster.officeholders.some(row=>row.personId === "plural:one"));
  assert.equal((await readMemberOffices("plural:az:one", undefined, {store:canonical,now:at,bypassCache:true})).length, 2,
    "native office contacts reach the scoped reader immediately with the core people projection");
  const offices = await publishMemberOffices({ store: canonical, now: at, state: "AZ" });
  assert.ok(offices.outcome?.promoted, JSON.stringify(offices));
  await refreshMemberOfficesFromPromoted({ state: "AZ", store: canonical, now: at, bypassCache: true });
  const shown = currentMemberOffices("plural:az:one");
  assert.equal(shown.length, 2); assert.equal(shown[0].office.phone, "555-1000");
  assert.equal(shown[0].collectedAt, at); assert.match(shown[0].sourceUrl, /raw\.githubusercontent\.com\/openstates\/people/);
  assert.equal(requests.length, 2, "office derivation makes no second source request");
  now = "2026-10-03T00:00:00.000Z";
  const checked = await acquire("az");
  assert.equal(requests.length, 3, "the next check reads the revision while reusing the pinned archive");
  assert.equal(checked.acquisitions[0].retrievedAt, at);
  assert.equal(checked.acquisitions[0].sourceCheck?.httpStatus, 304);
  assert.equal(checked.acquisitions[0].sourceCheck?.checkedAt, now);
  const checkedPublication = await publishStatePeople({ vault, store:canonical,...checked,now});
  assert.ok(checkedPublication.outcome.confirmed || checkedPublication.outcome.promoted,
    JSON.stringify(checkedPublication.outcome.candidate.receipt));
  const clock = () => canonical.clock("plural-openstates", "STATE_LEGISLATOR", "US-AZ:openstates-people:v1");
  assert.equal((await clock()).lastSucceededObservedAt, now);
  const checkedAt = now;
  now = "2026-10-03T01:00:00.000Z";
  const replayed = await acquire("az");
  const replayedPublication = await publishStatePeople({ vault, store:canonical,...replayed,now});
  assert.ok(replayedPublication.outcome.confirmed, "identical source replay confirms existing facts without a new version");
  const replayedRead = await readStatePeopleProjection("US-AZ", {store:canonical,now,bypassCache:true});
  assert.equal(replayedRead.kind, "PROMOTED");
  if (replayedRead.kind === "PROMOTED") assert.equal(replayedRead.value.roster.unmatched.length, 1,
    "unchanged geographic gaps do not accumulate on every source replay");
  assert.equal(requests.length, 3); assert.equal((await clock()).lastSucceededObservedAt, checkedAt,
    "replaying held source bytes cannot manufacture a newer publisher check");
});
test("native role dates select the current legislative membership without mayor or future-role guessing", () => {
  const text = yaml("same", "Changed Name");
  const [person] = yamlToPeople(text, "az", "https://raw.githubusercontent.com/openstates/people/pinned/one.yml", at);
  const roster = normalize([person], new Map([["az|upper|7", "ocd-division/country:us/state:az/sldu:7"]]), at, "US-AZ");
  assert.equal(roster.officeholders[0].chamber, "upper"); assert.equal(roster.divisions.length, 1);
  assert.equal(yamlToPeople(text, "az", person.sourceUrl!, "2022-01-01T00:00:00.000Z").length, 0);
  const invalidRoleGaps:string[]=[];
  assert.equal(yamlToPeople(text.replace("2025-01-01", "2025-02-30"), "az", person.sourceUrl!, at, detail=>invalidRoleGaps.push(detail)).length,0);
  assert.ok(invalidRoleGaps.some(detail=>detail.startsWith("PLURAL_ROLE_DATE_INVALID:person=ocd-person/same:role=1")));
  const independent = yamlToPeople(text.replace("2025-01-01", "2025-02-30").replace("2024-12-31","2027-12-31"), "az", person.sourceUrl!, at, detail=>invalidRoleGaps.push(detail));
  assert.equal(normalize(independent,new Map(),at,"US-AZ").officeholders[0].officeTitle,"State Representative",
    "a malformed role cannot suppress the same person's independently valid current membership");
  const partialDates = yamlToPeople(text.replace("2025-01-01", "2025").replace("    start_date: '2025'", "    start_date: '2025'\n    end_date: '2026'"), "az", person.sourceUrl!, at);
  assert.equal(partialDates[0].current_chamber, "upper");
  assert.equal(partialDates[0].roles?.[1].end_date, "2026", "partial dates retain the publisher's precision");
  const concurrent = yamlToPeople(text.replace("end_date: '2024-12-31'", "end_date: '2027-12-31'"), "az", person.sourceUrl!, at);
  const multiple = normalize(concurrent, new Map([["az|upper|7", "ocd-division/country:us/state:az/sldu:7"],
    ["az|lower|3", "ocd-division/country:us/state:az/sldl:3"]]), at, "US-AZ");
  assert.equal(multiple.officeholders.length, 1); assert.equal(multiple.divisions.length, 2, "each current native membership keeps its exact division");
});
test("unread and unpublished Census slices publish a named gap alongside the sourced roster", async () => {
  const archive = zip([{ name: `people-${sha}/data/az/legislature/One.yml`, data: Buffer.from(yaml("one", "Member One")) }], "2026-10-01");
  for (const [kind, geographyQuery] of [["UNREAD", null], ["NOT_PUBLISHED", async () => [[], []]]] as const) {
    const { locks } = createMemoryRepositories();
    const result = await acquireStatePeople({ state: "az", store: new MemoryEvidenceStore(), locks, now: () => at,
      signal: AbortSignal.timeout(10_000), geographyQuery,
      fetchImpl: (async url => String(url) === PLURAL_REVISION_URL ? Response.json([{ sha }]) : new Response(archive)) as typeof fetch });
    assert.equal(result.roster.officeholders.length, 1);
    assert.ok(result.gaps.some(gap => gap.detail.startsWith(`CENSUS_GEOGRAPHY_${kind}:AZ:`)));
    const publication = await publishStatePeople({ vault, store: new MemoryRoutineDataStore(), ...result, now: at });
    assert.ok(publication.outcome.promoted, JSON.stringify(publication.outcome.candidate.receipt));
    assert.ok(publication.candidate.excludedFacts?.some(gap => gap.code === `CENSUS_GEOGRAPHY_${kind}`));
  }
});
test("Open States offices publish outside the official pilot rosters with their source attribution", async () => {
  const archive = zip([{ name: `people-${sha}/data/ca/legislature/One.yml`, data: Buffer.from(yaml("one", "Member One")) }], "2026-10-01");
  const { locks } = createMemoryRepositories();
  const acquired = await acquireStatePeople({ state: "ca", store: new MemoryEvidenceStore(), locks, now: () => at,
    signal: AbortSignal.timeout(10_000), divisions: [],
    fetchImpl: (async url => String(url) === PLURAL_REVISION_URL ? Response.json([{ sha }]) : new Response(archive)) as typeof fetch });
  const store = new MemoryRoutineDataStore();
  assert.ok((await publishStatePeople({ vault, store, ...acquired, now: at })).outcome.promoted);
  const publication = await publishMemberOffices({ store, now: at, state: "CA" });
  assert.ok(publication.outcome?.promoted, JSON.stringify(publication));
  assert.equal(publication.records, 2);
  await refreshMemberOfficesFromPromoted({ state: "CA", store, now: at, bypassCache: true });
  const offices = currentMemberOffices("plural:ca:one");
  assert.deepEqual(offices.map(row => row.office.phone), ["555-1000", "555-2000"]);
  assert.ok(offices.every(row => row.official === false && row.sourceOrg === "Open States (Plural, CC-0)"));
});
test("one malformed native record leaves verified people publishable without claiming a complete replacement", async () => {
  const archive = zip([
    { name: `people-${sha}/data/az/legislature/One.yml`, data: Buffer.from(yaml("one", "Member One")) },
    { name: `people-${sha}/data/az/legislature/Incomplete.yml`, data: Buffer.from("name: Missing Native Identity\nroles: []\n") },
  ], "2026-10-01");
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const fetchImpl = (async url => String(url) === PLURAL_REVISION_URL ? new Response(JSON.stringify([{ sha }])) : new Response(archive)) as typeof fetch;
  const result = await acquireStatePeople({ state: "az", store, locks, fetchImpl, now: () => at,
    signal: AbortSignal.timeout(10_000), divisions: [] });
  assert.equal(result.roster.officeholders.length, 1); assert.equal(result.roster.currentMembershipComplete, false);
  assert.equal(result.acquisitions.length, 2, "the unresolved original member remains attributable held evidence");
  assert.ok(result.gaps.some(gap => /IDENTITY_INVALID/.test(gap.detail)));
  const canonical = new MemoryRoutineDataStore();
  assert.ok((await publishStatePeople({ vault, store: canonical, ...result, now: at })).outcome.promoted);
});
test("known municipal roles preserve native identity, generic office contacts and precise durable gaps", async () => {
  const executive = (id:string,type:string,jurisdiction:string,extra="") => `id: ocd-person/${id}\nname: Person ${id}\nroles:\n  - type: ${type}\n    jurisdiction: ${jurisdiction}\n${extra}offices:\n  - name: City Hall\n    voice: '555-3000'\n    email: mayor@city.example.gov\nlinks:\n  - url: https://city.example.gov/mayor\n`;
  const archive = zip([
    {name:`people-${sha}/data/az/legislature/One.yml`,data:Buffer.from(yaml("one","Member One"))},
    {name:`people-${sha}/data/az/municipalities/Mayor.yml`,data:Buffer.from(executive("mayor","mayor","ocd-jurisdiction/country:us/state:az/place:mesa/government"))},
    {name:`people-${sha}/data/az/municipalities/Ward.yml`,data:Buffer.from(executive("ward","councilmember","ocd-jurisdiction/country:us/state:az/place:mesa/government","    district: '3'\n"))},
    {name:`people-${sha}/data/az/executive/Wrong.yml`,data:Buffer.from(executive("wrong","governor","ocd-jurisdiction/country:us/state:nh/government"))},
    {name:`people-${sha}/data/az/executive/Ended.yml`,data:Buffer.from(executive("ended","governor","ocd-jurisdiction/country:us/state:az/government","    end_date: '2025-01-01'\n"))},
    {name:`people-${sha}/data/az/executive/Unsupported.yml`,data:Buffer.from(executive("unknown","unrecognized_role","ocd-jurisdiction/country:us/state:az/government"))},
  ],"2026-10-01");
  const {locks}=createMemoryRepositories(),store=new MemoryEvidenceStore();
  const result=await acquireStatePeople({state:"az",store,locks,now:()=>at,signal:AbortSignal.timeout(10_000),divisions:[],
    fetchImpl:(async url=>String(url)===PLURAL_REVISION_URL ? new Response(JSON.stringify([{sha}])) : new Response(archive)) as typeof fetch});
  assert.deepEqual(result.roster.officeholders.map(row=>row.personId).sort(),["plural:mayor","plural:one","plural:ward"]);
  const mayor=result.roster.officeholders.find(row=>row.personId === "plural:mayor")!;
  assert.equal(mayor.level,"LOCAL"); assert.equal(mayor.phone,"555-3000"); assert.equal(mayor.email,"mayor@city.example.gov");
  assert.ok(result.roster.divisions.some(row=>row.officeholderId===mayor.id && row.ocdId==="ocd-division/country:us/state:az/place:mesa"));
  assert.ok(!result.roster.divisions.some(row=>row.officeholderId==="plural:az:ward"),"a ward member cannot represent the entire city");
  assert.ok(result.gaps.some(row=>row.detail.startsWith("PLURAL_ROLE_DISTRICT_DIVISION_UNRESOLVED")));
  assert.ok(result.gaps.some(row=>row.detail.startsWith("PLURAL_ROLE_WRONG_STATE")));
  assert.ok(result.gaps.some(row=>row.detail.startsWith("PLURAL_ROLE_UNSUPPORTED")));
  const canonical=new MemoryRoutineDataStore(),publication=await publishStatePeople({ vault, store:canonical,...result,now:at});
  assert.ok(publication.outcome.promoted,JSON.stringify(publication.outcome.candidate.receipt));
  const saved=await canonical.readCandidate(publication.candidate.id);
  assert.ok(saved?.candidate.excludedFacts?.some(row=>row.code === "PLURAL_ROLE_WRONG_STATE" && (row.record as {sourceUrl:string}).sourceUrl.endsWith("/Wrong.yml")));
  assert.equal((saved?.candidate.normalizedPayload as {gaps:unknown[]}).gaps.length,result.gaps.length);
});
test("the same native person in legislative and municipal files keeps both memberships and ends only the expired role", async () => {
  const mayor = (end?:string) => `id: ocd-person/one\nname: Member One\nroles:\n  - type: mayor\n    jurisdiction: ocd-jurisdiction/country:us/state:az/place:mesa/government\n    start_date: '2025-01-01'\n${end ? `    end_date: '${end}'\n` : ""}`;
  const archiveFor=(end?:string)=>zip([
    {name:`people-${sha}/data/az/legislature/One.yml`,data:Buffer.from(yaml("one","Member One"))},
    {name:`people-${sha}/data/az/municipalities/One.yml`,data:Buffer.from(mayor(end))},
  ],"2026-10-01");
  const acquire=async(end?:string)=>{
    const {locks}=createMemoryRepositories();
    return acquireStatePeople({state:"az",store:new MemoryEvidenceStore(),locks,now:()=>at,signal:AbortSignal.timeout(10_000),
      divisions:[{ocdId:"ocd-division/country:us/state:az/sldu:7",label:"State Senate District 7",divisionType:"sldu"}],
      fetchImpl:(async url=>String(url)===PLURAL_REVISION_URL ? new Response(JSON.stringify([{sha}])) : new Response(archiveFor(end))) as typeof fetch});
  };
  const result=await acquire(),canonical=new MemoryRoutineDataStore();
  assert.equal(result.roster.officeholders.length,1); assert.equal(result.roster.divisions.length,2);
  assert.equal(result.roster.officeholders[0].memberships?.filter(row=>row.current).length,2);
  assert.equal(indexByDivision([result.roster]).get("ocd-division/country:us/state:az/place:mesa")?.[0].officeTitle,"Mayor");
  await publishStatePeople({ vault, store:canonical,...result,now:at});
  const read=await readStatePeopleProjection("US-AZ",{store:canonical,now:at,bypassCache:true});
  assert.equal(read.kind,"PROMOTED"); if(read.kind!=="PROMOTED")return;
  const held=heldOfficialStateLegislatorsFromRead("US-AZ",read),link=held.divisions.find(row=>row.ocdId.endsWith("/place:mesa"))!;
  assert.equal(seatHolderForMembership(held.seats[0],link.membershipId)?.officeTitle,"Mayor");
  const ended=await acquire("2026-09-01");
  await publishStatePeople({ vault, store:canonical,...ended,now:at});
  const after=await readStatePeopleProjection("US-AZ",{store:canonical,now:at,bypassCache:true});
  assert.equal(after.kind,"PROMOTED"); if(after.kind!=="PROMOTED")return;
  assert.deepEqual(after.value.roster.divisions.map(row=>row.ocdId),["ocd-division/country:us/state:az/sldu:7"]);
  assert.equal(after.value.roster.officeholders.length,1,"ending the mayor tenure cannot remove the still-serving legislator");
  const endedHeld=heldOfficialStateLegislatorsFromRead("US-AZ",after);
  assert.equal(seatHolderForMembership(endedHeld.seats[0],link.membershipId),null,"an expired linked role cannot fall back to the person's other current office");
  assert.equal(endedHeld.seats[0].memberships?.find(row=>row.id===link.membershipId)?.termEnd,"2026-09-01");
  assert.equal(indexByDivision([{...after.value.roster,divisions:[...after.value.roster.divisions,{...link,bodyId:null}]}]).has(link.ocdId),false,
    "even a stale explicit division link cannot render a retired membership");
});
test("native tenure retirement survives the canonical office vocabulary with held source identifiers", async () => {
  const acquire = async (ended: boolean) => {
    const release = ended ? "b".repeat(40) : sha;
    const expired = yaml("expired", "Expired Member").replace("    start_date: '2025-01-01'", "    start_date: '2025-01-01'" + (ended ? "\n    end_date: '2026-09-01'" : ""));
    const archive = zip([
      { name: `people-${release}/data/az/legislature/Current.yml`, data: Buffer.from(yaml("current", "Current Member")) },
      { name: `people-${release}/data/az/legislature/Expired.yml`, data: Buffer.from(expired) },
      ...(ended ? [{ name: `people-${release}/data/az/legislature/Malformed.yml`, data: Buffer.from("name: Missing identity\n") }] : []),
    ], "2026-10-01");
    const { locks } = createMemoryRepositories();
    return acquireStatePeople({ state: "az", store: new MemoryEvidenceStore(), locks, now: () => at,
      signal: AbortSignal.timeout(10_000), divisions: [],
      fetchImpl: (async url => String(url) === PLURAL_REVISION_URL ? Response.json([{ sha: release }]) : new Response(archive)) as typeof fetch });
  };
  const store = new MemoryRoutineDataStore(), initial = await acquire(false);
  for (const person of initial.roster.officeholders) {
    person.memberships = person.memberships?.map(row => ({ ...row,
      officeId: `openstates-office:az:${row.chamber}:${row.district ?? ""}` }));
  }
  assert.ok((await publishStatePeople({ vault, store, ...initial, now: at })).outcome.promoted);
  const successor = await acquire(true);
  assert.equal(successor.roster.currentMembershipComplete, false);
  assert.ok(successor.roster.endedMemberships?.some(row => row.personId === "plural:expired" && row.officeId.includes(":state_senator:")));
  const publication = await publishStatePeople({ vault, store, ...successor, now: at });
  assert.ok(publication.outcome.promoted, JSON.stringify(publication.outcome.candidate.receipt));
  const read = await readStatePeopleProjection("US-AZ", { store, now: at, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.roster.officeholders.map(person => person.name), ["Current Member"]);
});
test("an explicitly ended final office retires during a partial refresh while malformed roles preserve held people", async () => {
  const municipal = (id:string,place:string,end?:string) => `id: ocd-person/${id}\nname: Mayor ${id}\nroles:\n  - type: mayor\n    jurisdiction: ocd-jurisdiction/country:us/state:az/place:${place}/government\n    start_date: '2025-01-01'\n${end ? `    end_date: '${end}'\n` : ""}`;
  const acquire = async (stage:0|1|2) => {
    const release=[sha,"b".repeat(40),"c".repeat(40)][stage];
    const archive=zip([
      {name:`people-${release}/data/az/legislature/One.yml`,data:Buffer.from(yaml("one","Member One"))},
      {name:`people-${release}/data/az/municipalities/Ended.yml`,data:Buffer.from(municipal("ended","mesa",stage===1 ? "2026-02-30" : stage===2 ? "2026-09-01" : undefined))},
      {name:`people-${release}/data/az/municipalities/Malformed.yml`,data:Buffer.from(municipal("malformed","tempe",stage ? "2026-02-30" : undefined))},
      {name:`people-${release}/data/az/municipalities/WrongJurisdiction.yml`,data:Buffer.from(stage
        ? municipal("wrong-jurisdiction","phoenix","2026-09-01").replace("state:az","state:nh")
        : municipal("wrong-jurisdiction","phoenix"))},
    ],"2026-10-01");
    const {locks}=createMemoryRepositories();
    return acquireStatePeople({state:"az",store:new MemoryEvidenceStore(),locks,now:()=>at,signal:AbortSignal.timeout(10_000),
      divisions:stage ? [{ocdId:"ocd-division/country:us/state:az/sldu:7",label:"AZ State Senate District 7 (2024 plan)",divisionType:"sldu"}] : [],
      fetchImpl:(async url=>String(url)===PLURAL_REVISION_URL ? new Response(JSON.stringify([{sha:release}])) : new Response(archive)) as typeof fetch});
  };
  const canonical=new MemoryRoutineDataStore(),initial=await acquire(0);
  const initialPublication=await publishStatePeople({ vault, store:canonical,...initial,now:at});
  assert.ok(initialPublication.outcome.promoted);
  const endedId=initial.roster.officeholders.find(row=>row.personId === "plural:ended")!.memberships![0].id;
  const malformed=await acquire(1),malformedPublication=await publishStatePeople({ vault, store:canonical,...malformed,now:at});
  assert.ok(malformedPublication.outcome.promoted);
  const held=(malformedPublication.candidate.normalizedPayload as {captures:StatePeopleCapture[]}).captures.filter(row=>row.requestedUrl.endsWith(sha));
  assert.ok((await Promise.all(held.map(row=>capturedText(vault,row)))).some(text=>text.includes("id: ocd-person/ended")),"partial refresh retains the original capture behind the still-serving prior tenure");
  const partial=await acquire(2);
  assert.equal(partial.roster.currentMembershipComplete,false);
  assert.ok(!partial.roster.officeholders.some(row=>row.personId === "plural:ended"));
  assert.equal(partial.roster.endedMemberships?.find(row=>row.id === endedId)?.termEnd,"2026-09-01",
    "explicit end evidence survives independently of the current people output");
  assert.ok(!partial.roster.endedMemberships?.some(row=>["plural:malformed","plural:wrong-jurisdiction"].includes(row.personId)),
    "an invalid date or a different native jurisdiction cannot invent retirement");
  assert.ok(partial.gaps.some(row=>row.detail.startsWith("PLURAL_ROLE_DATE_INVALID")));
  const publication=await publishStatePeople({ vault, store:canonical,...partial,now:at});
  assert.ok(publication.outcome.promoted,JSON.stringify(publication.outcome.candidate.receipt));
  assert.ok(publication.outcome.candidate.receipt?.checks.some(row=>row.code === "NATIVE_MEMBERSHIPS_EXPLICITLY_ENDED"));
  const read=await readStatePeopleProjection("US-AZ",{store:canonical,now:at,bypassCache:true});
  assert.equal(read.kind,"PROMOTED"); if(read.kind!=="PROMOTED")return;
  assert.equal(indexByOfficeholderId([read.value.roster]).has("plural:ended"),false);
  const divisions=indexByDivision([read.value.roster]);
  assert.equal(divisions.has("ocd-division/country:us/state:az/place:mesa"),false);
  assert.equal(divisions.get("ocd-division/country:us/state:az/place:tempe")?.[0].personId,"plural:malformed");
  assert.equal(divisions.get("ocd-division/country:us/state:az/place:phoenix")?.[0].personId,"plural:wrong-jurisdiction");
  assert.ok(read.value.roster.officeholders.some(row=>row.personId === "plural:one"));
  assert.ok(!read.value.roster.unmatched.some(row=>row.officeholderId === "plural:az:one"),
    "a partial refresh removes the carried no-division gap for a person now linked to Census");
  const history=read.value.roster.endedMemberships?.find(row=>row.id === endedId);
  assert.equal(history?.current,false); assert.equal(history?.termEnd,"2026-09-01");
  assert.match(history?.sourceUrl ?? "",/\/municipalities\/Ended\.yml$/);
  const texts=await Promise.all((publication.candidate.normalizedPayload as {captures:StatePeopleCapture[]}).captures.map(row=>capturedText(vault,row)));
  assert.ok(texts.some(text=>text.includes("id: ocd-person/ended") && text.includes("2026-09-01")));
  assert.ok(JSON.stringify(publication.candidate).length < 64 * 1024 && !JSON.stringify(publication.candidate.normalizedPayload).includes("ocd-person/ended"),
    "the candidate holds references; the native YAML stays in the vault");

  const hash=(value:unknown)=>createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");
  const reject=async (mutate:(candidate:RoutineCandidate,prior:CandidateVersionRecord)=>void,label:string,expected="NATIVE_MEMBERSHIP_END_SOURCE_UNPROVEN")=>{
    const candidate=structuredClone(publication.outcome.candidate.candidate),prior=structuredClone(malformedPublication.outcome.candidate);
    mutate(candidate,prior);
    const rebound={...candidate,normalization:{...candidate.normalization,
      normalizedHash:hash(candidate.readModel),normalizedPayloadHash:hash(candidate.normalizedPayload)},
      changeSet:candidateChangeSet(candidate,prior.candidate.readModel)};
    const sourceCheck=await statePeopleRetirementSourceCheck(rebound,prior,at,vault);
    const check=validateRoutineCandidate(rebound,prior,at,[sourceCheck]).receipt.checks.find(row=>row.check === "COMPLETENESS_HORIZON_VALIDITY");
    assert.equal(check?.code,expected,label);
  };
  const endedRows=(candidate:RoutineCandidate)=>[
    ...((candidate.readModel as {roster:{endedMemberships:{id:string;personId:string;officeId:string;termEnd:string}[]}}).roster.endedMemberships),
    ...((candidate.normalizedPayload as {endedMemberships:{id:string;personId:string;officeId:string;termEnd:string}[]}).endedMemberships),
  ].filter(row=>row.id === endedId);
  await reject(candidate=>{for(const row of endedRows(candidate))row.personId="plural:somebody-else";},"another native person cannot prove retirement");
  await reject(candidate=>{for(const row of endedRows(candidate))row.officeId="openstates-office:another-office";},"another office cannot prove this tenure ended");
  await reject(candidate=>{for(const row of endedRows(candidate))Object.assign(row,{officeTitle:"Governor"});},"another canonical office cannot prove this tenure ended");
  await reject(candidate=>{for(const row of endedRows(candidate))Object.assign(row,{district:"another district"});},"another district cannot prove this tenure ended");
  await reject(candidate=>{for(const row of endedRows(candidate))row.termEnd="2026-02-30";},"an invalid native date cannot prove retirement");
  await reject(candidate=>{for(const row of endedRows(candidate))row.termEnd="2027";},"a future end date cannot retire a current office");
  await reject(candidate=>{for(const row of endedRows(candidate))row.termEnd="2026-08-01";},"agreeing projections cannot forge a different past end from the captured YAML");
  await reject(candidate=>{(candidate.normalizedPayload as {captures:unknown[]}).captures=[];},"the new end must cite its captured native source");
  await reject((_candidate,prior)=>{(prior.candidate.normalizedPayload as {captures:unknown[]}).captures=[];},"the old active tenure must cite its held native source");
  await reject(candidate=>{(candidate.normalizedPayload as {endedMemberships:unknown[]}).endedMemberships=[];},"a reader-only end claim is not captured normalization evidence","INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");
  for (const replacement of ["", "    end_date: '2026-08-01'\n"]) {
    const unproved=structuredClone(publication.candidate);
    for (const row of (unproved.normalizedPayload as {captures:{capture:RawCaptureRef}[]}).captures) {
      const text=await capturedText(vault,row as StatePeopleCapture);
      if (text.includes("id: ocd-person/ended")) row.capture=await holdRawCapture(vault,"plural-openstates",text.replace("    end_date: '2026-09-01'\n",replacement),"text/plain");
    }
    const store=new MemoryRoutineDataStore();
    await publishStatePeople({ vault, store,...initial,now:at});
    const lastGood=await publishStatePeople({ vault, store,...malformed,now:at});
    const outcome=await processRegisteredRoutineCandidate(store,"openstates-people-az",{...unproved,
      normalization:{...unproved.normalization,normalizedPayloadHash:hash(unproved.normalizedPayload)}},at,undefined,{vault});
    assert.equal(outcome.promoted,null,"the real publication door reparses raw native evidence independently of agreeing projections");
    assert.equal(outcome.candidate.failureCode,"NATIVE_MEMBERSHIP_END_SOURCE_UNPROVEN");
    assert.equal((await store.readPromotion("STATE_LEGISLATOR","US-AZ:openstates-people:v1"))?.versionId,lastGood.candidate.id);
  }
});
test("reduced held reference and truncated CSV shapes cannot be mistaken for rich current exports", () => {
  assert.match(pluralRosterIssue("ocd_person_id,name,chamber,district\nocd-person/a,A,upper,1\n") ?? "", /missing id/);
  assert.match(pluralRosterIssue("id,name,current_chamber,current_district\nocd-person/a,A,upper\n") ?? "", /complete CSV header/);
  assert.throws(() => pluralRosterIssue('id,name,current_chamber,current_district\nocd-person/a,"truncated'), /TRUNCATED/);
});
test("every supported state has a standing source contract without Send admission and per-place acquisition has no duplicate roster download", async () => {
  assert.equal(PLURAL_STATES.length, 52);
  assert.equal(keyRefFor("openstates-people-az", "plural-openstates"), null);
  for (const state of PLURAL_STATES) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find(row => row.id === `openstates-people-${state}`);
    assert.equal(contract?.scope, `US-${state.toUpperCase()}:openstates-people:v1`);
    assert.deepEqual(contract?.acquisitionAdapter.command, ["scripts/openstates-people-refresh.mts", "--promote", `--state=${state}`]);
  }
  const reads: string[] = [];
  await collectNationalPlaceSources({ divisions: [{ id: "ocd-division/country:us/state:az", label: "Arizona", divisionType: "state", geoid: "04", sourceUrl: "https://census.gov" }],
    now: at, families: { officials: true, elections: false }, read: async url => { reads.push(url); throw new Error("NO_HELD_DIRECTORY"); } });
  assert.ok(reads.every(url => !url.includes("openstates") && !url.includes("codeload")));
});
