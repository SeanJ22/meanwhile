import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {ballotCandidateDetailsStatement} from "../lib/ballot/reader-data.ts";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import {canonicalCivicDataHash} from "../lib/civic-data/canonical-hash.ts";
import {selectedStateEntry} from "../lib/reader/selected-entry.ts";

const AT="2026-10-19T12:00:00.000Z";
test("migrated ballot SQL keeps full selected profiles, publications, link evidence and portraits, including prior candidates",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const keys=["ballot-current","ballot-prior","ballot-unrelated"];
  const document=(candidateKey:string)=>({id:`document:${candidateKey}`,candidateKey,text:"Source text ".repeat(3000),sourceUrl:"https://example.gov/statement",revision:{sha256:"a".repeat(64)}});
  const profiles={cards:{curatedAt:AT,note:"Complete cards",hunts:[{source:"held"}],cards:Object.fromEntries(keys.map(key=>[key,{name:key,contacts:{phone:"555-0100"},background:{text:"Complete biography ".repeat(3000)}}]))},
    links:{curatedAt:AT,note:"Verified links",hunts:[],links:Object.fromEntries(keys.map(key=>[key,{official:{url:`https://example.gov/${key}`,verification:"held evidence"}}]))}};
  const corpus={formatVersion:1,fetchedAt:AT,attempted:3,documents:keys.map(document),failures:keys.map(candidateKey=>({candidateKey,reason:"Retained failure detail"}))};
  const campaigns={kind:"candidate-campaign-sites-derived",formatVersion:1,records:keys.map(candidacyId=>({id:`campaign:${candidacyId}`,candidacyId,
    campaign:{url:`https://example.org/${candidacyId}`,evidence:{quote:"Complete source evidence ".repeat(2000)}},publications:[{document:document(candidacyId),evidence:{sourceUrl:"https://example.org/statement"}}]})),
    portraits:keys.map(candidacyId=>({id:`portrait:${candidacyId}`,candidacyId,portrait:{url:`https://example.org/${candidacyId}.jpg`,attribution:"Held attribution"}}))};
  const values=[profiles,corpus,campaigns];
  try{
    const statement=ballotCandidateDetailsStatement("AZ",keys.slice(0,2));
    for(const [index,pointer] of statement.pointers.entries()){
      const encoded=partitionCivicPayload(values[index]);
      assert.ok(encoded.parts.length,"The test must exercise the production payload parts");
      for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      await publish({...pointer,id:`ballot-details:${index}`,sourceId:"held-ballot-source",value:encoded.value,payloadHash:canonicalCivicDataHash(values[index]),at:AT});
    }
    const rows=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;
    const expected=[{...profiles,cards:{...profiles.cards,cards:Object.fromEntries(Object.entries(profiles.cards.cards).slice(0,2))},links:{...profiles.links,links:Object.fromEntries(Object.entries(profiles.links.links).slice(0,2))}},
      {...corpus,documents:corpus.documents.slice(0,2),failures:corpus.failures.slice(0,2)},
      {...campaigns,records:campaigns.records.slice(0,2),portraits:campaigns.portraits.slice(0,2)}];
    for(const [index,pointer] of statement.pointers.entries()){
      const row=rows.find(row=>row.key===`${pointer.recordClass}:${pointer.scope}`);
      const entry=selectedStateEntry(pointer.recordClass,pointer.scope,row);assert.equal(entry.kind,"PROMOTED");
      if(entry.kind==="PROMOTED")assert.deepEqual(entry.projection.payload,expected[index]);
      assert.throws(()=>selectedStateEntry(pointer.recordClass,pointer.scope,{...row,published:false}),/READER_PUBLISHED_POINTER_INVALID/);
    }
  }finally{await pg.close();}
});
