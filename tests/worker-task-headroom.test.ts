import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { taskIdentityQueue } from "../lib/control-plane/workers/task-identity-queue.ts";
import { runLeaseWorkerProcesses } from "../lib/control-plane/workers/process-pool.ts";
import { readHunterQueue, writeHunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";

test("disk task identities preserve global priority across bounded pages and completed tasks never rejoin", async () => {
  const queue = taskIdentityQueue(Array.from({ length: 1_025 }, (_, i) => String(i)), ["funded:NH"]);
  let largest = 0;
  const order = async (ids: readonly string[]) => { largest = Math.max(largest, ids.length); return [...ids].sort((a, b) => Number(b) - Number(a)); };
  try {
    const ids = await Promise.all(Array.from({ length: 4 }, () => queue.claim(order)));
    assert.deepEqual(ids.sort(), ["1021", "1022", "1023", "1024"]);
    assert.ok(largest <= 512);
    assert.equal(queue.isFunded("funded:NH"), true);
    assert.equal(queue.isFunded("unfunded:AZ"), false);
    for (const id of ids) queue.finish(id!);
    queue.add(["1024", "1025"]);
    assert.equal(queue.count(), 1_022);
    assert.equal(await queue.claim(order), "1025");
  } finally { queue.close(); }
});

test("lease workers receive one handout, stream every exact report and return only folded totals", async () => {
  const root = await mkdtemp(join(tmpdir(), "rh01-task-handouts-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `
      import assert from 'node:assert/strict';
      const replies=new Map();let sequence=0;
      const call=(kind,body)=>new Promise((resolve,reject)=>{const id=String(++sequence);replies.set(id,{resolve,reject});process.send({kind,id,body});});
      process.on('message', message=>{
        if(message.id){const reply=replies.get(message.id);replies.delete(message.id);message.error?reply.reject(Error(message.error.message)):reply.resolve(message.body);return;}
        void(async()=>{
          assert.equal(message.taskIds.length,1);assert.deepEqual(message.fundedSubjects,[]);assert.equal(message.nationalPlaces,undefined);
          let id=message.taskIds[0];
          while(id!==null){
            assert.equal(await call('accept-task',id),true);
            process.send({kind:'task-start',body:id});
            assert.equal(await call('funded-subject','subject:'+id),id==='599');
            process.send({kind:'result',body:{routeTaskId:id,obligationId:id,attemptId:'attempt:'+id,outcome:'WORKED',claimed:true,worker:null,detail:'x'.repeat(16384)}});
            id=await call('next-task',null);
          }
          process.send({kind:'finished',body:[]});process.disconnect();
        })().catch(error=>{console.error(error);process.exitCode=1;process.disconnect();});
      });`);
    let reports = 0, first: string | null = null, largest = 0, policyReads = 0;
    const seen = new Set<string>();
    const summary = await runLeaseWorkerProcesses({ entry: "worker.mjs", config: { root, postgres: false,
      taskIds: Array.from({ length: 600 }, (_, i) => String(i)), fundedSubjects: [], modelEnabled: false, searchEnabled: false,
      get ceilingUsd() { return ++policyReads; } },
      capacity: () => 4, transportFor: () => async () => { throw new Error("no model"); },
      isFundedSubject: subject => subject === "subject:599",
      orderPending: async ids => { largest = Math.max(largest, ids.length); return [...ids].sort((a, b) => Number(b) - Number(a)); },
      onDispatched: async result => { first ??= result.routeTaskId; assert.ok(result.routeTaskId); assert.equal(seen.has(result.routeTaskId), false);
        seen.add(result.routeTaskId); reports++; await new Promise(resolve => setImmediate(resolve)); } });
    assert.ok(Number(first) >= 596, "the four first handouts carry the global highest priorities; completion order is independent");
    assert.equal(reports, 600);
    assert.ok(policyReads >= 4, "each admitted child reads the owner's current policy getter");
    assert.ok(largest <= 512);
    assert.deepEqual(summary, { dispatched: 600, attempted: 600, worked: 600, scoutsAdmitted: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("hunter queue disk snapshots leave the public path replaceable and are removed when the wave closes", async context => {
  const root = await mkdtemp(join(tmpdir(), "rh01-hunter-queue-"));
  const path = join(root, "queue.sqlite");
  const databasePaths = new Set<string>();
  const prepare = DatabaseSync.prototype.prepare;
  context.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    const database = prepare.call(this, "PRAGMA database_list").get();
    databasePaths.add(String(database?.file));
    return prepare.call(this, sql);
  });
  const snapshots: string[] = [];
  try {
    writeHunterQueue(path, { writtenAt: "first", taskIds: Array.from({ length: 20_000 }, (_, i) => String(i)), plainTaskIds: ["1", "19999"] });
    databasePaths.clear();
    const held = readHunterQueue(path); assert.ok(!("unread" in held));
    try {
      snapshots.push(...databasePaths);
      assert.equal(databasePaths.has(path), false, "a Windows SQLite handle must never lock the public queue");
      assert.ok(snapshots.length && snapshots.every(file => basename(dirname(file)).startsWith("meanwhile-hunter-queue-")));
      assert.equal(held.taskIds.length, 20_000);
      assert.equal(Array.isArray(held.taskIds), false);
      assert.equal(held.rank("19999"), 20_000);
      writeHunterQueue(path, { writtenAt: "second", taskIds: ["20000"], plainTaskIds: [] });
      databasePaths.clear();
      const newer = readHunterQueue(path); assert.ok(!("unread" in newer));
      try { snapshots.push(...databasePaths); assert.equal(databasePaths.has(path), false);
        assert.deepEqual([...newer.taskIds], ["20000"]); assert.equal(held.isPlain("19999"), true);
        assert.deepEqual([...held.plainTaskIds], ["1", "19999"]); } finally { newer.close(); }
    } finally { held.close(); }
    for (const snapshot of snapshots) { assert.equal(existsSync(snapshot), false); assert.equal(existsSync(dirname(snapshot)), false); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
