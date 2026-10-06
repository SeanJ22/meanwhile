import assert from "node:assert/strict";
import {test} from "node:test";
import { readSpendSummary } from "../lib/control-plane/admin-view/spend-summary.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
const repos=(value:unknown,seen:unknown[])=>({ownerSnapshots:{readNarrowed:async(id:string,projection:unknown)=>{seen.push([id,projection]);return {value};},read:async()=>{throw new Error("Whole snapshot must not be read");}}}) as unknown as ControlPlaneRepositories;
test("Money reads only the runner-maintained summary, retains its actual timestamp, and has no raw-table fallback",async()=>{
 const seen:unknown[]=[];const summary={readAt:"2026-10-06T00:00:00Z",spend:{byDay:[],byMonth:[],byTier:[],setAsideUsd:1.25,neonProjects:[{project:"control-plane",day:"2026-10-05",requestBytes:10,responseBytes:20,requests:1,cause:null}]}};
 assert.deepEqual(await readSpendSummary(repos({spendSummary:summary},seen)),summary);assert.deepEqual(seen,[["current",{spendSummary:true}]]);
});
test("an older or malformed snapshot has no spending summary, not guessed zero or a raw-table read",async()=>{
 for(const value of [{},null,{spendSummary:{readAt:"invalid",spend:{}}}])assert.equal(await readSpendSummary(repos(value,[])),null);
});
