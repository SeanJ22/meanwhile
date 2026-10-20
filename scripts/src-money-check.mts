import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { CAMPAIGN_FINANCE_SOURCES } from "../lib/funding/state-sources.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { readCampaignMoneyPeople } from "../lib/funding/state-people.ts";
import { readCampaignFinanceForPlace } from "../lib/funding/state-reader.ts";
import { campaignFinanceRecordText } from "../lib/funding/state-view.ts";
import { stateCampaignEvidence } from "../lib/ask/state-campaign.ts";

const state = process.argv.find(arg => arg.startsWith("--state="))?.slice(8);
const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("A production readonly handle is required.");
process.env.DATABASE_URL=connection;
process.env.WTP_DB_ROLE="production";
process.env.WTP_VITAL_SIGNS_REPORT="1";
if (state) {
  const sql=neon(connection), query=async(text:string,params:readonly unknown[]=[]) => await sql.query(text,[...params]) as Record<string,unknown>[];
  const [role]=await query("SELECT current_user,has_table_privilege(current_user,'fact','INSERT,UPDATE,DELETE') AS can_write");
  assert.equal(role.current_user,"readonly");assert.equal(role.can_write,false);
  const started=performance.now(), people=await readCampaignMoneyPeople(query,state);
  const [held]=await query(`SELECT count(*) AS rows,count(*) FILTER (WHERE f.value->'person' IS NULL) AS unbound,
    count(*) FILTER (WHERE f.value->'person' IS NOT NULL) AS bound
    FROM entity e JOIN fact f ON f.entity_id=e.id AND f.status='live' AND f.field LIKE 'campaign-money:%'
    WHERE e.state=$1 AND e.kind='committee'`,[state]);
  const place=US_JURISDICTIONS.find(place=>place.usps===state)!;
  const division=`ocd-division/country:us/${place.prefix}:${place.slug}`;
  const readStart=performance.now(),read=await readCampaignFinanceForPlace(division,{query}),readerMs=performance.now()-readStart;
  const ask=await stateCampaignEvidence([division],undefined,{query});
  assert.equal(ask.records.length,read.records.reduce((n,row)=>n+row.sources.length,0));
  assert.ok(read.records.every(row=>row.cycle>=2020 && row.person.id && row.person.seat));
  let apiMs:number|null=null;
  if (["DC","FL","CO","AZ"].includes(state)) {
    const {GET}=await import("../app/api/campaign-finance/route.ts");
    const start=performance.now(),response=await GET(new Request(`http://localhost/api/campaign-finance?division=${encodeURIComponent(division)}`));
    const value=await response.json();apiMs=performance.now()-start;
    assert.equal(response.status,200);assert.deepEqual(value.records,read.records);
    assert.ok(apiMs<3000 && readerMs<3000,`${state}: money reads exceeded three seconds`);
  }
  console.log(JSON.stringify({state,publishedPeople:new Set(people.map(person=>person.id)).size,publishedSeats:people.length,
    peopleWithMoney:new Set(read.records.map(row=>row.person.id)).size,rowsLoaded:Number(held.rows),rowsJoined:Number(held.bound),
    rowsUnmatched:Number(held.unbound),reason:Number(held.unbound)?"No verified published-person and seat binding":"No unbound native rows held",
    readerMs,apiMs,readerText:read.records.map(campaignFinanceRecordText),status:read.status,
    elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024}));
} else {
  const from=process.argv.find(arg=>arg.startsWith("--from="))?.slice(7);
  const rows:Record<string,unknown>[]=from ? JSON.parse(await readFile("/tmp/src-mn-production-results.json","utf8")).rows : [];
  for(const source of CAMPAIGN_FINANCE_SOURCES.slice(from ? CAMPAIGN_FINANCE_SOURCES.findIndex(source=>source.state===from) : 0)){
    const child=spawnSync(process.execPath,["--experimental-strip-types","--import","./scripts/register-test-loader.mjs",import.meta.filename,`--state=${source.state}`],{encoding:"utf8",env:process.env});
    if(child.status!==0)throw new Error(`${source.state}: ${child.stderr.slice(-1500)}`);
    rows.push(JSON.parse(child.stdout.trim().split("\n").at(-1)!));
    console.log(JSON.stringify(rows.at(-1)));
    await writeFile("/tmp/src-mn-production-results.json",JSON.stringify({at:new Date().toISOString(),rows},null,2));
  }
  await writeFile("/tmp/src-mn-production-results.json",JSON.stringify({at:new Date().toISOString(),rows},null,2));
}
