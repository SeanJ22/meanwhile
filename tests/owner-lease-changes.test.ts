import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OWNER_LEASE_CHANGES_DDL, pgOwnerLeaseChanges, type OwnerLeaseChange } from "../lib/control-plane/repository/owner-lease-changes.ts";

const db=new PGlite();
after(()=>db.close());

test("owner lease cursors ignore heartbeat-only changes while preserving every assignment state change and CAS revision",async()=>{
  await db.exec(`CREATE TABLE cp_leases(id text PRIMARY KEY,revision bigint NOT NULL,changed_at timestamptz NOT NULL,value jsonb NOT NULL);
    INSERT INTO cp_leases VALUES('lease',7,'2026-10-20T00:00:00Z',
      '{"id":"lease","routeTaskId":"route","released":false,"expiresAt":"2026-10-30T00:00:00Z","heartbeatAt":"2026-10-20T00:00:00Z"}')`);
  for(const statement of OWNER_LEASE_CHANGES_DDL)await db.exec(statement);
  const changes=pgOwnerLeaseChanges({query:async(text,params=[])=> (await db.query(text,[...params])).rows});
  const read=async(held:readonly(readonly[string,number])[])=>{
    const rows:OwnerLeaseChange[]=[];
    await changes.read(null,held,async page=>{rows.push(...page);});return rows;
  };
  const [first]=await read([]);
  assert.equal(first.version,7,"existing CAS revisions seed the semantic cursor without rewriting old leases");
  assert.equal(first.changedAt,"2026-10-20T00:00:00.000Z");
  let version=first.version;
  const held=()=>[[first.id,version]as const];
  await db.exec(`UPDATE cp_leases SET revision=8,changed_at=now(),value=jsonb_set(value,'{heartbeatAt}','"2026-10-21T00:00:00Z"')`);
  assert.deepEqual(await read(held()),[],"a heartbeat alone never routes an unchanged assignment for a history rebuild");
  assert.equal((await db.query<{revision:number}>("SELECT revision FROM cp_leases")).rows[0].revision,8,"the aggregate write revision remains the real CAS revision");
  for(const [path,value]of [["expiresAt","2026-10-31T00:00:00Z"],["released",true],["routeTaskId","replacement-route"],["id","replacement-identity"]]as const){
    await db.query(`UPDATE cp_leases SET revision=revision+1,changed_at=now(),value=jsonb_set(value,ARRAY[$1],$2::jsonb)`,[path,JSON.stringify(value)]);
    const [next]=await read(held());
    assert.equal(next.version,version+1,`${path} changes the semantic version`);
    assert.ok(next.changedAt>first.changedAt);
    version=next.version;
  }
});
