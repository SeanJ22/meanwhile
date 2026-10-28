import assert from 'node:assert/strict';
import test from 'node:test';
import {migratedReaderDb} from './helpers/migrated-reader-db.ts';
import {readKeyedSelection} from '../lib/civic-data/keyed-reader.ts';

const at='2026-10-19T00:00:00.000Z';
test('keyed funding keeps selected candidates, every held cycle and their one-hop committee books',async()=>{
  const {pg,publish}=await migratedReaderDb();
  const candidates=[{fecCandidateId:'H1',targetKeys:['person:one'],cycles:[2024,2026],topContributions:[{contributorCommitteeId:'C1',amount:4}]},
    {fecCandidateId:'H2',targetKeys:['person:other'],cycles:[2026],topContributions:[]}];
  const secondHop=[{committeeId:'C1',name:'Complete committee book'},{committeeId:'C2',name:'FOREIGN_COMMITTEE'}];
  const value={formatVersion:1,candidates,secondHop,absences:[{targetKey:'person:missing'},{targetKey:'person:other-missing'}]};
  try {
    await publish({id:'fec-v1',recordClass:'FEC_FUNDING',scope:'US:funding',sourceId:'fixture',at,value});
    const read=await readKeyedSelection(async(text,params=[])=>{
      assert.doesNotMatch(text,/civic_data_(?:candidates|promotions|candidate_events|payload_parts)/);
      return (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    },'FEC_FUNDING','US:funding',['person:one','person:missing']);
    assert.equal(read.kind,'PROMOTED');if(read.kind==='PROMOTED')assert.deepEqual(read.projection.payload,
      {formatVersion:1,candidates:[candidates[0]],secondHop:[secondHop[0]],absences:[value.absences[0]]});
  }finally{await pg.close();}
});
