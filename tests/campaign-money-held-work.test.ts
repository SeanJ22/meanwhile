import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { campaignDb,publishMoneyFixture } from "./helpers/campaign-money-db.ts";
import { refreshCampaignMoneyState } from "../lib/funding/state-publication.ts";
import { readCampaignMoneyAdmission } from "../lib/funding/state-local-work.ts";
import { readCampaignMoneyStateWork,campaignMoneyStateDue,type CampaignMoneyPerson } from "../lib/funding/state-people.ts";
import { readCampaignFinanceForPlace } from "../lib/funding/state-reader.ts";
import { campaignMoneyStateNextDue } from "../lib/funding/state-cadence.ts";

const at="2026-10-20T00:00:00.000Z",hour="2026-10-20T01:00:00.000Z",repairAt="2026-10-20T01:05:00.000Z";
const [native]=JSON.parse(await readFile(new URL("./fixtures/campaign-finance/wa-native-excerpt.json",import.meta.url),"utf8"));
const division="ocd-division/country:us/state:wa/place:seattle";
const person:CampaignMoneyPerson={id:"new-held-money-person",name:"Anita Crawford-Willis",seat:division+"#judge",office:native.office,division,incumbent:true,sourceUrl:"https://www.seattle.gov/courts"};
const other={...person,id:"already-published-person",name:"Another Published Person",seat:division+"#another-judge"};
async function publishRoster(db:Awaited<ReturnType<typeof campaignDb>>,people:readonly CampaignMoneyPerson[]){
  await publishMoneyFixture(db,{recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-WA",payload:{bodyRosters:people.map(person=>({bodyId:person.seat,sourceUrl:person.sourceUrl,
    members:[{id:person.id,name:person.name,officeTitle:person.office}]}))}});
}

test("new people and missing derived cycles use exact held filings before the provider floor, including after local cache loss",async()=>{
  const db=await campaignDb(),vault=new MemoryEvidenceStore(),directory=await mkdtemp(join(tmpdir(),"campaign-held-repair-"));
  let now=at,requests=0;
  const fetchImpl:typeof fetch=async url=>{requests++;return Response.json(String(url).includes("/api/views/")?{rowsUpdatedAt:1792454400}:[{...native,contributions_amount:"100"}]);};
  const options={state:"WA",facts:db,query:db.query,vault,directory,now:()=>now,fetch:fetchImpl};
  const guarded:typeof fetch=async()=>{throw Error("a held repair polled the provider");};
  try{
    await publishRoster(db,[other]);await refreshCampaignMoneyState(options);
    const sourceRequests=requests;assert.equal(sourceRequests,2);
    now=hour;await publishRoster(db,[other,person]);
    const due=await readCampaignMoneyAdmission(db.query,now,undefined,["WA"]);
    assert.equal(due.providerDue,false);assert.equal(due.localDue,true,"a newly published binding is immediately admitted from held source bytes");
    assert.equal(campaignMoneyStateDue(await readCampaignMoneyStateWork(db.query,"WA"),now),false);
    await rm(join(directory,"WA"),{recursive:true,force:true});
    const result=await refreshCampaignMoneyState({...options,heldOnly:true,fetch:guarded});
    assert.equal(result.report.records[0].providerCheckedAt,at);assert.equal(result.report.records[0].providerChanges,0);
    const published=(await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records;
    assert.equal(published[0]?.totals.find(total=>total.label==="Contributions")?.amount,100);
    assert.ok(published[0].sources.every(source=>source.checkedAt===at),"local publication preserves original provider dates");
    assert.equal(requests,sourceRequests);
    const providerDeadline=campaignMoneyStateNextDue(result.report.records[0],now);
    await db.query("DELETE FROM fact WHERE entity_id=$1 AND field LIKE 'campaign-cycle:%'",[person.id]);
    now=repairAt;
    const repair=await readCampaignMoneyAdmission(db.query,now,undefined,["WA"]);
    assert.equal(repair.providerDue,false);assert.equal(repair.localDue,true);
    const query:typeof db.query=async(text,params)=>{assert.doesNotMatch(text,/WITH people AS MATERIALIZED|SELECT DISTINCT wanted.id,wanted.seat/);return db.query(text,params);};
    const fixed=await refreshCampaignMoneyState({...options,query,facts:{...db,query},heldOnly:true,fetch:guarded});
    assert.equal((await readCampaignFinanceForPlace(person.division,{query:db.query,personId:person.id})).records.length,1);
    assert.equal(fixed.report.records[0].providerCheckedAt,at);
    assert.equal(campaignMoneyStateNextDue(fixed.report.records[0],now),providerDeadline,"derived repair does not postpone the actual provider check");
    assert.equal(requests,sourceRequests);
    const settled=await readCampaignMoneyAdmission(db.query,now,undefined,["WA"]);
    assert.equal(settled.providerDue,false);assert.equal(settled.localDue,false);
  }finally{await db.pg.close();await rm(directory,{recursive:true,force:true});}
});
