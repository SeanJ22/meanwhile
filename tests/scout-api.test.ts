import test from 'node:test';
import assert from 'node:assert/strict';
import { readSourceApi } from '../lib/control-plane/scheduler/scout-api.ts';

test('government tools return data and source URLs without exposing provider credentials', async () => {
  const env = Object.fromEntries(['CONGRESS','CENSUS','FEC','PLURAL','LEGISCAN','LDA','DATA_GOV','GOOGLE_CIVIC','SAM_GOV'].map(name=>[name+'_API_KEY','secret-'+name]));
  const cases = ['congress_api','census_api','fec_api','plural_api','legiscan_api','lda_api','data_gov_api','google_civic_api','sam_gov_api','legistar_api'] as const;
  for (const name of cases) {
    let sent:RequestInit|undefined;
    const result=await readSourceApi(name,{tenant:'pima',params:{op:'getMasterList',state:'AZ'}},{env,
      fetchImpl:async (_url,init)=>{sent=init;return new Response(JSON.stringify({records:[{name:'Council'}],next:'secret-CONGRESS'}));}});
    assert.equal(result.status,200); assert.match(result.text,/Council/); assert.doesNotMatch(result.text,/secret-CONGRESS/);
    assert.doesNotMatch(result.sourceUrl,/secret-|api_key=/); assert.equal(sent?.redirect,'error');
    assert.equal(result.requests,1);
  }
});
test('credentialed API cannot escape its provider base',async()=>{
  let calls=0;
  await assert.rejects(readSourceApi('congress_api',{path:'https://untrusted.example/steal'},{env:{CONGRESS_API_KEY:'secret'},fetchImpl:async()=>{calls++;return new Response('{}');}}),/provider base/);
  assert.equal(calls,0);
});
test('Socrata verifies dataset host with its catalog and sends no application secret',async()=>{
  const calls:{url:string;headers:Headers}[]=[];
  const response=await readSourceApi('socrata_api',{domain:'data.example.gov',dataset:'abcd-1234',params:{$limit:'1'}},{env:{SOCRATA_APP_TOKEN:'app',SOCRATA_SECRET_TOKEN:'oauth-secret'},fetchImpl:async (url,init)=>{
    calls.push({url:String(url),headers:new Headers(init?.headers)});
    return new Response(JSON.stringify(calls.length===1?{results:[{resource:{id:'abcd-1234'},metadata:{domain:'data.example.gov'}}]}:[{name:'Meeting'}]));
  }});
  assert.equal(response.requests,2);assert.match(response.text,/Meeting/);
  assert.equal(calls[0].headers.has('X-App-Token'),false);
  assert.equal(calls[1].headers.get('X-App-Token'),'app');assert.equal(calls[1].headers.has('Authorization'),false);
});
test('no credentials are sent to an unrecognized Socrata host',async()=>{
  let calls=0;
  await assert.rejects(readSourceApi('socrata_api',{domain:'evil.example',dataset:'abcd-1234'},{env:{SOCRATA_APP_TOKEN:'secret'},fetchImpl:async()=>{calls++;return new Response('{"results":[]}');}}),/not found/);
  assert.equal(calls,1);
});

test('a source API request inherits its caller cancellation and keeps the provider timeout',async()=>{
  const controller=new AbortController();
  let observed:AbortSignal|null=null;
  const request=readSourceApi('congress_api',{path:'member/A000001'},{env:{CONGRESS_API_KEY:'fixture-key'},signal:controller.signal,
    fetchImpl:async (_url,init)=>{
      observed=init?.signal ?? null;
      assert.ok(observed);
      queueMicrotask(()=>controller.abort(new Error('Fixture acquisition deadline')));
      return await new Promise<Response>((_resolve,reject)=>observed!.addEventListener('abort',()=>reject(observed!.reason),{once:true}));
    }});
  await assert.rejects(request,/Fixture acquisition deadline/);
  assert.equal((observed as AbortSignal|null)?.aborted,true);
  await assert.rejects(readSourceApi('congress_api',{path:'member/A000001'},{env:{CONGRESS_API_KEY:'fixture-key'},timeoutMs:1,
    fetchImpl:async (_url,init)=>await new Promise<Response>((_resolve,reject)=>{
      const keepAlive=setTimeout(()=>reject(new Error('Provider timeout did not run')),1000);
      init!.signal!.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(init!.signal!.reason);},{once:true});
    })}),/timeout/i);
});
