import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readHourlyVitalSigns, vitalSignsRow, VITAL_SIGNS_SQL } from "../lib/control-plane/admin-view/hourly-vital-signs.ts";
import { VitalSignsRow, BriefVitalSigns } from "../app/(admin)/_mw/admin-v6/vital-signs.tsx";
import { BriefParts } from "../app/(admin)/_mw/admin-v6/reports-view.tsx";
import { V6Context } from "../app/(admin)/_mw/admin-v6/context.tsx";
import { formatEasternSpan } from "../lib/control-plane/eastern-time.ts";
const saved = {hour:"2026-10-06T03:00:00Z",written_at:"2026-10-06T04:02:00Z",facts_live:12,facts_confirmed:3,facts_sampled:3,spend_usd:"3.000000",unpriced_charges:0,cost_per_fact_usd:".25",neon_bytes_read:"200000000",neon_bytes_by_caller:{"cp_work_items.read":150000000},neon_project_bytes:null,rounds_finished:2,rounds_killed:1,rounds_deferred:0,paid_jobs_ended_empty:1,paid_jobs_ended:4,release_sha:"abc123"};
// PostgreSQL numeric output has a leading zero.
saved.cost_per_fact_usd="0.25";
const row = vitalSignsRow(saved)!;
test("one bounded read takes only completed cp_vital_signs rows; missing hours remain unknown",async()=>{
 const calls:unknown[][]=[];
 const sql=Object.assign(async()=>[],{query:async(...args:unknown[])=>{calls.push(args);return [saved];}});
 const reading=await readHourlyVitalSigns(sql as never,"2026-10-06T04:30:00Z",2);
 assert.equal(calls.length,1);assert.equal(calls[0][0],VITAL_SIGNS_SQL);
 assert.deepEqual(calls[0][1],["2026-10-06T02:00:00.000Z","2026-10-06T04:00:00.000Z",2]);
 assert.equal(reading.hours[0].row?.factsLive,12);assert.equal(reading.hours[1].row,null);
 assert.doesNotMatch(VITAL_SIGNS_SQL,/cp_log_|cp_ledger|JOIN/);
 assert.match(VITAL_SIGNS_SQL,/written_at >= hour \+ interval '1 hour'/);
 const daily=await readHourlyVitalSigns(sql as never,"2026-10-06T04:30:00Z",24);assert.equal(daily.hours.length,24);
 assert.deepEqual(calls[1][1],["2026-10-05T04:00:00.000Z","2026-10-06T04:00:00.000Z",24]);
});
test("a partial hour, malformed charge, impossible sample or inconsistent cost is not a reading",()=>{
 assert.ok(row);
 for(const bad of [{...saved,cost_per_fact_usd:1},{...saved,facts_live:0},{...saved,written_at:"2026-10-06T03:50:00Z"},{...saved,spend_usd:undefined},{...saved,facts_confirmed:4},{...saved,rounds_finished:-1},{...saved,neon_bytes_by_caller:{source:-1}}])assert.equal(vitalSignsRow(bad),null);
 assert.equal(vitalSignsRow({...saved,facts_live:0,cost_per_fact_usd:null})?.factsLive,0);
 assert.equal(vitalSignsRow({...saved,unpriced_charges:1,cost_per_fact_usd:null})?.settledSpendUsd,null);
});
test("Now and the brief show measured signs, caller causes and Eastern hours from the same row",()=>{
 const html=renderToStaticMarkup(h(VitalSignsRow,{row}));
 for(const text of ["Facts live per hour","Cost per fact","Spend","Neon GB per hour","Rounds finished","Rounds killed","Work items","$0.25","$3.00","EDT","Paid jobs ending with nothing"])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/T03:00|Z<|UTC|MST/);
 const hours={hours:[{hour:row.hour,row}]};
 const daily=renderToStaticMarkup(h(V6Context.Provider,{value:{} as never},h(BriefParts,{brief:{day:"2026-10-06",createdAt:row.writtenAt,vitalSigns:hours,updates:[],problems:[],decisions:[],alerts:[],unread:[]}})));
 assert.ok(daily.includes(renderToStaticMarkup(h(BriefVitalSigns,{reading:hours}))));
 const unknown=renderToStaticMarkup(h(VitalSignsRow,{row:null}));
 assert.equal((unknown.match(/class="[^\"]*big[^\"]*">—/g)||[]).length,7);
 assert.match(formatEasternSpan("2026-11-01T05:00:00Z","2026-11-01T06:00:00Z"),/1:00 AM EDT.*1:00 AM EST/);
});
