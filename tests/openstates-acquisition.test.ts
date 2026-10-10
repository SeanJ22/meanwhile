import assert from "node:assert/strict";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL, PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { normalize, yamlToPeople, pluralRosterIssue } from "../lib/sources/plural/index.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { collectNationalPlaceSources } from "../lib/sources/plural/place.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { keyRefFor } from "../lib/doors/seed-feeds.ts";
import { publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { refreshMemberOfficesFromPromoted, currentMemberOffices, readMemberOffices } from "../lib/officials/member-offices-read.ts";
import { indexByDivision, seatHolderForMembership } from "../lib/officials/lookup.ts";
import { heldOfficialStateLegislatorsFromRead } from "../lib/state-rollcalls/legislators.ts";

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
  const published = await publishStatePeople({ store: canonical, ...az, now: at });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
  const read = await readStatePeopleProjection("US-AZ", { store: canonical, now: at, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.ok(read.value.roster.officeholders.some(row=>row.personId === "plural:one"));
  assert.equal((await readMemberOffices("plural:az:one", undefined, {store:canonical,now:at,bypassCache:true})).length, 2,
    "native office contacts reach the scoped reader immediately with the core people projection");
  const offices = await publishMemberOffices({ store: canonical, now: at, jurisdictions: ["US-AZ"] });
  assert.ok(offices.outcome?.promoted, JSON.stringify(offices));
  await refreshMemberOfficesFromPromoted({ store: canonical, now: at, bypassCache: true });
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
  const checkedPublication = await publishStatePeople({store:canonical,...checked,now});
  assert.ok(checkedPublication.outcome.confirmed || checkedPublication.outcome.promoted,
    JSON.stringify(checkedPublication.outcome.candidate.receipt));
  const clock = () => canonical.clock("plural-openstates", "STATE_LEGISLATOR", "US-AZ:openstates-people:v1");
  assert.equal((await clock()).lastSucceededObservedAt, now);
  const checkedAt = now;
  now = "2026-10-03T01:00:00.000Z";
  const replayed = await acquire("az");
  const replayedPublication = await publishStatePeople({store:canonical,...replayed,now});
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
  assert.ok((await publishStatePeople({ store: canonical, ...result, now: at })).outcome.promoted);
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
  const canonical=new MemoryRoutineDataStore(),publication=await publishStatePeople({store:canonical,...result,now:at});
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
  await publishStatePeople({store:canonical,...result,now:at});
  const read=await readStatePeopleProjection("US-AZ",{store:canonical,now:at,bypassCache:true});
  assert.equal(read.kind,"PROMOTED"); if(read.kind!=="PROMOTED")return;
  const held=heldOfficialStateLegislatorsFromRead("US-AZ",read),link=held.divisions.find(row=>row.ocdId.endsWith("/place:mesa"))!;
  assert.equal(seatHolderForMembership(held.seats[0],link.membershipId)?.officeTitle,"Mayor");
  const ended=await acquire("2026-09-01");
  await publishStatePeople({store:canonical,...ended,now:at});
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
