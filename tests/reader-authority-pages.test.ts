import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { buildPageBody,storePlacePage } from "../lib/reader/place-builder.ts";
import { readCanonicalShelf } from "../lib/reader/canonical.ts";
import type { Query } from "../lib/facts/publish.ts";

test("a ready place carries its source section and Checked metadata without any bundle lookup",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state='ocd-division/country:us/state:az',city=`${state}/place:example`;
  const pointer={recordClass:'CURATED_READER_RECORD' as const,scope:`US:plain-english-translations:${city}`};
  const checked='2026-10-28T12:00:00.000Z',payload={formatVersion:1,records:[{id:'example',kind:'BODY_DEFINITION',value:{text:'A sourced description'}}]};
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1)",[state,city]);
    await publish({...pointer,id:'description',sourceId:'source',value:payload,at:checked});
    await storePlacePage(query,city,await buildPageBody(city,'place','AZ',query));
    const statements:string[]=[];
    const reader=await readCanonicalShelf([pointer],async batch=>Promise.all(batch.map(({text,params})=>{
      statements.push(text);assert.doesNotMatch(text,/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/);
      return query(text,params);
    })));
    const entry=await reader.readPromotedEntry!(pointer.recordClass,pointer.scope);
    assert.equal(entry.kind,'PROMOTED');
    if(entry.kind==='PROMOTED'){
      assert.deepEqual(entry.projection.payload,payload);
      assert.equal(entry.attested.retrievedAt,checked);
    }
    assert.equal(statements.length,1);
  } finally {await pg.close();}
});
