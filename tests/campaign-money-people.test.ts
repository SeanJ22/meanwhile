import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { bindCampaignMoney, campaignRecordYear, type CampaignMoneyPerson } from "../lib/funding/state-people.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { CAMPAIGN_FINANCE_SOURCES, campaignFinanceSource } from "../lib/funding/state-sources.ts";

const resource = campaignFinanceSource("WA").resources[0];
const [raw] = JSON.parse(await readFile(new URL("./fixtures/campaign-finance/wa-native-excerpt.json",import.meta.url),"utf8"));
const at="2026-10-20T00:00:00.000Z",division="ocd-division/country:us/state:wa";
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
