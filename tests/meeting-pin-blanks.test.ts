import { installKeyedRows } from "./helpers/keyed-rows.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { factDb } from "./helpers/fact-db.ts";
import { openMissingPinBlanks } from "../lib/meetings/pin-blanks.ts";

test("every unplaced sitting gets standing work, including entity-only history and bodies with no address",async()=>{
  const db=await factDb(),now="2026-10-26T07:00:00Z";
  try{
    await db.pg.exec("CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,payload jsonb,scope text DEFAULT 'fixture',current_version_id text DEFAULT 'fixture',promoted_at timestamptz DEFAULT '2026-10-26T06:00:00Z')");
    await installKeyedRows(db.pg);
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('body','body','Board','WI'),('meeting:history','meeting','Old sitting','WI')");
    const meeting=(id:string,extra:Record<string,unknown>={})=>({id,bodyId:"body",bodyName:"Board",...extra});
    await db.query("INSERT INTO civic_data_promotions(key,record_class,payload) VALUES('MEETING:test','MEETING',$1)",[JSON.stringify({meetings:[
      meeting("missing"),meeting("online",{online:{label:"Online only",joinUrl:"https://example.gov/join"}}),
      meeting("address",{venueGap:{publishedText:"200 E Wells St, Milwaukee, WI 53202"}}),
      meeting("placed",{location:{lat:43.04,lng:-87.9}}),meeting("duplicate"),
      meeting("duplicate",{mapPin:{lat:43.04,lng:-87.9}}),
    ]})]);
    assert.equal(await openMissingPinBlanks(db,now),4);
    const blanks=await db.query("SELECT entity_id,reason,next_try_at,attempts FROM blank WHERE field='map_pin' ORDER BY entity_id");
    assert.deepEqual(blanks.map(row=>[row.entity_id,row.reason]),[
      ["meeting:address","MEETING_ADDRESS_NOT_PLACED"],["meeting:history","BODY_OFFICE_ADDRESS_MISSING"],
      ["meeting:missing","BODY_OFFICE_ADDRESS_MISSING"],["meeting:online","ONLINE_OFFICE_ADDRESS_MISSING"],
    ]);
    assert.ok(blanks.every(row=>Date.parse(String(row.next_try_at))===Date.parse(now)&&row.attempts===0));
    await db.query("UPDATE blank SET detail='learned failure',next_try_at=$1 WHERE entity_id='meeting:address'",["2026-10-27T07:00:00Z"]);
    assert.equal(await openMissingPinBlanks(db,"2026-10-26T08:00:00Z"),0);
    assert.equal((await db.query("SELECT detail FROM blank WHERE entity_id='meeting:address'"))[0].detail,"learned failure");
    assert.equal((await db.query("SELECT reason FROM blank WHERE entity_id='body' AND field='office_address'"))[0].reason,"STREET_OFFICE_ADDRESS_MISSING");
  }finally{await db.pg.close();}
});
