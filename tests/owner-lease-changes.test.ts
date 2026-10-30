import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OWNER_LEASE_CHANGES_DDL, OWNER_LEASE_RENEWAL_DDL } from "../lib/control-plane/repository/owner-lease-changes.ts";
import { pgOwnerAssignmentChanges } from "../lib/control-plane/repository/owner-assignment-changes.ts";
import { claim, heartbeat, isExpired } from "../lib/control-plane/attempt.ts";

const db=new PGlite();
after(()=>db.close());

test("native assignment changes deduplicate source slots and retain semantic lease and overlapping cursors",async()=>{
  const now=Date.now(),at=(offset:number)=>new Date(now+offset).toISOString(),lease=claim("route","worker",at(-30_000),120_000,null);
  for(const name of["obligations","occurrences_history","debts","ask_gap_observations","work_items_history","route_tasks_history","attempts","leases"])
    await db.exec(`CREATE TABLE cp_${name}(id text PRIMARY KEY,revision bigint NOT NULL,changed_at timestamptz NOT NULL,value jsonb NOT NULL)`);
  for(const name of["artifacts","worker_results","scout_results"])await db.exec(`CREATE TABLE cp_log_${name}(log_key text,position bigint,changed_at timestamptz NOT NULL,record jsonb NOT NULL,PRIMARY KEY(log_key,position))`);
  await db.exec("CREATE TABLE cp_owner_assignment_rows(id text PRIMARY KEY,state_code text NOT NULL,members jsonb NOT NULL)");
  await db.query("INSERT INTO cp_owner_assignment_rows VALUES('assignment','az','[\"wi\"]')");
  for(const id of["route","replacement-route"])await db.query("INSERT INTO cp_route_tasks_history VALUES($1,1,$2,$3::jsonb)",[id,at(-30_000),JSON.stringify({workItemId:"wi"})]);
  await db.query("INSERT INTO cp_leases VALUES('lease',7,$1,$2::jsonb)",[at(-30_000),JSON.stringify(lease)]);
  for(const statement of OWNER_LEASE_CHANGES_DDL)await db.exec(statement);
  await db.exec(OWNER_LEASE_RENEWAL_DDL);
  const changes=pgOwnerAssignmentChanges({query:async(text,params=[])=> (await db.query(text,[...params])).rows});
  let previous=await changes.read({through:null,cursors:{},slackMs:120_000});
  const first=previous.cursors.leases.held.find(([id])=>id==="lease")!;
  assert.equal(first[1],7,"existing CAS revisions seed the semantic cursor without rewriting old leases");assert.equal(first[2],at(-30_000));
  const read=async()=>previous=await changes.read({through:previous.through,cursors:previous.cursors,slackMs:120_000});
  const renewed=heartbeat(lease,at(0),120_000);
  await db.query("UPDATE cp_leases SET revision=8,changed_at=now(),value=$1::jsonb",[JSON.stringify(renewed)]);
  assert.deepEqual((await read()).groups,[],"real live renewal changes heartbeat and expiry without routing history again");
  assert.equal(isExpired(renewed,lease.expiresAt),false);assert.equal(isExpired(renewed,renewed.expiresAt),true);assert.throws(()=>heartbeat(renewed,renewed.expiresAt,120_000),/expired/);
  assert.equal((await db.query<{revision:number}>("SELECT revision FROM cp_leases")).rows[0].revision,8,"the aggregate CAS revision stays independent");
  let version=7;
  for(const[path,value]of[["expiresAt",at(60_000)],["released",true],["routeTaskId","replacement-route"],["id","replacement-identity"]]as const){
    await db.query("UPDATE cp_leases SET revision=revision+1,changed_at=now(),value=jsonb_set(value,ARRAY[$1],$2::jsonb)",[path,JSON.stringify(value)]);
    const next=await read(),latest=next.cursors.leases.held.filter(([id])=>id==="lease").at(-1)!;
    assert.equal(latest[1],++version,`${path} changes the semantic version`);assert.ok(latest[2]>first[2]);assert.deepEqual(next.groups,[{id:"assignment",state:"az"}]);
  }
  const stamp=previous.through;
  await db.query("INSERT INTO cp_log_artifacts SELECT 'wi',n,$1,jsonb_build_object('workItemId','wi') FROM generate_series(1,400) n",[stamp]);
  await db.query("INSERT INTO cp_log_artifacts VALUES('receipts',1,$1,'{\"workItemId\":\"unowned-receipt\"}')",[stamp]);
  for(const[table,id,value]of[["obligations","late-ob",{id:"late-ob"}],["debts","debt",{obligationId:"from-debt"}],
    ["occurrences_history","occ",{obligationId:"from-occurrence",workItemId:"occ-wi"}],["ask_gap_observations","gap",{bodyId:"body",code:"CALENDAR_STALE"}],
    ["work_items_history","clause-wi",{id:"clause-wi",obligation:"late-ob#1"}],["work_items_history","wi",{id:"wi",directoryParent:{workItemId:"parent"}}],
    ["attempts","attempt",{id:"attempt",workItemId:"wi"}]]as const)await db.query(`INSERT INTO cp_${table} VALUES($1,1,$2,$3::jsonb)`,[id,stamp,JSON.stringify(value)]);
  for(const[name,key,record]of[["worker_results","wi",{workItemId:"wi"}],["scout_results","scout",{attemptId:"attempt"}]]as const)
    await db.query(`INSERT INTO cp_log_${name} VALUES($1,1,$2,$3::jsonb)`,[key,stamp,JSON.stringify(record)]);
  const batch=await read();
  assert.deepEqual(batch.groups.map(row=>row.id).sort(),["assignment","from-debt","from-occurrence","freshness:ask-gap:body#CALENDAR_STALE","late-ob"].sort());
  assert.deepEqual(batch.items,["clause-wi","occ-wi"],"held assignments and receipt-only keys do not become probes");assert.deepEqual(batch.changedAttempts,["attempt"]);
  assert.deepEqual(batch.links,[{id:"clause-wi",parent:null},{id:"wi",parent:"parent"}]);
  assert.equal(batch.cursors.artifacts.held.length,401,"all slots are acknowledged while only one affected assignment crosses the connection");
  assert.deepEqual((await read()).groups,[],"the overlapping window excludes slots already folded");
  await db.query("INSERT INTO cp_log_artifacts VALUES('wi',401,$1,'{\"workItemId\":\"wi\"}')",[stamp]);
  assert.deepEqual((await read()).groups,[{id:"assignment",state:"az"}],"a late slot inside the held window is still folded");
  await db.query("UPDATE cp_work_items_history SET revision=2,value='{\"id\":\"wi\"}' WHERE id='wi'");
  assert.deepEqual((await read()).links,[{id:"wi",parent:null}],"a fresh revision with the same change timestamp remains visible");
  assert.deepEqual((await read()).groups,[]);
});
