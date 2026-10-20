import assert from "node:assert/strict";
import {PUBLIC_SITE_ORIGIN} from "../lib/ops/origins.ts";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { bindCampaignMoney as bindIndexedMoney,campaignMoneyPeopleIndex, campaignMoneyWork, campaignMoneyStateDue,readCampaignMoneyStateWork,campaignRecordYear, type CampaignMoneyPerson } from "../lib/funding/state-people.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { CAMPAIGN_MONEY_SCOPE,CAMPAIGN_FINANCE_SOURCES, campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { refreshCampaignMoneyState } from "../lib/funding/state-publication.ts";
import {rebuildCampaignCycles} from "../lib/funding/state-cycles.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { readCampaignFinanceForPlace } from "../lib/funding/state-reader.ts";
import { stateCampaignEvidence } from "../lib/ask/state-campaign.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factDb } from "./helpers/fact-db.ts";
import { installFactReader } from "../lib/facts/db.ts";
import {publishCampaignMoneyWork} from "../lib/funding/work-publication.ts";
import {runCampaignMoneyStates} from "../lib/funding/state-sources.ts";
import { renderCardWithSources } from "./helpers/render-card.ts";

const bindCampaignMoney=(row:Parameters<typeof bindIndexedMoney>[0],people:readonly CampaignMoneyPerson[])=>bindIndexedMoney(row,campaignMoneyPeopleIndex(people));
const resource = campaignFinanceSource("WA").resources[0];
const [raw] = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/wa-native-excerpt.json",import.meta.url),"utf8"));
const at="2026-10-20T00:00:00.000Z", division="ocd-division/country:us/state:wa";
const capture={url:resource.url,rawHash:"a".repeat(64),vaultKey:"test",byteLength:10,retrievedAt:at,publicationDate:null};
const row=campaignSourceRecord("WA",resource,raw,capture);
const person:CampaignMoneyPerson={id:"published-person",name:"Anita Crawford-Willis",seat:division+"/place:seattle#judge",office:raw.office,division:division+"/place:seattle",incumbent:true,sourceUrl:"https://www.seattle.gov/courts"};

async function campaignDb(){
  const db=await factDb();
  await db.pg.exec("CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb); CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,payload jsonb)");
  for(const statement of (await readFile(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8")).split("--> statement-breakpoint")){
    if(/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement))await db.pg.exec(statement);
  }
  return db;
}
async function publishPerson(db:Awaited<ReturnType<typeof campaignDb>>,person:CampaignMoneyPerson){
  await db.query("INSERT INTO civic_data_promotions VALUES('REGISTRY_RUNTIME_BINDING',$1,$2,$3)",["US-"+(/(?:state|district|territory):([a-z]{2})/.exec(person.division)![1].toUpperCase()),person.id,JSON.stringify({bodyRosters:[{bodyId:person.seat,sourceUrl:person.sourceUrl,members:[{id:person.id,name:person.name,officeTitle:person.office}]}]})]);
}

test("money requires a published person, exact seat and a filed period from 2020 onward",()=>{
  assert.ok(CAMPAIGN_FINANCE_SOURCES.every(source => source.minimumYear === 2020));
  assert.equal(bindCampaignMoney(row,[]),null);
  assert.equal(bindCampaignMoney({...row,period:"2019"},[person]),null);
  assert.equal(bindCampaignMoney({...row,period:null},[person]),null);
  assert.equal(bindCampaignMoney({...row,period:"2020 – 2026"},[person]),null);
  assert.equal(bindCampaignMoney({...row,office:"Governor"},[person]),null);
  assert.equal(bindCampaignMoney(row,[person,{...person,id:"different-person"}]),null);
  assert.equal(bindCampaignMoney(row,[person])?.person?.id,person.id);
  assert.equal(campaignRecordYear({...row,transactionDate:"2019-12-31",period:"2026"}),2019);
  assert.equal(campaignRecordYear({...row,transactionDate:"2019-12-31T23:00:00-05:00"}),2019);
  assert.equal(campaignRecordYear({...row,transactionDate:"2026-02-30"}),null);
});

test("native ordinal districts bind the right Kentucky seat and a broad government ID cannot bypass the district",async()=>{
  const source=campaignFinanceSource("KY").resources[0];
  const [native]=JSON.parse(await readFile(new URL("./fixtures/campaign-finance/ky-native-contributions.json",import.meta.url),"utf8"));
  const filed=campaignSourceRecord("KY",source,native,capture),division="ocd-division/country:us/state:ky/sldl:7";
  const candidate={id:"ky-candidate",name:filed.candidateName!,office:"State Representative",seat:division+"#representative",division,incumbent:false,sourceUrl:"https://elect.ky.gov/"};
  assert.ok(bindCampaignMoney(filed,[candidate]));
  assert.equal(bindCampaignMoney({...filed,governmentOcdId:"ocd-division/country:us/state:ky",filedDistrict:"8TH DISTRICT"},[candidate]),null);
  assert.ok(bindCampaignMoney({...filed,governmentOcdId:division,filedDistrict:null},[candidate]));
});

test("old collapsed, unbound and pre-2020 rows cannot reach cards or Ask; bound rows show cycle totals",async()=>{
  const db=await campaignDb();
  try {
    assert.equal((await fileCampaignMoneyFacts(db,"WA",[row],at)).written,0);
    const bound=bindCampaignMoney(row,[person])!;
    await fileCampaignMoneyFacts(db,"WA",[bound,{...bound,id:"WA:old",period:"2018"}],at);
    await db.query(`INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[person.id,division]);
    await rebuildCampaignCycles(db,"WA",[person.id],at);
    await publishPerson(db,person);
    const read=await readCampaignFinanceForPlace(division,{query:db.query});
    assert.equal(read.records.length,1); assert.equal(read.records[0].cycle,2026);
    assert.deepEqual(read.records[0].totals.find(total=>total.label==="Contributions"),{label:"Contributions",amount:0});
    assert.equal('transactionDate' in read.records[0],false);
    const ask=await stateCampaignEvidence([division],person.id,{query:db.query});
    assert.equal(ask.records[0].subjectId,person.id); assert.match(ask.records[0].text,/2026 cycle/);
    const bodyAsk=await stateCampaignEvidence([division],undefined,{query:db.query,aboutSubjectId:division+"#government"});
    assert.ok(bodyAsk.records.every(record=>record.subjectId===division+"#government" && record.canonicalSubjectId===person.id));
    const markup=await renderCardWithSources({modulePath:"./components/funding/state-campaign-section.tsx",exportName:"StateCampaignSection",props:{divisionId:division,data:{...read,nextCursor:null}},sourceUrls:[row.filingUrl]});
    assert.match(markup,/2026 cycle/); assert.doesNotMatch(markup,/Official filing source|Next filings/);
    await db.query(`INSERT INTO entity VALUES ('collapsed','committee','Wrong name','WA',$1,now())`,[division]);
    await db.query(`INSERT INTO entity_place VALUES ('collapsed',$1)`,[division]);
    assert.equal((await readCampaignFinanceForPlace(division,{query:db.query})).records.length,1);
  } finally {await db.pg.close();}
});

test("a partial source update retains the older amount's filing and capture in Sources",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-amount-source-"));
  let now=at,revision=1792454400;
  const firstUrl="https://www.pdc.wa.gov/filings/2026/first",nextUrl="https://www.pdc.wa.gov/filings/2026/next";
  let filed={...raw,contributions_amount:"100",expenditures_amount:"50",url:firstUrl};
  const options={state:"WA",facts:db,query:db.query,vault,directory,now:()=>now,
    fetch:async(url:RequestInfo|URL)=>Response.json(String(url).includes("/api/views/")?{rowsUpdatedAt:revision}:[filed])};
  try{
    await publishPerson(db,person);await refreshCampaignMoneyState(options);
    const before=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records[0];
    const original=before.sources.find(source=>source.filingUrl===firstUrl)!;assert.ok(original);
    now="2026-10-21T00:00:00.000Z";revision+=86400;filed={...filed,contributions_amount:"125",expenditures_amount:"",url:nextUrl};
    await refreshCampaignMoneyState(options);
    const after=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records[0];
    assert.equal(after.totals.find(total=>total.label==="Contributions")?.amount,125);
    assert.equal(after.totals.find(total=>total.label==="Expenditures")?.amount,50);
    assert.deepEqual(new Set(after.sources.map(source=>source.filingUrl)),new Set([firstUrl,nextUrl]));
    const retained=after.sources.find(source=>source.filingUrl===firstUrl)!;
    assert.equal(retained.rawHash,original.rawHash);assert.equal(retained.publicationDate,original.publicationDate);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});

test("a failed daily source check stays due for the next hour and keeps verified totals",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-daily-retry-"));
  let now=at,unavailable=false;
  const options={state:"WA",facts:db,query:db.query,vault,directory,now:()=>now,
    fetch:async(url:RequestInfo|URL)=>unavailable?new Response("Unavailable",{status:404}):Response.json(String(url).includes("/api/views/")?{rowsUpdatedAt:1792454400}:[{...raw,contributions_amount:"100"}])};
  try{
    await publishPerson(db,person);await refreshCampaignMoneyState(options);
    now="2026-10-21T12:00:00.000Z";unavailable=true;
    await refreshCampaignMoneyState(options);
    assert.equal((await campaignMoneyWork(db.query,"WA",[person],"2026-10-21T13:00:00.000Z")).length,1);
    const held=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records[0];
    assert.equal(held.totals.find(total=>total.label==="Contributions")?.amount,100);
    unavailable=false;now="2026-10-21T13:00:00.000Z";await refreshCampaignMoneyState(options);
    assert.equal((await campaignMoneyWork(db.query,"WA",[person],"2026-10-21T14:00:00.000Z")).length,0);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});

test("a held source document without a filing period cannot become cycle totals",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-held-period-"));
  const held={dataClass:"STATE_COMMITTEE",jurisdiction:"WA",filingState:"FILED",committeeId:"committee",registeredName:"Filed committee",agency:"Washington Public Disclosure Commission",
    candidateNameAsFiled:person.name,officeSought:person.office,electionYear:2026,targetKeys:[person.id],filingsUrl:capture.url,checkedAt:at.slice(0,10),
    provenance:{sourceUrl:capture.url,collectedAt:at,verifiedAt:at},match:{allThreeAgree:true},totals:{receipts:100,expenditures:0,cashOnHand:null,coveringPeriod:null as string|null}};
  const save=async(kind:string)=>{await db.query("DELETE FROM civic_data_promotions WHERE scope='US-WA:campaign-finance'");await db.query("INSERT INTO civic_data_promotions VALUES('CURATED_READER_RECORD','US-WA:campaign-finance','held-period',$1)",[JSON.stringify({records:[{kind,ocdId:person.division,record:held}]})]);};
  const options={state:"WA",facts:db,query:db.query,vault,directory,now:()=>at,fetch:async()=>new Response("Unavailable",{status:404})};
  try{
    await publishPerson(db,person);await save("CAMPAIGN_FINANCE_DOCUMENT");await refreshCampaignMoneyState(options);
    assert.equal((await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records.length,0);
    held.totals.coveringPeriod="2026 election cycle";await save("CAMPAIGN_FINANCE_FILING");await refreshCampaignMoneyState(options);
    const records=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records;
    assert.equal(records[0]?.totals.find(total=>total.label==="Receipts")?.amount,100);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});

test("a committee's filed name can change without hiding another cycle",async()=>{
  const db=await campaignDb();
  try{
    await publishPerson(db,person);
    const current={...bindCampaignMoney(row,[person])!,id:"WA:current",cycle:2026,period:"2026",filerName:"Current filed name"};
    const older={...current,id:"WA:older",cycle:2024,period:"2024",transactionDate:null,filerName:"Earlier filed name"};
    await fileCampaignMoneyFacts(db,"WA",[current],at);await fileCampaignMoneyFacts(db,"WA",[older],at);
    await rebuildCampaignCycles(db,"WA",[person.id],at);
    const records=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records;
    assert.deepEqual(records.map(record=>record.cycle),[2026,2024]);
    assert.deepEqual(records.map(record=>record.committee),["Current filed name","Earlier filed name"]);
  }finally{await db.pg.close();}
});

test("an amended native row moves between published people without leaving money or borrowed amounts behind",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-owner-move-"));
  const other={...person,id:"second-published-person",name:"Other Published Person",seat:person.division+"#other-judge"};
  let now=at,revision=1792454400,filed={...raw,contributions_amount:"100",expenditures_amount:"50",url:"https://www.pdc.wa.gov/filings/original"};
  const options={state:"WA",facts:db,query:db.query,vault,directory,now:()=>now,
    fetch:async(url:RequestInfo|URL)=>Response.json(String(url).includes("/api/views/")?{rowsUpdatedAt:revision}:[filed])};
  try{
    await publishPerson(db,person);await publishPerson(db,other);await refreshCampaignMoneyState(options);
    assert.equal((await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records.length,1);
    now="2026-10-20T02:00:00.000Z";revision+=3600;filed={...filed,filer_id:"second-filer",filer_name:other.name,expenditures_amount:"",url:"https://www.pdc.wa.gov/filings/amended"};
    await refreshCampaignMoneyState(options);
    assert.equal((await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records.length,0);
    const records=(await readCampaignFinanceForPlace(other.division,{query:db.query,personId:other.id})).records;
    assert.equal(records[0]?.totals.find(total=>total.label==="Contributions")?.amount,100);
    assert.equal(records[0]?.totals.some(total=>total.label==="Expenditures"),false);
    assert.equal((await campaignMoneyWork(db.query,"WA",[person],"2026-10-20T03:00:00.000Z")).length,1);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});

test("two ID-less filed committees remain distinct and a named committee never owns another person's money",async()=>{
  const db=await campaignDb();
  try {
    const first=bindCampaignMoney({...row,id:"WA:first",filerId:null,filerName:"First filed committee"},[person])!;
    const other={...person,id:"second-person",name:"Another Published Person",seat:"second-seat"};
    const second=bindCampaignMoney({...row,id:"WA:second",filerId:null,filerName:"Second filed committee",candidateName:other.name},[other])!;
    await fileCampaignMoneyFacts(db,"WA",[first,second],at);
    const committees=await db.query("SELECT name,parent_id FROM entity WHERE kind='committee' ORDER BY name");
    assert.deepEqual(committees,[{name:"First filed committee",parent_id:person.id},{name:"Second filed committee",parent_id:other.id}]);
    await db.query(`INSERT INTO entity_place(entity_id,place_id) SELECT id,$1 FROM entity WHERE kind='person' ON CONFLICT DO NOTHING`,[division]);
    await rebuildCampaignCycles(db,"WA",[person.id,other.id],at);
    await publishPerson(db,person);await publishPerson(db,other);
    const read=await readCampaignFinanceForPlace(division,{query:db.query,personId:person.id});
    assert.equal(read.records.length,1);assert.equal(read.records[0].committee,"First filed committee");
  }finally{await db.pg.close();}
});

test("hourly work picks up a newly published person from cached state bytes and skips a completed daily check",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-next-person-"));
  let now=at,downloads=0;
  const first={...person,id:"another-published-person",name:"Another Person",seat:person.seat+"-another"};
  const query=db.query;
  const facts={...db,query};
  const options={state:"WA",facts,query,vault,directory,now:()=>now,fetch:async(url:RequestInfo|URL)=>{if(String(url).includes("/api/views/"))return Response.json({rowsUpdatedAt:1792454400});downloads++;return Response.json([raw]);}};
  try{
    await publishPerson(db,first);
    const before=await refreshCampaignMoneyState({...options,fetch:async(url:RequestInfo|URL)=>{
      if(!String(url).includes("/api/views/"))now="2026-10-20T00:20:00.000Z";
      return options.fetch(url);
    }});assert.equal(before.report.records[0].peopleWithMoney,0);assert.equal(downloads,1);
    const stateClock=await readCampaignMoneyStateWork(query,"WA");
    assert.equal(stateClock?.startedAt,at);assert.equal(stateClock?.checkedAt,now);
    assert.equal(campaignMoneyStateDue(stateClock,"2026-10-20T00:59:59.999Z"),false);
    assert.equal(campaignMoneyStateDue(stateClock,"2026-10-20T01:00:00.000Z"),true,"processing time must not move the next hourly scan");
    now="2026-10-20T01:00:00.000Z";
    await publishPerson(db,person);
    const next=await refreshCampaignMoneyState(options);assert.equal(next.report.records[0].peopleWithMoney,1);assert.equal(downloads,1);
    const read=await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id});assert.equal(read.records[0].person.name,person.name);
    assert.equal((await campaignMoneyWork(query,"WA",[person],"2026-10-20T23:00:00.000Z")).length,0);
    assert.equal((await campaignMoneyWork(query,"WA",[person],"2026-10-21T01:00:00.000Z")).length,1);
    now="2026-10-21T01:00:00.000Z";await refreshCampaignMoneyState(options);assert.equal((await db.query("SELECT count(*) AS count FROM fact WHERE field LIKE 'campaign-cycle:%'"))[0].count,1,"an unchanged daily check creates no new financial versions");assert.equal(downloads,1,"a new daily check reuses an unchanged provider release");
    await db.query("DELETE FROM fact WHERE entity_id=$1 AND field LIKE 'campaign-cycle:%'",[person.id]);
    assert.equal((await campaignMoneyWork(query,"WA",[person],"2026-10-21T02:00:00.000Z")).length,1,"a saved found flag cannot hide missing money");
    now="2026-10-21T02:00:00.000Z";await refreshCampaignMoneyState(options);
    assert.equal((await readCampaignFinanceForPlace(person.division,{query,personId:person.id})).records.length,1);
    assert.equal(downloads,1);
    await db.query("DELETE FROM civic_data_promotions WHERE current_version_id=$1",[person.id]);
    assert.equal((await readCampaignFinanceForPlace(person.division,{query,personId:person.id})).records.length,0);
    assert.equal((await stateCampaignEvidence([person.division],person.id,{query})).records.length,0);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});

test("the hourly coordinator drains all 56 state workers with one active at a time",async()=>{
  let active=0,peak=0;const visited:string[]=[];
  await runCampaignMoneyStates(async state=>{active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>setImmediate(resolve));visited.push(state);active--;});
  assert.equal(peak,1);assert.deepEqual(visited,CAMPAIGN_FINANCE_SOURCES.map(source=>source.state));
});

test("cycle donor totals name organizations and individuals over $200 and never serialize a small donor or address",async()=>{
  const db=await campaignDb(),source=campaignFinanceSource("SC").resources[0];
  const [native]=JSON.parse(await readFile(new URL("./fixtures/campaign-finance/sc-native-contributions.json",import.meta.url),"utf8"));
  const candidate:CampaignMoneyPerson={id:"sc-published-person",name:native.candidateName,office:native.officeName,seat:"ocd-division/country:us/state:sc/sldl:5#representative",division:"ocd-division/country:us/state:sc/sldl:5",incumbent:true,sourceUrl:"https://www.scstatehouse.gov/"};
  const base=bindCampaignMoney(campaignSourceRecord("SC",source,native,{...capture,url:source.url}),[candidate])!;
  assert.ok(base);
  const rows=[
    {...base,id:"SC:large1",amounts:[{label:"Contribution",amount:150}],donor:{key:"large",kind:"INDIVIDUAL" as const,filedName:"LARGE DONOR",amount:150}},
    {...base,id:"SC:large2",amounts:[{label:"Contribution",amount:150}],donor:{key:"large",kind:"INDIVIDUAL" as const,filedName:"LARGE DONOR",amount:150}},
    {...base,id:"SC:small",amounts:[{label:"Contribution",amount:200}],donor:{key:"small",kind:"INDIVIDUAL" as const,filedName:"SMALL DONOR PRIVATE",amount:200}},
    {...base,id:"SC:organization",amounts:[{label:"Contribution",amount:50}],donor:{key:"organization",kind:"COMMITTEE_OR_ORGANIZATION" as const,filedName:"FILED PAC",amount:50}},
  ];
  try{
    await publishPerson(db,candidate);
    await fileCampaignMoneyFacts(db,"SC",rows,at);
    await rebuildCampaignCycles(db,"SC",[candidate.id],at);
    const read=await readCampaignFinanceForPlace(candidate.division,{query:db.query});
    assert.equal(read.records[0].totals.find(total=>total.label==="Contribution")?.amount,550);
    assert.deepEqual(read.records[0].donors?.map(donor=>[donor.filedName,donor.amount]).sort(),[["FILED PAC",50],["LARGE DONOR",300]]);
    assert.doesNotMatch(JSON.stringify(read),/SMALL DONOR PRIVATE|transactionDate|qualifiers/);
    installFactReader(db.query);
    const {GET:campaignGET}=await import("../app/api/campaign-finance/route.ts");
    const {GET:personGET}=await import("../app/api/funding/[target]/route.ts");
    const response=await campaignGET(new Request(`${PUBLIC_SITE_ORIGIN}/api/campaign-finance?${new URLSearchParams({division:candidate.division,person:candidate.id})}`));
    assert.deepEqual((await response.json()).records,read.records);
    const personResponse=await personGET(new Request(`${PUBLIC_SITE_ORIGIN}/api/funding/${candidate.id}?${new URLSearchParams({division:candidate.division})}`),{params:Promise.resolve({target:candidate.id})});
    const personMoney=await personResponse.json();assert.equal(personMoney.kind,"state-cycle");assert.deepEqual(personMoney.data.records,read.records);
    const ask=await stateCampaignEvidence([candidate.division],candidate.id,{query:db.query});
    assert.match(ask.records[0].text,/LARGE DONOR: \$300|FILED PAC: \$50/);assert.doesNotMatch(JSON.stringify(ask),/SMALL DONOR PRIVATE/);
    await db.query("UPDATE fact SET status='superseded' WHERE field='campaign-money:SC:large2'");
    await rebuildCampaignCycles(db,"SC",[candidate.id],at);
    assert.doesNotMatch(JSON.stringify(await readCampaignFinanceForPlace(candidate.division,{query:db.query})),/LARGE DONOR/);
  }finally{installFactReader(undefined);await db.pg.close();}
});

test("the completed hourly pass uses the registered promotion door for its refresh clock",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const saved=await publishCampaignMoneyWork(store,vault,CAMPAIGN_MONEY_SCOPE,{kind:"campaign-finance-work-check",state:"US",resource:"people",records:[{
    id:"hourly",state:"US",checkedAt:at,publishedPeople:1,peopleWorked:1,peopleWithMoney:1,loaded:1,unmatched:0,reasons:{},peakMemoryBytes:1,
  }]},at);
  assert.ok(saved.outcome.promoted);assert.equal((await store.readPromotion("CAMPAIGN_FINANCE",CAMPAIGN_MONEY_SCOPE))?.versionId,saved.candidate.id);
});
