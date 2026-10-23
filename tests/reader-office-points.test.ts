import assert from "node:assert/strict";
import test from "node:test";
import {publicOfficePoints} from "../lib/reader/office-points.ts";
import type {ReaderStateResponse} from "../lib/reader/client.ts";
import {POST} from "../app/api/geocode/route.ts";

const holder={id:"congress:A000001",name:"Public Representative",officeTitle:"Representative"};
const directory={districtOffices:["100 Main Street","200 Main Street","P.O. Box 25","300 Capitol Street","400 Located Street"].map((address,index)=>({
  address,city:"Tucson",state:"AZ",zip:"85701",phone:null,lat:index===4?32:null,lng:index===4?-110:null})),committees:[],
  officeDetails:[0,1,2,3,4].map(index=>({officeKind:index===3?"CAPITOL":"DISTRICT",official:true,
    sourceUrl:"https://office.example.gov/contact",sourceOrg:"Official office directory",collectedAt:"2026-10-20"}))};
const state={coverage:{seats:[{ocdId:"ocd-division/country:us/state:az/cd:7",divisionType:"cd",representatives:[holder]}],senators:[]},
  memberDirectories:[{ids:[holder.id],directory},{ids:["elsewhere"],directory}]}as unknown as ReaderStateResponse;

test("only selected public street offices without held points are resolved; a stalled one cannot hold the answer",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const calls:string[]=[],signals:AbortSignal[]=[];
  const read=publicOfficePoints(state,async(address,signal)=>{
    calls.push(address);signals.push(signal);
    return address.startsWith("100") ? {lat:32,lng:-110} : new Promise(resolve=>signal.addEventListener("abort",()=>resolve(null),{once:true}));
  });
  await Promise.resolve();context.mock.timers.tick(450);
  assert.deepEqual(await read,{"100 Main Street, Tucson, AZ 85701":{lat:32,lng:-110}});
  assert.deepEqual(calls,["100 Main Street, Tucson, AZ 85701","200 Main Street, Tucson, AZ 85701"]);
  assert.ok(signals.every(signal=>signal.aborted));
  assert.equal(directory.districtOffices[0].lat,null,"Census points never become purported directory coordinates");
});

test("a canceled stateless geocode stops its upstream read and retains the private no-store response",async context=>{
  let upstream:AbortSignal|undefined;
  context.mock.method(globalThis,"fetch",async(_input:unknown,init:RequestInit)=>{
    upstream=init.signal!;
    return new Promise((_resolve,reject)=>upstream!.addEventListener("abort",()=>reject(new Error("Canceled")),{once:true}));
  });
  const controller=new AbortController();
  const result=POST(new Request("http://localhost/api/geocode",{method:"POST",body:JSON.stringify({address:"123 Example Street"}),signal:controller.signal}));
  for(let n=0;n<20&&!upstream;n++)await Promise.resolve();
  assert.ok(upstream);controller.abort();
  const response=await result;assert.equal(upstream.aborted,true);
  assert.deepEqual(await response.json(),{match:false});assert.match(response.headers.get("cache-control")!,/no-store/);
});
