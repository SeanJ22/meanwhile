import assert from "node:assert/strict";
import test from "node:test";
import { factClocks,FRESHNESS_HOURS_DEFAULT } from "../lib/facts/clocks.ts";
import { FIELD_KINDS } from "../lib/facts/check.ts";
import { readHeldFactClocks,HELD_FACT_CLOCKS_SQL } from "../lib/control-plane/scheduler/providers/held-subject-progress.ts";
import { campaignMoneyEveryMs,campaignMoneyStateNextDue,observeCampaignProvider,type CampaignStateClock } from "../lib/funding/state-cadence.ts";
import { campaignMoneyStateDue } from "../lib/funding/state-people.ts";
import { CAMPAIGN_FINANCE_PARSER } from "../lib/funding/state-sources.ts";

const DAY=86_400_000,at="2026-10-01T00:00:00.000Z",later=(days:number)=>new Date(Date.parse(at)+days*DAY).toISOString();
const first:CampaignStateClock={startedAt:at,completedAt:at,sourceDescriptorHash:"actual native resources",sourceComplete:true,
  ...observeCampaignProvider(null,{rawHash:"a".repeat(64),descriptorHash:"actual native resources",checkedAt:at,complete:true})};

test("actual provider bytes and complete checks teach only their own source clock",()=>{
  const unchanged={...first,...observeCampaignProvider(first,{rawHash:"a".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(4),complete:true})};
  assert.equal(unchanged.providerChanges,0);assert.equal(campaignMoneyEveryMs(unchanged),4*DAY);
  const changed={...unchanged,...observeCampaignProvider(unchanged,{rawHash:"b".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(6),complete:true})};
  assert.equal(changed.providerChanges,1);assert.equal(changed.providerChangedAt,later(6));assert.equal(campaignMoneyEveryMs(changed),6*DAY);
  const reverted={...changed,...observeCampaignProvider(changed,{rawHash:"a".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(8),complete:true})};
  assert.equal(reverted.providerChanges,2,"returning to earlier bytes is another actual movement");
  assert.equal(campaignMoneyEveryMs(reverted),4*DAY);
  assert.deepEqual(observeCampaignProvider(changed,{rawHash:"c".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(7),complete:false}),
    observeCampaignProvider(changed,{descriptorHash:"",checkedAt:at,complete:false}),"an interrupted or failed acquisition cannot invent a completed provider observation");
  const reset=observeCampaignProvider({...changed,providerParserVersion:"old parser"},{rawHash:"b".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(8),complete:true});
  assert.equal(reset.providerChanges,0);assert.equal(reset.providerParserVersion,CAMPAIGN_FINANCE_PARSER);
});

test("Admin money settings bound state work, source cache reuse and failed attempts",async()=>{
  const defaults=factClocks(null),retry=Object.fromEntries(FIELD_KINDS.map(kind=>[kind,kind==="money"?3*1440:defaults.retryMinutes(kind)]));
  const clocks=await readHeldFactClocks(async sql=>{assert.equal(sql,HELD_FACT_CLOCKS_SQL);return[{freshness_hours:{...FRESHNESS_HOURS_DEFAULT,money:5*24},retry_minutes:retry}];});
  assert.equal(clocks.retryMinutes("money"),3*1440);assert.equal(campaignMoneyEveryMs(first,clocks),3*DAY);
  const quiet={...first,...observeCampaignProvider(first,{rawHash:"a".repeat(64),descriptorHash:first.sourceDescriptorHash!,checkedAt:later(30),complete:true})};
  assert.equal(campaignMoneyEveryMs(quiet,clocks),5*DAY,"the source remains inside the actual money freshness window");
  assert.equal(campaignMoneyStateDue(first,later(2),clocks),false);assert.equal(campaignMoneyStateDue(first,later(3),clocks),true);
  const failure={...quiet,startedAt:later(31),sourceFailedAt:later(31),sourceComplete:false};
  assert.equal(campaignMoneyEveryMs(failure,clocks),3*DAY);assert.equal(campaignMoneyStateNextDue(failure,later(32),clocks),Date.parse(later(34)));
});

test("successful native acquisition cutoffs resume without freshening provider dates or masking outages",()=>{
  const cut={...first,startedAt:later(1),completedAt:later(1),sourceComplete:false,continuationPending:true};
  assert.equal(campaignMoneyStateDue(cut,later(1)),true);
  assert.equal(cut.providerCheckedAt,at);
  const failed={...cut,sourceFailedAt:later(1)};
  assert.equal(campaignMoneyStateDue(failed,later(1)),false);assert.equal(campaignMoneyStateDue(failed,later(2)),true);
  const localRetry={...failed,startedAt:later(1.25),completedAt:later(1.25)};
  assert.equal(campaignMoneyStateDue(localRetry,later(1.25)),false,"a local replay does not recover a real source outage");
  assert.equal(campaignMoneyStateDue({startedAt:at},later(0.1)),false,"legacy clock rows retain the installed/fact-floor pace");
});
