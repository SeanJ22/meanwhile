import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bareGovernmentName, bareNameIsUnheld, nameNeedsFullReader, GOVERNMENT_NAME_HEADERS } from '../lib/ask/name-lookup.ts';
import { withReaderAuthorityEdge } from '../lib/registry/runtime-edge.ts';
import { installFactReader } from '../lib/facts/db.ts';
import { withAskSettings } from '../lib/ask/runtime-settings.ts';
import { askSnapshot } from './helpers/playbooks.ts';
import { deliveredAskText } from '../lib/ask/answer.ts';

const headers=[{id:'mesa#governing',name:'Mesa City Council',ocd_id:'ocd-division/country:us/state:az/place:mesa'},
 {id:'north#board',name:'North High School Governing Board',ocd_id:null}];

test('only a bare named government or school takes the name lookup',()=>{
 for(const name of ['Wauwatosa East Highschool','North High School','Mesa City Council','Pima County Board of Supervisors']) assert.equal(bareGovernmentName(name),true,name);
 for(const question of ['School funding','Arizona governor','my school board','When does Mesa City Council meet?','Mesa City Council budget','Who governs this school','school board']) assert.equal(bareGovernmentName(question),false,question);
});

test('the name shortcut preserves edge-only authority without opening the database',async()=>{
 let reads=0;
 const result=await withReaderAuthorityEdge({edgeOnly:true},()=>bareNameIsUnheld('An Unknown Highschool',['AZ'],async()=>{
  reads++;throw new Error('The edge must not read the database');
 }));
 assert.equal(result,false);
 assert.equal(reads,0);
});

test('an unknown native name reaches the AI answer with two header reads and no package preloads',async()=>{
 const before={fetch:globalThis.fetch,key:process.env.ANTHROPIC_API_KEY};
 process.env.ANTHROPIC_API_KEY='fixture-not-a-real-key';
 const calls:string[]=[];let reads=0;
 globalThis.fetch=(async(_input,init)=>{
  const body=JSON.parse(String(init?.body));
  calls.push(body.tools?.[0]?.name??'other');
  return Response.json({content:[{type:'tool_use',name:'answer_reader',input:{known:false,answer:''}}],usage:{input_tokens:10,output_tokens:5}});
 }) as typeof fetch;
 installFactReader(async text=>{
  assert.ok(text===GOVERNMENT_NAME_HEADERS||(/civic_data_rows/.test(text)&&/registry\.bodies/.test(text)),'only identity headers are read');
  assert.doesNotMatch(text,/\bpayload\b/,'no bundle payload is opened');
  reads++;return[];
 });
 try{
  const{POST}=await import('../app/api/ask/grounded/route.ts');
  const response=await withAskSettings(askSnapshot(),()=>POST(new Request('https://wtp.test/api/ask/grounded',{
   method:'POST',headers:{origin:'https://wtp.test','content-type':'application/json','x-wtp-synthetic-run':'ob01-native-name'},
   body:JSON.stringify({question:'An Unrecorded Highschool',ocdIds:['ocd-division/country:us/state:az/county:pima']})
  })));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.mode,'UNRESOLVED');assert.equal(payload.aiAnswer,"I don't know.");
  assert.equal(payload.trace.preloads,undefined);assert.equal(reads,2);
  assert.deepEqual(calls,['answer_reader']);
  assert.match(deliveredAskText(payload)!,/AI answer\nI don't know\./);
 }finally{
  globalThis.fetch=before.fetch;installFactReader(undefined);
  if(before.key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=before.key;
 }
});

test('known, fuzzy and ambiguous bodies keep the complete reader path',()=>{
 assert.equal(nameNeedsFullReader('Mesa City Council',headers),true);
 assert.equal(nameNeedsFullReader('Mesaa City Council',headers),true);
 assert.equal(nameNeedsFullReader('Mesa City Council',[...headers,{...headers[0],id:'another-mesa#governing'}]),true);
 assert.equal(nameNeedsFullReader('North Highschool',headers),true);
 assert.equal(nameNeedsFullReader('Wauwatosa East Highschool',[{id:'district',name:'Wauwatosa School District'}]),false,
  'an individual school name does not silently become its district');
});

test('state-scoped header reads find published and native names without calendars, people, ballots or bundle payloads',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text,name text,parent_id text,state char(2));
   CREATE TABLE entity_external_id(entity_id text,scheme text,value text);
   CREATE TABLE civic_data_promotions(key text,record_class text,scope text,source_id text,current_version_id text,last_known_good_version_id text,
     payload_fingerprint text,validation_receipt jsonb);
   CREATE TABLE civic_data_candidates(id text,state text,source_id text,record_class text,scope text,read_model_fingerprint text,validation_receipt jsonb);
   CREATE TABLE civic_data_rows(promotion_key text,version_id text,collection text,row_id text,value jsonb);
   INSERT INTO entity VALUES ('north','government','North High School',NULL,'AZ'),('north#board','body','Governing Board','north','AZ'),
     ('pima#bos','body','Board of Supervisors',NULL,'AZ');
   INSERT INTO entity_external_id VALUES ('pima#bos','body-alias','pima#study');`);
  const receipt=JSON.stringify({decision:'GOOD'});
  for(const [state,valid] of [['AZ',true],['NM',false]] as const){
   const key=`REGISTRY_RUNTIME_BINDING:US-${state}:reader-registry-runtime`;
   await pg.query(`INSERT INTO civic_data_promotions VALUES ($1,'REGISTRY_RUNTIME_BINDING',$2,'registry-reviewed-bindings',$3,$3,'fp',$4::jsonb)`,
    [key,`US-${state}:reader-registry-runtime`,`${state}-v1`,receipt]);
   await pg.query(`INSERT INTO civic_data_candidates VALUES ($1,$2,'registry-reviewed-bindings','REGISTRY_RUNTIME_BINDING',$3,'fp',$4::jsonb)`,
    [`${state}-v1`,valid?'PROMOTED':'REJECTED',`US-${state}:reader-registry-runtime`,receipt]);
  }
  for(const body of [{id:'mesa#governing',name:'Mesa City Council',ocdId:'ocd-division/country:us/state:az/place:mesa'},
   {id:'pima#study',name:'Board of Supervisors Study Session',ocdId:'ocd-division/country:us/state:az/county:pima'}])
   await pg.query(`INSERT INTO civic_data_rows VALUES ('REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime','AZ-v1','registry.bodies',$1,$2::jsonb)`,[body.id,JSON.stringify(body)]);
  const texts:string[]=[];
  const query=async(text:string,params:readonly unknown[]=[])=>{texts.push(text);return(await pg.query<Record<string,unknown>>(text,[...params])).rows;};
  assert.equal(await bareNameIsUnheld('Wauwatosa East Highschool',['AZ'],query),true);
  assert.equal(texts.length,2);
  for(const text of texts) assert.doesNotMatch(text,/\bpayload\b(?!_fingerprint)/,'no bundle payload is opened');
  assert.equal(await bareNameIsUnheld('North Highschool',['AZ'],query),false);
  assert.equal(await bareNameIsUnheld('Mesa City Council',['AZ'],query),false);
  assert.equal(await bareNameIsUnheld('Mesa City Council',['CA'],query),true);
  assert.equal(await bareNameIsUnheld('Mesa City Council',['NM'],query),false,'an invalid published pointer keeps the complete reader path');
  const before=texts.length;
  assert.equal(await bareNameIsUnheld('School funding',['AZ'],query),false);
  assert.equal(texts.length,before);
 }finally{await pg.close();}
});
