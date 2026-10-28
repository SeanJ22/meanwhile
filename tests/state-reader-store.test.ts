import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readStateReaderEntry} from '../lib/civic-data/state-reader-store.ts';
import {canonicalCivicDataHash} from '../lib/civic-data/canonical-hash.ts';

const recordClass='REGISTRY_RUNTIME_BINDING',scope='US-AZ:reader-registry-runtime';
function row(payload:unknown) {return {row_kind:'promotion',key:`${recordClass}:${scope}`,record_class:recordClass,scope,
  source_id:'registry-reviewed-bindings',current_version_id:'az-v1',last_known_good_version_id:'az-v1',published:true,
  promoted_at:'2026-10-16T10:00:00Z',retrieved_at:'2026-10-16T09:00:00Z',validation_receipt:{decision:'GOOD'},
  normalized_hash:canonicalCivicDataHash(payload),payload};}

test('state reader imports cold without fixture preloads',()=>{
  execFileSync(process.execPath,['--experimental-strip-types','--import','./scripts/register-test-loader.mjs','--input-type=module',
    '-e','await import("./lib/civic-data/state-reader-store.ts")'],{cwd:process.cwd(),stdio:'pipe'});
});
test('state reader selects one saved state section, retaining nested facts and Checked metadata',async()=>{
  const payload={registry:{bodies:[{id:'az-body',name:'Held body'}]},longText:'State document. '.repeat(4000)};
  let calls=0;
  const result=await readStateReaderEntry(async(sql,params)=>{
    calls++;assert.doesNotMatch(sql,/civic_data_(?:candidates|promotions|candidate_events|payload_parts)/);
    assert.deepEqual(JSON.parse(String(params[0])),[{key:`${recordClass}:${scope}`,page_id:'ocd-division/country:us/state:az'}]);
    return [row(payload)];
  },recordClass,scope);
  assert.equal(calls,1);assert.equal(result.kind,'PROMOTED');
  if(result.kind==='PROMOTED'){assert.deepEqual(result.projection.payload,payload);assert.equal(result.attested.retrievedAt,'2026-10-16T09:00:00Z');}
});
test('invalid state scopes fail before SQL and an admitted missing section remains unrecorded',async()=>{
  const query=async()=>{throw Error('SQL must not run');};
  await assert.rejects(readStateReaderEntry(query,recordClass,'US:reader-registry-runtime-bindings'),/STATE_READER_SCOPE_INVALID/);
  await assert.rejects(readStateReaderEntry(query,'BALLOT_CANDIDACY',scope),/STATE_READER_SCOPE_INVALID/);
  assert.deepEqual(await readStateReaderEntry(async()=>[],recordClass,scope),{kind:'NOT_RECORDED',recordClass,scope});
});
test('failed saved publication proof and changed saved payload cannot serve',async()=>{
  await assert.rejects(readStateReaderEntry(async()=>[{...row({held:true}),published:false}],recordClass,scope),/POINTER_INVALID/);
  await assert.rejects(readStateReaderEntry(async()=>[{...row({held:true}),payload:{changed:true}}],recordClass,scope),/PAYLOAD_HASH_MISMATCH/);
});
test('federal directory, optional portraits and registration use their own saved state section',async()=>{
  for(const [recordClass,scope] of [['FEDERAL_DIRECTORY','US-AZ:current-congress-directory'],['STATE_LEGISLATOR','US-AZ:people:portraits:v1'],['REGISTRATION','US-TX:registration:v1']] as const){
    const payload={held:recordClass},source={...row(payload),record_class:recordClass,scope,key:`${recordClass}:${scope}`};
    const read=await readStateReaderEntry(async()=>[source],recordClass,scope);
    assert.equal(read.kind,'PROMOTED');if(read.kind==='PROMOTED')assert.deepEqual(read.projection.payload,payload);
  }
});
