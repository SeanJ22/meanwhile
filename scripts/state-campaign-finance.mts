import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {runCampaignMoneyStates} from "../lib/funding/state-sources.ts";
import { assertRegisteredRuntimeContract, admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import {campaignMoneyStateDue,readCampaignMoneyStateWork} from "../lib/funding/state-people.ts";
import {readerFactDb} from "../lib/facts/db.ts";
import {prepareProductionCivicDataWrite} from "../lib/civic-data/production-write.ts";
import { fileURLToPath,pathToFileURL } from "node:url";

async function main(){
if(process.argv.slice(2).join(" ")!=="--promote")throw new Error("Campaign money requires its registered coordinator invocation");
assertRegisteredRuntimeContract("campaign-money","routine");
prepareProductionCivicDataWrite();
const facts=readerFactDb();
let published=0,worked=0,found=0,loaded=0,unmatched=0,peak=0;
const failures:Record<string,number>={};
await runCampaignMoneyStates(async state=>{
  const held=await readCampaignMoneyStateWork(facts.query,state);
  if(!campaignMoneyStateDue(held,new Date().toISOString())){
    published+=held?.publishedPeople??0;found+=held?.peopleWithMoney??0;return;
  }
  const child=spawn(process.execPath,["--max-old-space-size=112","--max-semi-space-size=4","--experimental-strip-types",fileURLToPath(new URL("../lib/funding/state-publication.ts",import.meta.url)),`--state=${state}`],{stdio:["ignore","pipe","inherit"],env:admittedRuntimeChildEnvironment({capability:"ROUTINE_CONTRACT",contract:"campaign-money"})});
  const exited=new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  let reported=false;
  for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
    if(line.startsWith("CAMPAIGN_MONEY_STATE=")){
      const report=JSON.parse(line.slice("CAMPAIGN_MONEY_STATE=".length));
      published+=report.publishedPeople;worked+=report.peopleWorked;found+=report.peopleWithMoney;loaded+=report.loaded;unmatched+=report.unmatched;peak=Math.max(peak,report.peakMemoryBytes+process.memoryUsage().rss);reported=true;
    }
    console.log(line);
  }
  const status=await exited;
  if(status!==0 || !reported){const reason=`${state} state worker failed (${status})`;failures[reason]=1;console.error(reason);}
});
const [{PostgresRoutineDataStore},{rawCaptureVault},{CAMPAIGN_MONEY_SCOPE,CAMPAIGN_MONEY_SOURCE_ID},{printSourceRunnerReceipt}]=await Promise.all([
  import("../lib/civic-data/store.ts"),import("../lib/civic-data/raw-capture-remote.ts"),
  import("../lib/funding/state-sources.ts"),import("../lib/civic-data/runner-receipt.ts"),
]);
const at=new Date().toISOString();
const {publishCampaignMoneyWork}=await import("../lib/funding/work-publication.ts");
const publication=await publishCampaignMoneyWork(new PostgresRoutineDataStore(),rawCaptureVault(),CAMPAIGN_MONEY_SCOPE,{kind:"campaign-finance-work-check",state:"US",resource:"people",records:[{
  id:"hourly",state:"US",checkedAt:at,publishedPeople:published,peopleWorked:worked,peopleWithMoney:found,loaded,unmatched,reasons:failures,peakMemoryBytes:Math.max(peak,process.resourceUsage().maxRSS*1024),
}]},at);
printSourceRunnerReceipt(CAMPAIGN_MONEY_SOURCE_ID,publication.candidate,publication.outcome);
await new Promise<void>(resolve=>process.stdout.write("",()=>resolve()));
process.exit(0);

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
