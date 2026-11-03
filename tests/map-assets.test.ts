import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readMapAsset} from '../lib/map/assets.ts';
const secret='saved-private-map-key';
test('Map assets keep templates and content while removing credentials from browser-visible files',async()=>{
 let fetched='';
 const response=await readMapAsset(['maps','basic-v2','style.json'],new URLSearchParams('key=attacker&language=en'),{
  origin:'https://meanwhileusa.com',readKey:async()=>secret,fetch:(async(url,init)=>{
   fetched=String(url);assert.equal(init?.redirect,'error');
   assert.equal(new Headers(init?.headers).get('cookie'),null);
   return Response.json({version:8,sprite:`https://api.maptiler.com/maps/basic-v2/sprite?key=${secret}`,glyphs:`https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${secret}`,sources:{streets:{url:`https://api.maptiler.com/tiles/v3/tiles.json?key=${secret}`}},layers:[{id:'background',type:'background'}],unexpected:`echo ${secret}`});
  }) as typeof fetch});
 assert.equal(new URL(fetched).searchParams.get('key'),secret);
 assert.equal(new URL(fetched).searchParams.get('language'),'en');
 const body=await response.text();assert.ok(!body.includes(secret));assert.ok(!body.includes('attacker'));
 const style=JSON.parse(body);assert.equal(style.version,8);assert.equal(style.layers[0].id,'background');
 assert.equal(style.sprite,'https://meanwhileusa.com/api/maptiler/maps/basic-v2/sprite');
 assert.equal(style.glyphs,'/api/maptiler/fonts/{fontstack}/{range}.pbf');
 assert.equal(style.sources.streets.url,'/api/maptiler/tiles/v3/tiles.json');
});
test('Map asset failures, redirects and unsupported paths never return a secret-bearing body',async()=>{
 let opened=0;const readKey=async()=>{opened++;return secret;};
 for(const path of [['geocoding','search.json'],['maps','..','style.json'],['maps','other/style.json'],['maps','page.html']]){
  const response=await readMapAsset(path,new URLSearchParams(),{readKey});assert.equal(response.status,404);
 }assert.equal(opened,0);
 for(const upstream of [new Response(secret,{status:403}),new Response(`<html>${secret}</html>`,{headers:{'content-type':'text/html'}})]){
  const response=await readMapAsset(['maps','basic-v2','style.json'],new URLSearchParams(),{readKey,fetch:(async()=>upstream) as typeof fetch});
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes(secret));
 }
 const binary=Uint8Array.from([1,2,3]);
 const tile=await readMapAsset(['tiles','v3','1','2','3.pbf'],new URLSearchParams(),{readKey,fetch:(async()=>new Response(binary)) as typeof fetch});
 assert.deepEqual(new Uint8Array(await tile.arrayBuffer()),binary);
});
