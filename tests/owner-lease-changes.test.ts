import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OWNER_LEASE_CHANGES_DDL, OWNER_LEASE_RENEWAL_DDL, pgOwnerLeaseChanges, type OwnerLeaseChange } from "../lib/control-plane/repository/owner-lease-changes.ts";
import { claim, heartbeat, isExpired } from "../lib/control-plane/attempt.ts";

const db=new PGlite();
after(()=>db.close());

test("owner lease cursors suppress real live renewal while expiry, release and identity changes remain observable",async()=>{
  const now=Date.now(),at=(offset:number)=>new Date(now+offset).toISOString();
  const lease=claim("route","worker",at(-30_000),120_000,null);
  await db.exec("CREATE TABLE cp_leases(id text PRIMARY KEY,revision bigint NOT NULL,changed_at timestamptz NOT NULL,value jsonb NOT NULL)");
  await db.query("INSERT INTO cp_leases VALUES('lease',7,$1,$2::jsonb)",[at(-30_000),JSON.stringify(lease)]);
  for(const statement of OWNER_LEASE_CHANGES_DDL)await db.exec(statement);
  await db.exec(OWNER_LEASE_RENEWAL_DDL);
  const changes=pgOwnerLeaseChanges({query:async(text,params=[])=> (await db.query(text,[...params])).rows});
  const read=async(held:readonly(readonly[string,number])[])=>{
    const rows:OwnerLeaseChange[]=[];
    await changes.read(null,held,async page=>{rows.push(...page);});return rows;
  };
  const [first]=await read([]);
  assert.equal(first.version,7,"existing CAS revisions seed the semantic cursor without rewriting old leases");
  assert.equal(first.changedAt,at(-30_000));
  let version=first.version;
  const held=()=>[[first.id,version]as const];
  const renewed=heartbeat(lease,at(0),120_000);
  await db.query("UPDATE cp_leases SET revision=8,changed_at=now(),value=$1::jsonb",[JSON.stringify(renewed)]);
  assert.deepEqual(await read(held()),[],"the real renewal changes BOTH heartbeat and expiry without rebuilding history");
  assert.equal(isExpired(renewed,lease.expiresAt),false,"the queued old expiry must read the renewed head before changing counts");
  assert.equal(isExpired(renewed,renewed.expiresAt),true,"actual expiry still changes the assignment state");
  assert.throws(()=>heartbeat(renewed,renewed.expiresAt,120_000),/expired/);
  assert.equal((await db.query<{revision:number}>("SELECT revision FROM cp_leases")).rows[0].revision,8,"the aggregate write revision remains the real CAS revision");
  for(const [path,value]of [["expiresAt",at(60_000)],["released",true],["routeTaskId","replacement-route"],["id","replacement-identity"]]as const){
    await db.query(`UPDATE cp_leases SET revision=revision+1,changed_at=now(),value=jsonb_set(value,ARRAY[$1],$2::jsonb)`,[path,JSON.stringify(value)]);
    const [next]=await read(held());
    assert.equal(next.version,version+1,`${path} changes the semantic version`);
    assert.ok(next.changedAt>first.changedAt);
    version=next.version;
  }
});
