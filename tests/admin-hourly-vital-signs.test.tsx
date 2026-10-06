import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isHourlyVitalSigns, readHourlyVitalSigns, type HourlyVitalSigns } from "../lib/control-plane/admin-view/hourly-vital-signs.ts";
import { VitalSignsRow } from "../app/(admin)/_mw/admin-v6/vital-signs.tsx";
import { BriefParts } from "../app/(admin)/_mw/admin-v6/reports-view.tsx";
import { V6Context } from "../app/(admin)/_mw/admin-v6/context.tsx";
import { formatEasternSpan } from "../lib/control-plane/eastern-time.ts";
const row: HourlyVitalSigns = {from:"2026-10-06T03:00:00Z",through:"2026-10-06T04:00:00Z",readAt:"2026-10-06T04:02:00Z",factsLive:12,factsLivePerHour:12,settledSpendUsd:3,costPerFactUsd:.25,neon:{gbPerHour:.2,causes:[{cause:"Saved work reads",gbPerHour:.15}]},rounds:{finished:2,killed:1}};
test("the reader takes exactly one narrowed saved hourly row and never loads raw tables", async()=>{
 const calls:unknown[]=[];
 const repos={ownerSnapshots:{readNarrowed:async(id:string,projection:unknown)=>{calls.push([id,projection]);return {value:{hourlyVitalSigns:row}};}}};
 assert.equal(await readHourlyVitalSigns(repos as never),row);
 assert.deepEqual(calls,[["current",{hourlyVitalSigns:true}]]);
 assert.equal(await readHourlyVitalSigns({ownerSnapshots:{readNarrowed:async()=>({value:{}})}} as never),null);
});
test("a row cannot claim price per fact without a measured denominator, or use a different hour",()=>{
 assert.equal(isHourlyVitalSigns(row),true);
 for(const bad of [{...row,costPerFactUsd:1},{...row,factsLive:0},{...row,factsLivePerHour:null},{...row,settledSpendUsd:null},{...row,through:"2026-10-06T05:00:00Z"},{...row,rounds:{finished:-1,killed:0}},{...row,neon:{gbPerHour:.2,causes:[{cause:"",gbPerHour:.1}]}}])assert.equal(isHourlyVitalSigns(bad),false);
 assert.equal(isHourlyVitalSigns({...row,factsLive:0,factsLivePerHour:0,costPerFactUsd:null}),true);
 assert.equal(isHourlyVitalSigns({...row,settledSpendUsd:null,costPerFactUsd:null,neon:null,rounds:null}),true);
});
test("Now's row and the daily brief use the same six measured signs and Eastern hour",()=>{
 const html=renderToStaticMarkup(h(VitalSignsRow,{row}));
 for(const text of ["Facts live per hour","Cost per fact","Spend","Neon GB per hour","Rounds finished","Rounds killed","Saved work reads","$0.25","$3.00","EDT"])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/T03:00|Z<|UTC|MST/);
 const brief={day:"2026-10-06",createdAt:row.readAt,vitalSigns:row,updates:[],problems:[],decisions:[],alerts:[],unread:[]};
 const daily=renderToStaticMarkup(h(V6Context.Provider,{value:{} as never},h(BriefParts,{brief})));
 assert.ok(daily.includes(html));
 const unknown=renderToStaticMarkup(h(VitalSignsRow,{row:null}));
 assert.equal((unknown.match(/class="[^\"]*big[^\"]*">—/g)||[]).length,6);
 assert.match(formatEasternSpan("2026-11-01T05:00:00Z","2026-11-01T06:00:00Z"),/1:00 AM EDT.*1:00 AM EST/);
});
