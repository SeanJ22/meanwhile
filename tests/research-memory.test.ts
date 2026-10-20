import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { type ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { nativeAbortLine } from "../lib/ops/fatal-line.ts";
import { databaseReadsOf } from "../lib/control-plane/admin-view/v6-workers-read.ts";

const capture = (i: number) => ({ artifactId: `art-${i}`, workItemId: `wi-${i % 7}`, attemptId: `at-${i}`, partial: i % 5 === 0,
  canonicalUrl: `https://county.example.gov/agenda/${i}`, recordedAt: "2026-10-13T18:00:00.000Z",
  extraction: { text: "x".repeat(4_000), complete: true }, contentHash: "h".repeat(64) }) as unknown as ArtifactRecord;

test("system upkeep selects the latest Scout per subject across logs without whole-country arrays", async () => {
  const { forEachLatestScout } = await import("../lib/control-plane/workers/streamed-history.ts");
  const repos = createMemoryRepositories();
  const result = (subjectId: string, recordedAt: string, outcome: string) => ({ subjectId, recordedAt, outcome, recordClass: "OFFICIAL_ROSTER", findings: [{summary:"x".repeat(4_000)}] }) as unknown as import("../lib/control-plane/scheduler/scout-result.ts").ScoutResult;
  await repos.scoutResults.append("a-new", "new", result("same-place","2026-10-20T12:00:00Z","EVIDENCE_FOUND"),"2026-10-20T12:00:00Z");
  await repos.scoutResults.append("z-old", "old", result("same-place","2026-10-19T12:00:00Z","NEEDS_ADAPTER"),"2026-10-20T12:00:00Z");
  for (let i=0;i<600;i++) await repos.scoutResults.append(`other-${i}`,`${i}`,result(`place-${i}`,"2026-10-18T12:00:00Z","EVIDENCE_FOUND"),"2026-10-20T12:00:00Z");
  let pageReads=0, visited=0; const selected: string[]=[];
  const original = repos.scoutResults.readChangedSince.bind(repos.scoutResults);
  const bounded = {...repos.scoutResults,
    readAll: async () => { throw new Error("whole-country results"); },
    keys: async () => { throw new Error("country log keys"); },
    readChangedSince: async (...args: Parameters<typeof original>) => { assert.equal(typeof args[2]?.page,"function"); pageReads++; return original(...args); },
  };
  await forEachLatestScout(bounded, async row => { visited++; if(row.subjectId==="same-place") selected.push(row.outcome); });
  assert.equal(pageReads,1); assert.equal(visited,601); assert.deepEqual(selected,["EVIDENCE_FOUND"],"an older result in a later log cannot reopen a completed adapter job");
});

test("capture scheduling preserves recorded-time order on temporary disk and stops at its admitted place", async () => {
  const { forEachRecorded } = await import("../lib/control-plane/workers/streamed-history.ts");
  const repos = createMemoryRepositories();
  for (const [key,at] of [["a","2026-10-20T12:00:00Z"],["z","2026-10-18T12:00:00Z"],["y","2026-10-19T12:00:00Z"]]) {
    const record={...capture(1),artifactId:key,recordedAt:at}; await repos.artifacts.append(key,key,record,at);
  }
  const visited:string[]=[];
  await forEachRecorded({...repos.artifacts,readAll:async()=>{throw new Error("whole-country captures");}}, row=>{visited.push(row.artifactId);if(visited.length===2)return false;});
  assert.deepEqual(visited,["z","y"]);
});

test("upkeep fetches changes after its first pass while revisiting unchanged pending subjects and preserving log-order ties", async () => {
  const { forEachLatestScout } = await import("../lib/control-plane/workers/streamed-history.ts");
  const since:(string|null)[]=[],outcomes:string[]=[];let pass=0;
  const row=(outcome:string)=>({subjectId:"az:one",recordClass:"OFFICIAL_ROSTER",recordedAt:"2026-10-20T12:00:00Z",outcome}) as unknown as import("../lib/control-plane/scheduler/scout-result.ts").ScoutResult;
  const log={readChangedSince:async(after:string|null,_held:unknown,options:{page:(rows:unknown[])=>Promise<void>|void})=>{
    since.push(after);const current=pass++;
    if(current<2)await options.page([{key:current===0?"z":"a",position:0,record:row(current===0?"NEEDS_ADAPTER":"EVIDENCE_FOUND")}]);
    return{records:[],through:`2026-10-20T12:0${current+1}:00.000Z`};
  }} as unknown as import("../lib/control-plane/repository/types.ts").AppendOnlyRepository<import("../lib/control-plane/scheduler/scout-result.ts").ScoutResult>;
  for(let i=0;i<3;i++)await forEachLatestScout(log,async result=>{outcomes.push(result.outcome);});
  assert.deepEqual(since,[null,"2026-10-20T12:00:00.000Z","2026-10-20T12:01:00.000Z"]);
  assert.deepEqual(outcomes,["NEEDS_ADAPTER","NEEDS_ADAPTER","NEEDS_ADAPTER"],"pending upkeep runs each pass; a late append under an earlier key cannot win an exact recorded-time tie");
});

test("a native abort's own line leads the heartbeat's error, ahead of its stack and the workers' disconnects", () => {
  const stderr = ["<--- Last few GCs --->", "[1203:0x6a3c000]  431211 ms: Mark-Compact 4034.1 (4130.4) -> 4021.8 (4131.6) MB",
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", "----- Native stack trace -----", "",
    ...Array.from({ length: 10 }, (_, i) => `${String(i + 1).padStart(2)}: 0x${(0xf14a4a + i).toString(16)}  [/usr/bin/node]`),
    ...Array(4).fill("LEASE_WORKER_BROKER_DISCONNECTED")].join("\n");
  assert.equal(nativeAbortLine(stderr), "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");
  assert.equal(nativeAbortLine("Error: ordinary failure\n    at main (file.ts:1:1)"), null);
});

test("Admin reads the runner's database bytes for its last full hour, largest callers first", () => {
  const reading = databaseReadsOf({ hour: "2026-10-13T18:00:00.000Z", controlPlaneBytes: 366_170_703, readerBytes: 226_549_568, requests: 92_420, processCount: 533,
    byCaller: [{ caller: "cp_log_costs.readSince ← scripts/freshness-shadow.mts:1681", bytes: 94_768_773 }, { caller: "", bytes: 1 }, { caller: "other", bytes: 104_789_140 }] });
  assert.deepEqual(reading?.byCaller.map(row => row.bytes), [94_768_773, 104_789_140]);
  assert.equal(reading?.controlPlaneBytes, 366_170_703);
  assert.equal(databaseReadsOf(null), null);
  assert.equal(databaseReadsOf({ hour: "not a time" }), null);
});
