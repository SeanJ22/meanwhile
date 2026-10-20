import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { bindCampaignMoney, campaignRecordYear, type CampaignMoneyPerson } from "../lib/funding/state-people.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { CAMPAIGN_FINANCE_SOURCES, campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { publishCampaignFinanceResource } from "../lib/funding/state-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { readCampaignFinanceForPlace } from "../lib/funding/state-reader.ts";
import { stateCampaignEvidence } from "../lib/ask/state-campaign.ts";
import { factDb } from "./helpers/fact-db.ts";
import { renderCardWithSources } from "./helpers/render-card.ts";

const resource = campaignFinanceSource("WA").resources[0];
const [raw] = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/wa-native-excerpt.json",import.meta.url),"utf8"));
const at="2026-10-20T00:00:00.000Z", division="ocd-division/country:us/state:wa";
const capture={url:resource.url,rawHash:"a".repeat(64),vaultKey:"test",byteLength:10,retrievedAt:at,publicationDate:null};
const row=campaignSourceRecord("WA",resource,raw,capture);
const person:CampaignMoneyPerson={id:"published-person",name:raw.filer_name,seat:"seattle-judge",office:raw.office,division:division+"/place:seattle",incumbent:true,sourceUrl:"https://www.seattle.gov/courts"};

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

test("old collapsed, unbound and pre-2020 rows cannot reach cards or Ask; bound rows show cycle totals",async()=>{
  const db=await factDb();
  try {
    assert.equal((await fileCampaignMoneyFacts(db,"WA",[row],at)).written,0);
    const bound=bindCampaignMoney(row,[person])!;
    await fileCampaignMoneyFacts(db,"WA",[bound,{...bound,id:"WA:old",period:"2018"}],at);
    const read=await readCampaignFinanceForPlace(division,{query:db.query});
    assert.equal(read.records.length,1); assert.equal(read.records[0].cycle,2026);
    assert.deepEqual(read.records[0].totals.find(total=>total.label==="Contributions"),{label:"Contributions",amount:0});
    assert.equal('transactionDate' in read.records[0],false);
    const ask=await stateCampaignEvidence([division],person.id,{query:db.query});
    assert.equal(ask.records[0].subjectId,person.id); assert.match(ask.records[0].text,/2026 cycle/);
    const markup=await renderCardWithSources({modulePath:"./components/funding/state-campaign-section.tsx",exportName:"StateCampaignSection",props:{divisionId:division,data:{...read,nextCursor:null}},sourceUrls:[row.filingUrl]});
    assert.match(markup,/2026 cycle/); assert.doesNotMatch(markup,/Official filing source|Next filings/);
    await db.query(`INSERT INTO entity VALUES ('collapsed','committee','Wrong name','WA',$1,now())`,[division]);
    await db.query(`INSERT INTO entity_place VALUES ('collapsed',$1)`,[division]);
    assert.equal((await readCampaignFinanceForPlace(division,{query:db.query})).records.length,1);
  } finally {await db.pg.close();}
});

test("two ID-less filed committees remain distinct and a named committee never owns another person's money",async()=>{
  const db=await factDb();
  try {
    const first=bindCampaignMoney({...row,id:"WA:first",filerId:null,filerName:"First filed committee"},[person])!;
    const other={...person,id:"second-person",name:"Another Published Person",seat:"second-seat"};
    const second=bindCampaignMoney({...row,id:"WA:second",filerId:null,filerName:"Second filed committee",candidateName:other.name},[other])!;
    await fileCampaignMoneyFacts(db,"WA",[first,second],at);
    const committees=await db.query("SELECT name,parent_id FROM entity WHERE kind='committee' ORDER BY name");
    assert.deepEqual(committees,[{name:"First filed committee",parent_id:person.id},{name:"Second filed committee",parent_id:other.id}]);
    const read=await readCampaignFinanceForPlace(division,{query:db.query,personId:person.id});
    assert.equal(read.records.length,1);assert.equal(read.records[0].committee,"First filed committee");
  }finally{await db.pg.close();}
});

test("extracts without a supported candidate and office never start a money download",async()=>{
  let downloads=0;
  const refusal=async()=>{throw new Error("An unbound extract reached storage");};
  for(const state of ["AL","CO","DC","FL"]){
    const resource=campaignFinanceSource(state).resources[0];
    await assert.rejects(()=>publishCampaignFinanceResource(state,resource,{people:[],store:new MemoryRoutineDataStore(),
      facts:{query:refusal,transaction:refusal},vault:new MemoryEvidenceStore(),directory:"/tmp/unbound-campaign-test",signal:new AbortController().signal,
      fetch:async()=>{downloads++;throw new Error("An unbound extract was downloaded");}}),/no supported candidate and office binding/);
  }
  assert.equal(downloads,0);
});
