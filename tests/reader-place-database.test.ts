import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {BOOTSTRAP_DDL} from "../lib/control-plane/repository/pg-schema.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {PLACE_PACKAGE_SQL,readPlacePackage} from "../lib/reader/place.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";

test("place reads preserve the migrated state type, use the existing one-shot client and share request work",async()=>{
  const {pg}=await migratedReaderDb();
  // The current production reader retains this legacy table. Use its actual
  // production bootstrap declaration beside the complete reader migrations.
  const legacy=BOOTSTRAP_DDL.find(ddl=>ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("));
  assert.ok(legacy);await pg.exec(legacy);
  const input={state:"AZ",divisionIds:["ocd-division/country:us/state:az/place:fixture"]};
  let reads=0,release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve});
  try{
    await pg.exec("SET enable_seqscan=off");
    const plan=await pg.query<Record<string,unknown>>(`EXPLAIN (FORMAT JSON) ${PLACE_PACKAGE_SQL}`,
      ["AZ",input.divisionIds,[],"ocd-division/country:us/state:az",false,false,false,null,false]);
    assert.ok(!JSON.stringify(plan.rows).includes("(state)::text"),"a text comparison prevents the real char(2) state index from qualifying the read");
    await pg.exec("RESET enable_seqscan");
    installFactReader(async(text,params=[])=>{reads++;await held;return(await pg.query<Record<string,unknown>>(text,[...params])).rows;});
    installReaderDatabaseQuery(async()=>{throw new Error("A one-shot place read must not open a socket session")});
    await withReaderSelection({states:["AZ"],keys:new Set(input.divisionIds)},async()=>{
      const first=readPlacePackage(input);
      assert.equal(readPlacePackage(input),first);
      assert.equal(reads,1);release();
      assert.deepEqual((await first).meetings,[]);
      assert.equal(readPlacePackage(input),first,"a request keeps its settled answer");
    });
    await withReaderSelection({states:["AZ"],keys:new Set(input.divisionIds)},()=>readPlacePackage(input));
    assert.equal(reads,2,"a later request checks current facts again");
  }finally{release();installFactReader(undefined);installReaderDatabaseQuery(undefined);await pg.close();}
});
