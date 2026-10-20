import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { acquirePeopleSource, normalizeOfficialLegislaturePage, normalizeWikidataPeople, type PeopleAcquisitionOptions } from "../lib/sources/people/acquisition.ts";
import { emptyPerson, emptyRoster, provenance } from "../lib/sources/people/common.ts";
import { readSourceApi } from "../lib/control-plane/scheduler/scout-api.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

const NOW="2026-10-12T12:00:00.000Z";
function options(sourceId:PeopleAcquisitionOptions["sourceId"],fetchImpl:typeof fetch,state="az"):PeopleAcquisitionOptions {
  return {sourceId,state,asOf:NOW,signal:new AbortController().signal,store:new MemoryEvidenceStore(),locks:createMemoryRepositories().locks,
    now:()=>NOW,acquire:acquireKnownRelease,fetchImpl,env:{LEGISCAN_API_KEY:"private-legiscan-key",CONGRESS_API_KEY:"private-congress-key",DATA_GOV_API_KEY:"private-govinfo-key"}};
}
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
function assertScoped(roster:OfficeholderSet,source:string,state="az"):void {
  const byId=new Map(roster.officeholders.map(holder=>[holder.id,holder]));
  for(const holder of roster.officeholders){assert.ok(holder.id.startsWith(`${source}:${state}:`));assert.ok(holder.personId);for(const membership of holder.memberships??[])assert.equal(membership.personId,holder.personId);}
  for(const division of roster.divisions)assert.ok(byId.has(division.officeholderId));
}

test("LegiScan acquires each current state session serially and retains shared IDs and missing boundary reasons",async()=>{
  const calls:string[]=[],stateBySession=new Map<number,string>(),active={count:0,max:0};
  const fetchImpl:typeof fetch=async(resource)=>{
    active.count++;active.max=Math.max(active.max,active.count);await new Promise<void>(resolve=>setTimeout(resolve,2));
    const parsed=new URL(String(resource));calls.push(parsed.href);active.count--;
    if(parsed.searchParams.get("op")==="getSessionList") {
      const state=parsed.searchParams.get("state")!,id=state==="AZ"?11:21;stateBySession.set(id,state);stateBySession.set(id+1,state);
      return json({status:"OK",sessions:[{session_id:id-1,year_start:2024,year_end:2024},{session_id:id,year_start:2025,year_end:2026},{session_id:id+1,year_start:2026,year_end:2026}]});
    }
    const id=Number(parsed.searchParams.get("id"));assert.ok(stateBySession.has(id));
    return json({status:"OK",sessionpeople:{session_id:id,people:[{people_id:stateBySession.get(id)==="AZ"?501:601,name:"Jane Doe",role:"Sen",role_id:2,district:"SD-1",party:"D",votesmart_id:123,ftm_eid:456,opensecrets_id:"N000001",ballotpedia:"Jane_Doe"}]}});
  };
  const [az,other]=await Promise.all([acquirePeopleSource(options("legiscan-api",fetchImpl)),acquirePeopleSource(options("legiscan-api",fetchImpl,"ny"))]);
  assert.equal(active.max,1);assert.equal(calls.length,6);assert.ok(calls.every(value=>value.includes("private-legiscan-key")));
  assert.equal(az.roster.officeholders.length,1);assert.equal(other.coverage.legislators,1);assert.equal(az.acquisitions.length,3);
  assertScoped(az.roster,"legiscan");assertScoped(other.roster,"legiscan","ny");assert.equal(az.roster.officeholders[0].personId,"legiscan:501");
  const holder=az.roster.officeholders[0];assert.deepEqual(holder.nativeIds?.votesmart,["123"]);assert.deepEqual(holder.nativeIds?.followthemoney,["456"]);
  assert.equal(holder.fieldSources?.name.sourceOrg,"LegiScan (CC BY 4.0)");assert.ok(az.roster.unmatched.some(row=>row.reason.startsWith("LEGISCAN_DISTRICT_UNRESOLVED")));
  assert.ok(az.acquisitions.every(row=>!row.requestedUrl.includes("private-")&&!row.body.includes("private-")));
});

test("Congress.gov pagination stays in its native state slice and captures each own member API page",async()=>{
  const requests:string[]=[],fetchImpl:typeof fetch=async(resource)=>{
    const parsed=new URL(String(resource));requests.push(parsed.pathname+parsed.search);assert.equal(parsed.searchParams.get("api_key"),"private-congress-key");
    if(parsed.pathname==="/v3/member/AZ")return json(parsed.searchParams.get("offset")==="0"
      ?{members:[{bioguideId:"A000001"}],pagination:{count:2,next:"https://api.congress.gov/v3/member/AZ?offset=1&api_key=private-congress-key"}}
      :{members:[{bioguideId:"B000002"}],pagination:{count:2}});
    const bioguide=parsed.pathname.split("/").at(-1)!;
    return json({member:{bioguideId:bioguide,directOrderName:bioguide==="A000001"?"Jane Doe":"John Doe",currentMember:true,
      officialWebsiteUrl:bioguide==="A000001"?"https://doe.senate.gov":"https://doe.house.gov",addressInformation:{phoneNumber:"202-224-0000",officeAddress:"100 Senate Office Building",city:"Washington",district:"DC",zipCode:"20510"},
      terms:[{chamber:bioguide==="A000001"?"Senate":"House of Representatives",stateCode:"AZ",district:bioguide==="A000001"?undefined:1,startYear:2025}],depiction:{imageUrl:"https://www.congress.gov/img/member.jpg"}}});
  };
  const release=await acquirePeopleSource(options("congress-api",fetchImpl));assert.equal(release.gaps.length,0);assert.equal(release.roster.officeholders.length,2);
  assert.equal(release.acquisitions.length,4);assert.equal(release.roster.divisions[0].ocdId,"ocd-division/country:us/state:az");
  assertScoped(release.roster,"congress-api");assert.equal(release.roster.officeholders[0].personId,"congress-api:A000001");
  assert.equal(release.roster.divisions[1].ocdId,"ocd-division/country:us/state:az/cd:1");assert.equal(release.roster.officeholders[0].termStart,"2025");
  assert.equal(release.roster.officeholders[0].photo,null);assert.ok(release.roster.officeholders[0].portraitCandidate);assert.equal(release.roster.currentMembershipComplete,true);
  assert.equal(release.roster.officeholders[0].offices?.[0].address,"100 Senate Office Building, Washington, DC 20510");
  assert.equal(release.roster.officeholders[0].fieldSources?.offices.sourceOrg,"Congress.gov / Library of Congress");
  assert.ok(requests.every(value=>value.startsWith("/v3/member/AZ")||value.startsWith("/v3/member/A000001")||value.startsWith("/v3/member/B000002")));
  assert.ok(release.acquisitions.every(row=>!JSON.stringify(row).includes("private-congress-key")));
});

test("govinfo reads the current directory, opens only its state granules and uses DATA_GOV_API_KEY",async()=>{
  const requests:string[]=[],fetchImpl:typeof fetch=async(resource)=>{
    const parsed=new URL(String(resource));requests.push(parsed.pathname);if(parsed.hostname==="api.govinfo.gov")assert.equal(parsed.searchParams.get("api_key"),"private-govinfo-key");
    if(parsed.pathname.startsWith("/collections/CDIR/"))return json({packages:[{packageId:"CDIR-2026",title:"Official Congressional Directory, 119th Congress",dateIssued:"2026-02-01"},{packageId:"CDIR-2024",title:"Official Congressional Directory, 118th Congress",dateIssued:"2024-02-01"}]});
    if(parsed.pathname==="/packages/CDIR-2026/granules")return json({granules:[{title:"Arizona",granuleId:"AZ",granuleLink:"https://api.govinfo.gov/packages/CDIR-2026/granules/AZ/summary"},{title:"California",granuleId:"CA",granuleLink:"https://api.govinfo.gov/packages/CDIR-2026/granules/CA/summary"}]});
    if(parsed.pathname.endsWith("/AZ/summary"))return json({congress:"119",members:[{bioGuideId:"A000001",memberName:"Jane Doe",state:"AZ",chamber:"Senate",party:"D"}],download:{txtLink:"https://www.govinfo.gov/content/pkg/CDIR-2026/html/AZ.htm"}});
    if(parsed.hostname==="www.govinfo.gov")return new Response("Jane Doe, Senator. https://doe.senate.gov Office: 202-224-1234");
    throw new Error(`unexpected fixture request ${parsed.pathname}`);
  };
  const release=await acquirePeopleSource(options("govinfo",fetchImpl));assert.equal(release.gaps.length,0);assert.equal(release.roster.officeholders.length,1);
  assertScoped(release.roster,"govinfo");assert.equal(release.roster.officeholders[0].personId,"govinfo:A000001");
  assert.equal(release.roster.officeholders[0].phone,"202-224-1234");assert.equal(release.roster.officeholders[0].websiteUrl,"https://doe.senate.gov/");
  assert.equal(release.roster.officeholders[0].fieldSources?.phone.sourceUrl,"https://www.govinfo.gov/content/pkg/CDIR-2026/html/AZ.htm");
  assert.ok(!requests.some(path=>path.includes("/CA/")));assert.equal(release.acquisitions.length,4);assert.ok(release.acquisitions.every(row=>!row.requestedUrl.includes("api_key")));
  const indexes = release.acquisitions.filter(row => row.indexOnly);
  assert.equal(indexes.length, 2);
  assert.ok(indexes.every(row => row.body === "" && row.heldCapture?.ref.byteLength));
  assert.ok(release.acquisitions.filter(row => !row.indexOnly).every(row => !row.body.includes("California")));
});

test("govinfo folds collection pages to one current package and holds national index bodies outside state work", async () => {
  let collectionPages = 0;
  const fetchImpl: typeof fetch = async resource => {
    const parsed = new URL(String(resource));
    if (parsed.pathname.startsWith("/collections/CDIR/")) {
      const page = parsed.searchParams.get("offsetMark") === "*" ? 0 : Number(parsed.searchParams.get("offsetMark"));
      collectionPages++;
      const packages: unknown[] = Array.from({ length: 100 }, (_, id) => ({ packageId: `OLD-${page}-${id}`, congress: 118, title: "Unrelated directory " + "x".repeat(1000) }));
      if (page === 0 || page === 9) packages.push({ packageId: `CURRENT-${page}`, congress: 119, dateIssued: page === 0 ? "2026-01-01" : "2026-02-01" });
      parsed.searchParams.delete("api_key"); parsed.searchParams.set("offsetMark", String(page + 1));
      return json({ packages, ...(page < 9 ? { nextPage: parsed.href } : {}) });
    }
    if (parsed.pathname === "/packages/CURRENT-9/granules") return json({ granules: [
      { state: "CA", title: "California", granuleLink: "https://api.govinfo.gov/packages/CURRENT-9/granules/CA/summary" },
      { state: "AZ", title: "Arizona", granuleLink: "https://api.govinfo.gov/packages/CURRENT-9/granules/AZ/summary" },
    ] });
    if (parsed.pathname.endsWith("/AZ/summary")) return json({ congress: "119", members: [{ bioGuideId: "A000001", memberName: "Jane Doe", state: "AZ", chamber: "Senate" }] });
    throw new Error(`unexpected state source ${parsed.pathname}`);
  };
  const release = await acquirePeopleSource(options("govinfo", fetchImpl));
  assert.equal(collectionPages, 10);
  assert.deepEqual(release.gaps, []);
  assert.equal(release.roster.officeholders.length, 1);
  assert.ok(release.acquisitions.filter(row => row.indexOnly).every(row => row.body === "" && row.heldCapture));
  assert.ok(release.acquisitions.filter(row => !row.indexOnly).every(row => !row.body.includes("Unrelated directory")));
});

test("Data.gov govinfo transport cannot escape its provider and retains existing College Scorecard behavior",async()=>{
  let requests=0;
  const fetchImpl:typeof fetch=async(resource)=>{requests++;const parsed=new URL(String(resource));assert.equal(parsed.hostname,"api.govinfo.gov");return json({collections:[{collectionCode:"CDIR"}]});};
  const result=await readSourceApi("data_gov_api",{provider:"govinfo",path:"collections"},{env:{DATA_GOV_API_KEY:"private-key"},fetchImpl});assert.match(result.sourceUrl,/api.govinfo.gov/);assert.equal(requests,1);
  await assert.rejects(readSourceApi("data_gov_api",{provider:"govinfo",path:"https://example.org/"},{env:{DATA_GOV_API_KEY:"private-key"},fetchImpl}),/provider base/);assert.equal(requests,1);
});

test("official legislature parser binds its own page and refuses a different member's page",()=>{
  const source=provenance("https://legislature.example.gov/members/jane","Open States",NOW),holder=emptyPerson("plural:jane","Jane Doe","State Senator","az",source);
  holder.chamber="upper";holder.websiteUrl=source.sourceUrl;holder.nativeIds={"ocd-person":["ocd-person/jane"]};
  const roster=emptyRoster("az",NOW);roster.officeholders.push(holder);
  const input={...options("official-state-people",async()=>json({})),roster,divisions:[{ocdId:"ocd-division/country:us/state:az/sldu:1",label:"State Senate District 1",divisionType:"sldu"}]};
  const page="<h1>Senator Jane Doe</h1><p>District 1</p><a href='tel:6025551234'>602-555-1234</a><img src='/jane.jpg' alt='Jane Doe'>";
  const parsed=normalizeOfficialLegislaturePage(page,holder.websiteUrl!,input,NOW);assert.equal(parsed.officeholders.length,1);assert.equal(parsed.officeholders[0].phone,"602-555-1234");
  assertScoped(parsed,"official-legislature");
  assert.deepEqual(parsed.officeholders[0].nativeIds?.["ocd-person"],["ocd-person/jane"]);assert.equal(parsed.divisions[0].ocdId,"ocd-division/country:us/state:az/sldu:1");
  assert.equal(normalizeOfficialLegislaturePage(page.replaceAll("Jane Doe","Other Person"),holder.websiteUrl!,input,NOW).officeholders.length,0);
});

test("an official visible member roster discovers people absent from held aggregators and follows their own profile",async()=>{
  const requests:string[]=[],fetchImpl:typeof fetch=async(resource)=>{
    const parsed=new URL(String(resource));requests.push(parsed.pathname);
    if(parsed.pathname==="/members/jane")return new Response("<h1>Senator Jane Doe</h1><a href='/senate/members'>Senate Members</a>");
    if(parsed.pathname==="/senate/members")return new Response("<h1>Senate Members</h1><article><h3><a href='/members/jordan'>Jordan New</a></h3><p>District 2</p><a href='tel:6025550002'>602-555-0002</a></article>");
    if(parsed.pathname==="/members/jordan")return new Response("<h1>Senator Jordan New</h1><p>District 2</p><a href='tel:6025550003'>602-555-0003</a>");
    throw new Error(`unexpected roster fixture path ${parsed.pathname}`);
  };
  const holder=emptyPerson("plural:jane","Jane Doe","State Senator","az",provenance("https://legislature.example.gov/members/jane","Open States",NOW));holder.chamber="upper";holder.websiteUrl=holder.provenance.sourceUrl;
  const held=emptyRoster("az",NOW);held.officeholders.push(holder);
  const release=await acquirePeopleSource({...options("official-state-people",fetchImpl),roster:held});
  const newMember=release.roster.officeholders.find(person=>person.name==="Jordan New");assert.ok(newMember);assert.equal(newMember.phone,"602-555-0003");assert.equal(newMember.provenance.kind,"OFFICIAL");
  assert.equal(newMember.websiteUrl,"https://legislature.example.gov/members/jordan");assert.ok(newMember.provenance.quote?.includes("Jordan New"));
  assert.ok(requests.includes("/members/jordan"));assert.equal(release.coverage.people,2);assert.equal(release.coverage.disagreements,release.roster.disagreements?.length??0);
});

test("Wikidata keeps each current term and all native identities as portrait leads",()=>{
  const binding=(value:string)=>({value}),rows=["P1157","P3344"].map((property,index)=>({person:binding("http://www.wikidata.org/entity/Q123"),personLabel:binding("Jane Doe"),position:binding("http://www.wikidata.org/entity/Q456"),positionLabel:binding("United States Senator"),start:binding("2025-01-03T00:00:00Z"),identifierProperty:binding(`http://www.wikidata.org/entity/${property}`),identifier:binding(index?"1234":"A000001"),image:binding("https://commons.wikimedia.org/wiki/Special:FilePath/Jane_Doe.jpg")}));
  const parsed=normalizeWikidataPeople({results:{bindings:rows}},options("wikidata-people",async()=>json({})),{bioguide:"P1157",votesmart:"P3344"},NOW);
  assertScoped(parsed,"wikidata");assert.equal(parsed.officeholders[0].personId,"wikidata:Q123");
  assert.equal(parsed.officeholders.length,1);assert.deepEqual(parsed.officeholders[0].nativeIds?.bioguide,["A000001"]);assert.deepEqual(parsed.officeholders[0].nativeIds?.votesmart,["1234"]);
  assert.equal(parsed.officeholders[0].termStart,"2025-01-03");
  assert.equal(parsed.officeholders[0].photo,null);assert.equal(parsed.divisions[0].ocdId,"ocd-division/country:us/state:az");
});

test("Wikidata discovers property identifiers, saves photo licensing, and does not publish a new statewide officer",async()=>{
  const binding=(value:string)=>({value}),fetchImpl:typeof fetch=async(resource,init)=>{
    const parsed=new URL(String(resource));
    if(parsed.hostname==="www.wikidata.org") {
      const label=parsed.searchParams.get("search")!;
      const found=label==="Open States legislator ID"?{id:"P3167",label}:label==="Vote Smart ID"?{id:"P3344",label}:label==="Follow the Money ID"?{id:"P2657",label}:label==="LegiScan person ID"?{id:"P999",label}:null;
      return json({search:found?[found]:[]});
    }
    if(parsed.hostname==="commons.wikimedia.org")return json({query:{pages:{1:{imageinfo:[{extmetadata:{LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"},Artist:{value:"<b>Official Photographer</b>"}}}]}}}});
    if(parsed.hostname==="query.wikidata.org"){assert.equal(init?.method,"POST");assert.ok(String(init?.body).includes("query="));assert.ok(decodeURIComponent(String(init?.body)).includes("2026-10-12T00:00:00.000Z"));return json({results:{bindings:[
      {person:binding("http://www.wikidata.org/entity/Q123"),personLabel:binding("Jane Doe"),position:binding("http://www.wikidata.org/entity/Q456"),positionLabel:binding("United States Senator"),identifierProperty:binding("http://www.wikidata.org/entity/P1157"),identifier:binding("A000001"),image:binding("https://commons.wikimedia.org/wiki/Special:FilePath/Jane_Doe.jpg")},
      {person:binding("http://www.wikidata.org/entity/Q999"),personLabel:binding("New Governor"),position:binding("http://www.wikidata.org/entity/Q789"),positionLabel:binding("governor of Arizona")},
    ]}});}
    throw new Error("unexpected fixture host");
  };
  const release=await acquirePeopleSource({...options("wikidata-people",fetchImpl),asOf:"2026-10-12"});assert.equal(release.roster.officeholders.length,1);assert.equal(release.roster.officeholders[0].portraitCandidate?.license,"CC BY-SA 4.0");
  assert.equal(release.roster.officeholders[0].portraitCandidate?.attribution,"Official Photographer");assert.ok(release.gaps.some(row=>row.detail.startsWith("WIKIDATA_STATEWIDE_OWN_PAGE_OWED")));
  assert.ok(release.acquisitions.some(row=>row.requestedUrl.includes("commons.wikimedia.org")));assert.ok(release.acquisitions.some(row=>row.body.includes("P3344")));
});
