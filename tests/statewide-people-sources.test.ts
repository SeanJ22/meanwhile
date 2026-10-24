import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { acquireNationalStatewideLeads, acquireStatewidePeople, wikidataStatewideQuery } from "../lib/sources/statewide/acquisition.ts";
import { STATEWIDE_REFERENCE_SOURCES } from "../lib/sources/statewide/reference.ts";
import { parseStatewideAssociation, parseWikidataStatewide, verifyStatewideOfficialPage, statewideRoster, type StatewideLead } from "../lib/sources/statewide/parse.ts";

const at="2026-10-12T00:00:00.000Z";
// Controlled source shapes exercise parser rules. These are explicitly
// synthetic documents; live government roster fixtures remain a separate check.
const lead=(state:string,name:string,officeTitle:string,url:string):StatewideLead=>({state,name,officeTitle,profileUrls:[url],
  sourceId:"nass",sourceOrg:"National Association of Secretaries of State",sourceUrl:"https://www.nass.org/membership",collectedAt:at});
const document=(stateName:string,name:string,office:string,method:string)=>`<html><head><title>${name} | ${stateName}</title></head><body><main><h1>${office} ${name}</h1><p>${name} serves as ${stateName}'s ${office}.</p><p>${office} ${method}.</p><a href="tel:555-555-0100">Office phone</a><img src="/${name.toLowerCase().replace(/ /g,"-")}.jpg" alt="${name}"></main></body></html>`;

test("all ten national statewide reference publishers load together, with a gap for a failed source",async()=>{
  const {locks}=createMemoryRepositories(),store=new MemoryEvidenceStore(),requested:string[]=[];
  const result=await acquireNationalStatewideLeads({signal:new AbortController().signal,store,locks,now:()=>at,acquire:acquireKnownRelease,
    fetchImpl:(async resource=>{
      const url=String(resource);requested.push(url);
      if(url.includes("www.wikidata.org/w/api.php"))return new Response(JSON.stringify({search:[{id:"P123456",label:new URL(url).searchParams.get("search")}]}));
      if(url.includes("ccsso.org"))return new Response("source temporarily unavailable",{status:503});
      if(url.includes("query.wikidata.org"))return new Response(JSON.stringify({results:{bindings:[]}}),{headers:{"content-type":"application/json"}});
      return new Response("<html><article><h2>Arizona</h2><h3>Jane Example</h3><a href=\"https://office.gov/about\">Official website</a></article></html>");
    })as typeof fetch});
  assert.equal(requested.filter(url=>!url.includes("www.wikidata.org/w/api.php")).length,10);assert.equal(result.coverage.length,10);assert.equal(result.acquisitions.length,13);
  assert.ok(result.gaps.some(row=>row.sourceUrl.includes("ccsso.org")&&row.detail.includes("503")));
  assert.equal(new Set(STATEWIDE_REFERENCE_SOURCES.map(source=>source.id)).size,10);
});

test("directory cards from multiple states are parsed separately and retain publisher attribution",()=>{
  const source=STATEWIDE_REFERENCE_SOURCES.find(row=>row.id==="nass")!;
  const html=`<main><article><h2>Arizona</h2><h3>Adrian Fontes</h3><a href="https://azsos.gov/about">Official website</a></article>
    <article><h2>Maine</h2><h3>Shenna Bellows</h3><a href="https://www.maine.gov/sos/about">Official website</a></article>
    <article><h2>Wisconsin</h2><h3>Sarah Godlewski</h3><a href="https://sos.wi.gov/about">Official website</a></article></main>`;
  const result=parseStatewideAssociation(html,source,source.url,at);
  assert.deepEqual(result.leads.map(row=>row.state).sort(),["az","me","wi"]);
  assert.ok(result.leads.every(row=>row.sourceOrg===source.publisher&&row.sourceUrl===source.url));
  assert.ok(result.leads.every(row=>row.profileUrls.length===1));
  const shard=parseStatewideAssociation(html,source,source.url,at,"me");
  assert.deepEqual(shard.leads.map(row=>row.state),["me"]);
});

test("official statewide selection labels come from office statements, including appointed secretaries",()=>{
  for(const [state,stateName,name,office,method,expected] of [
    ["az","Arizona","Adrian Fontes","Secretary of State","is elected statewide","ELECTED_STATEWIDE"],
    ["me","Maine","Shenna Bellows","Secretary of State","is appointed by the Legislature","APPOINTED"],
    ["wi","Wisconsin","Sarah Godlewski","Secretary of State","is elected by the voters of the state","ELECTED_STATEWIDE"],
  ]){
    const url=`https://official.${state}.gov/about`,result=verifyStatewideOfficialPage(lead(state,name,office,url),{url,html:document(stateName,name,office,method),retrievedAt:at});
    assert.ok("person"in result,JSON.stringify(result));
    assert.equal(result.person.selectionMethod,expected);
    assert.equal(result.person.selectionMethodSourceUrl,url);
    assert.equal(result.person.memberships?.[0]?.divisionId,`ocd-division/country:us/state:${state}`);
    assert.equal(result.person.phone,"555-555-0100");
    assert.equal(result.person.photo,null);
    assert.equal(result.person.portraitCandidate?.sourceUrl,url);
    assert.equal(result.person.fieldSources?.phone?.sourceUrl,url);
  }
});

test("a directory name and office in unrelated passages do not establish a statewide officeholder",()=>{
  const url="https://official.az.gov/about",candidate=lead("az","Adrian Fontes","Secretary of State",url);
  const disjoint=`<title>Adrian Fontes</title><p>Arizona Secretary of State</p><p>${"unrelated words ".repeat(40)}</p><p>Adrian Fontes spoke here.</p>`;
  assert.deepEqual(verifyStatewideOfficialPage(candidate,{url,html:disjoint,retrievedAt:at}),{reason:"STATEWIDE_CURRENT_HOLDER_OFFICE_NOT_BOUND"});
  const former=`<title>Adrian Fontes</title><h1>Former Secretary of State Adrian Fontes</h1><p>Arizona</p>`;
  assert.deepEqual(verifyStatewideOfficialPage(candidate,{url,html:former,retrievedAt:at}),{reason:"STATEWIDE_CURRENT_HOLDER_OFFICE_NOT_BOUND"});
  const lieutenant=lead("az","Jane Example","Governor",url);
  assert.deepEqual(verifyStatewideOfficialPage(lieutenant,{url,html:document("Arizona","Jane Example","Lieutenant Governor","is elected statewide"),retrievedAt:at}),{reason:"STATEWIDE_CURRENT_HOLDER_OFFICE_NOT_BOUND"});
});

test("a statewide office beyond the named association categories is accepted from its official page",()=>{
  const url="https://official.tx.gov/about",candidate={...lead("tx","Jane Example","Railroad Commissioner of Texas",url),sourceId:"wikidata"};
  const result=verifyStatewideOfficialPage(candidate,{url,html:document("Texas","Jane Example","Railroad Commissioner","is elected statewide"),retrievedAt:at});
  assert.ok("person"in result);assert.equal(result.person.officeTitle,"Railroad Commissioner");assert.equal(result.person.selectionMethod,"ELECTED_STATEWIDE");
});

test("an association page never publishes its officer without their own official page",()=>{
  const url="https://www.nass.org/membership",candidate=lead("az","Adrian Fontes","Secretary of State",url);
  assert.deepEqual(verifyStatewideOfficialPage(candidate,{url,html:document("Arizona",candidate.name,candidate.officeTitle,"is elected statewide"),retrievedAt:at}),{reason:"STATEWIDE_PAGE_NOT_OFFICIAL"});
});

test("the office's own published contact page accompanies the statewide holder",()=>{
  const url="https://official.az.gov/about",candidate=lead("az","Kris Mayes","Attorney General",url);
  const html=document("Arizona",candidate.name,candidate.officeTitle,"is elected statewide")+
    '<a href="https://other.az.gov/contact">Contact Us</a><a href="/webmaster">Contact webmaster</a><a href="/contact-us">Contact Us</a>';
  const result=verifyStatewideOfficialPage(candidate,{url,html,retrievedAt:at});
  assert.ok("person"in result);
  assert.equal(result.person.contactFormUrl,"https://official.az.gov/contact-us");
  assert.equal(result.person.fieldSources?.contactFormUrl.sourceUrl,url);
});

test("an office landing page's explicit holder publishes without requiring a personal biography heading",()=>{
  const url="https://official.az.gov/",candidate=lead("az","Kris Mayes","Attorney General",url);
  const html='<title>Arizona Office of the Attorney General</title><h1>Attorney General</h1><p>Attorney General Kris Mayes announced the office’s action.</p>';
  assert.ok("person"in verifyStatewideOfficialPage(candidate,{url,html,retrievedAt:at}));
  const wrong='<title>Arizona Governor’s Office</title><h1>Governor</h1><p>Governor Morgan Example and Lieutenant Governor Kris Mayes attended.</p>';
  assert.ok("reason"in verifyStatewideOfficialPage({...candidate,officeTitle:"Governor"},{url,html:wrong,retrievedAt:at}));
});

test("short statewide titles require the office's full agency on the same saved page",()=>{
  for(const [title,short,agency]of [["Corporation Commissioner","Commissioner","Arizona Corporation Commission"],
    ["Superintendent of Public Instruction","State Superintendent","Arizona Department of Education"]]){
    const url="https://official.az.gov/leader",candidate=lead("az","Morgan Example",title,url);
    const html=`<title>${short} Morgan Example</title><h1>${short} Morgan Example</h1><p>${agency}</p>`;
    const verified=verifyStatewideOfficialPage(candidate,{url,html,retrievedAt:at});
    assert.ok("person"in verified);assert.equal(verified.person.officeTitle,title);
    assert.ok("reason"in verifyStatewideOfficialPage(candidate,{url,html:html.replace(agency,"Arizona government"),retrievedAt:at}));
  }
  const url="https://official.az.gov/leader",candidate=lead("az","Morgan Example","Superintendent of Public Instruction",url);
  assert.ok("reason"in verifyStatewideOfficialPage(candidate,{url,html:'<h1>County Superintendent Morgan Example</h1><p>Arizona Department of Education</p>',retrievedAt:at}));
});

test("a middle initial or a quoted nickname on the official profile supplies its exact published name",()=>{
  const url="https://official.utah.gov/governor";
  for(const [input,actual]of [["Spencer Cox","Spencer J. Cox"],[`Jerrauld C. "Jay" Jones`,"Jay Jones"]]){
    const candidate=lead("ut",input,"Governor",url);
    const verified=verifyStatewideOfficialPage(candidate,{url,html:document("Utah",actual,"Governor","is elected statewide"),retrievedAt:at});
    assert.ok("person"in verified);assert.equal(verified.person.name,actual);
  }
  const candidate=lead("ut","Spencer Cox","Governor",url);
  assert.ok("reason"in verifyStatewideOfficialPage(candidate,{url,html:document("Utah","Different Cox","Governor","is elected statewide"),retrievedAt:at}));
  assert.ok("reason"in verifyStatewideOfficialPage({...candidate,name:"Spencer K. Cox"},{url,html:document("Utah","Spencer J. Cox","Governor","is elected statewide"),retrievedAt:at}));
});

test("a verified statewide office publishes while an unrelated election or appointment leaves its selection method unknown",()=>{
  const url="https://official.az.gov/about",candidate=lead("az","Adrian Fontes","Secretary of State",url);
  for(const method of ["was elected by the voters of District 9","Adrian Fontes appointed a school board member"]){
    const result=verifyStatewideOfficialPage(candidate,{url,html:document("Arizona",candidate.name,candidate.officeTitle,method),retrievedAt:at});
    assert.ok("person"in result);assert.equal(result.person.selectionMethod,"UNKNOWN");
    assert.equal(result.person.memberships?.[0]?.divisionId,"ocd-division/country:us/state:az");
    const roster=statewideRoster("az",[result.person],at);
    assert.equal(roster.divisions.length,1,"the verified name, office and state meet the official's minimum facts in §3");
    assert.deepEqual(roster.unmatched,[]);
  }
});

test("a government site on another domain requires a saved official endorsement",()=>{
  const url="https://secretary.example.us/about",candidate=lead("me","Shenna Bellows","Secretary of State",url);
  const html=document("Maine",candidate.name,candidate.officeTitle,"is appointed by the Legislature");
  assert.deepEqual(verifyStatewideOfficialPage(candidate,{url,html,retrievedAt:at}),{reason:"STATEWIDE_PAGE_NOT_OFFICIAL"});
  const result=verifyStatewideOfficialPage(candidate,{url,html,retrievedAt:at,linkingPage:{url:"https://www.maine.gov/",html:`<a href="${url}">Secretary of State</a>`}});
  assert.ok("person"in result);assert.equal(result.person.selectionMethod,"APPOINTED");
  assert.equal(result.person.provenance.kind,"OFFICIAL","a saved government endorsement gives the own page official field precedence");
});

test("national and held Open States leads for one officer verify once and preserve all native identifiers",async()=>{
  const url="https://azsos.gov/about",candidate=lead("az","Adrian Fontes","Secretary of State",url),{locks}=createMemoryRepositories();let requests=0;
  const national={leads:[{...candidate,nativeIds:{wikidata:["Q123"],nass:["/membership/profile"]}}],acquisitions:[],gaps:[],coverage:[{sourceId:"nass",leads:1}]};
  const held={scope:"US-AZ",generatedAt:at,divisions:[],unmatched:[],officeholders:[{id:"plural:fontes",personId:"plural:fontes",state:"AZ",name:candidate.name,officeTitle:candidate.officeTitle,level:"STATE"as const,
    nativeIds:{"ocd-person":["ocd-person/exact-native-id"],plural:["exact-native-id"]},termStart:"",termEnd:"",birthDate:null,partyLabel:null,websiteUrl:url,contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,
    provenance:{sourceUrl:"https://raw.githubusercontent.com/openstates/people/revision/person.yml",sourceOrg:"Open States",collectedAt:at,verifiedAt:null}}]};
  const result=await acquireStatewidePeople({state:"az",signal:new AbortController().signal,national,heldPeople:held,store:new MemoryEvidenceStore(),locks,now:()=>at,acquire:acquireKnownRelease,
    fetchImpl:(async resource=>{requests++;assert.equal(String(resource),url);return new Response(document("Arizona",candidate.name,candidate.officeTitle,"is elected statewide"));})as typeof fetch});
  assert.equal(requests,1);assert.equal(result.roster.officeholders.length,1);assert.equal(result.roster.divisions[0]?.ocdId,"ocd-division/country:us/state:az");
  assert.deepEqual(result.roster.officeholders[0]?.nativeIds?.plural,["exact-native-id"]);
  assert.deepEqual(result.roster.officeholders[0]?.nativeIds?.wikidata,["Q123"]);
  assert.equal(result.roster.officeholders[0]?.provenance.sourceUrl,url);
});

test("an office-profile fallback follows the requested office and leaves unrelated biographies alone",async()=>{
  const url="https://official.utah.gov/",profile="https://official.utah.gov/governor/biography",requests:string[]=[];
  const {locks}=createMemoryRepositories();
  const result=await acquireStatewidePeople({state:"ut",signal:new AbortController().signal,store:new MemoryEvidenceStore(),locks,now:()=>at,acquire:acquireKnownRelease,
    national:{leads:[],acquisitions:[],gaps:[],coverage:[]},leads:[lead("ut","Spencer Cox","Governor",url)],
    fetchImpl:(async resource=>{
      const requested=String(resource);requests.push(requested);
      if(requested===url)return new Response('<h1>Utah</h1><a href="/about-state">About Utah</a><a href="https://news.example.org/spencer-cox">Spencer Cox</a><a href="/news/spencer-cox">Spencer Cox</a><a href="/governor/biography">About the Governor</a><a href="/attorney-general">About the Attorney General</a>');
      if(requested===profile)return new Response(document("Utah","Spencer J. Cox","Governor","is elected statewide"));
      throw new Error(`Unrelated profile requested: ${requested}`);
    })as typeof fetch});
  assert.deepEqual(requests,[url,profile]);
  assert.equal(result.roster.officeholders[0]?.name,"Spencer J. Cox");
});

test("Wikidata current holders preserve source identifiers and portrait leads without publishing photos",()=>{
  const sourceUrl="https://query.wikidata.org/sparql?query=saved",value=(value:string)=>({value});
  const result=parseWikidataStatewide(JSON.stringify({results:{bindings:[{stateCode:value("US-AZ"),person:value("http://www.wikidata.org/entity/Q123"),personLabel:value("Adrian Fontes"),officeLabel:value("Secretary of State"),
    personWebsite:value("https://azsos.gov/about"),openstates:value("native-uuid"),bioguide:value("F000000"),image:value("https://commons.wikimedia.org/image.jpg"),start:value("2023-01-02T00:00:00Z")} ]}}),sourceUrl,at);
  assert.equal(result.leads[0]?.state,"az");assert.deepEqual(result.leads[0]?.nativeIds?.wikidata,["Q123"]);
  assert.deepEqual(result.leads[0]?.nativeIds?.openstates,["native-uuid"]);assert.equal(result.leads[0]?.termStart,"2023-01-02");
  assert.equal(result.leads[0]?.portraitCandidate?.sourceUrl,"http://www.wikidata.org/entity/Q123");
  const query=wikidataStatewideQuery(at);assert.match(query,/P39/);assert.match(query,/P1308/);assert.match(query,/P300/);assert.doesNotMatch(query,/LIMIT\s+\d+/);
  const shard=wikidataStatewideQuery(at,{},"az");assert.match(shard,/FILTER\(\?stateCode = "US-AZ"\)/);assert.doesNotMatch(shard,/REGEX\(\?officeLabel/);
});
