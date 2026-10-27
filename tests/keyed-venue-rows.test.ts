import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import {installKeyedRows} from "./helpers/keyed-rows.ts";

test("venue backfill and pointer updates retain exact source/body/tenant placements without unrelated rows",async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec("CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb)");
  await installKeyedRows(pg);
  const own={id:"native-venue",sourceId:"official-page-events",bodyOcdId:"ocd-division/country:us/state:az/place:sample",tenant:null,match:"Council Chambers",name:"Sample Hall",address:"1 Public Plaza",lat:33.2,lng:-111.5,
    addressSourceUrl:"https://sample.gov/hall",coordinateSourceUrl:"https://sample.gov/map",verifiedAt:"2026-10-20T00:00:00Z",evidence:{quote:"Council Chambers at 1 Public Plaza",nativeSource:"sample"}};
  const other={...own,id:"unrelated-venue",sourceId:"other",bodyOcdId:"ocd-division/country:us/state:nh/place:other",evidence:{quote:"x".repeat(200_000),nativeSource:"other"}};
  const put=async(version:string,records:unknown[])=>{
    const encoded=partitionCivicPayload({kind:"venue-resolutions",formatVersion:1,records});
    await pg.transaction(async tx=>{
      for(const part of encoded.parts)await tx.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      await tx.query(`INSERT INTO civic_data_promotions VALUES('CURATED_READER_RECORD:US:venue-resolutions','CURATED_READER_RECORD','US:venue-resolutions',$1,now(),$2)
        ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,payload=excluded.payload`,[version,JSON.stringify(encoded.value)]);
    });
  };
  await put("v1",[own,other]);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-05_venue_rows.sql",import.meta.url),"utf8"));
  const selected=async()=> (await pg.query<{row_id:string;body_id:string;state:string;value:typeof own}>(`SELECT r.row_id,r.body_id,r.state,reader_payload_value(r.value) AS value FROM civic_data_rows r
    JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.collection='venues' AND r.value->>'sourceId'=$1 AND r.body_id=$2 AND r.value->>'tenant' IS NOT DISTINCT FROM $3`,[own.sourceId,own.bodyOcdId,null])).rows;
  assert.deepEqual(await selected(),[{row_id:own.id,body_id:own.bodyOcdId,state:"AZ",value:own}]);
  assert.ok(JSON.stringify(await selected()).length<2_000);
  await put("v2",[{...own,address:"2 Public Plaza"}]);
  assert.deepEqual((await selected())[0].value,{...own,address:"2 Public Plaza"});
  assert.equal((await pg.query<{n:number}>("SELECT count(*)::int n FROM civic_data_rows WHERE collection='venues'")).rows[0].n,1);
  await pg.exec("DELETE FROM civic_data_promotions");
  assert.deepEqual(await selected(),[]);
});
