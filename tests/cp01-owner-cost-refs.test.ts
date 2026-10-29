import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {OWNER_COST_REFS_DDL,pgOwnerCostRefs} from "../lib/control-plane/repository/owner-cost-refs.ts";

test("cost repair markers match only changed identities and a failed replacement retains every prior marker",async()=>{
  const db=new PGlite();
  try{
    await db.exec(OWNER_COST_REFS_DDL);
    await db.exec("CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL)");
    const store=pgOwnerCostRefs({query:async(text,params=[])=> (await db.query(text,[...params])).rows});
    await store.add(["missing-attempt"],["missing-work"]);
    assert.deepEqual(await store.matching("orphan",["unrelated","missing-attempt"]),["missing-attempt"]);
    assert.deepEqual(await store.matching("orphan",["missing-work"]),[]);
    await assert.rejects(store.replace(["collision","collision"],[]));
    assert.deepEqual(await store.matching("orphan",["missing-attempt"]),["missing-attempt"]);
    assert.deepEqual(await store.matching("unassigned",["missing-work"]),["missing-work"]);
    await assert.rejects(store.persist({expectedRevision:99,value:{formatVersion:4,costs:null,assignments:null},now:"2026-10-28T00:00:00Z"},
      {replace:true,orphans:["new-attempt"],unassigned:[]}),/Owner cost totals changed/);
    assert.deepEqual(await store.matching("orphan",["missing-attempt","new-attempt"]),["missing-attempt"],"rejected national CAS rolls back marker repair too");
    await store.replace([], ["later-work"]);
    assert.deepEqual(await store.matching("orphan",["missing-attempt"]),[]);
    assert.deepEqual(await store.matching("unassigned",["missing-work","later-work"]),["later-work"]);
  }finally{await db.close();}
});
