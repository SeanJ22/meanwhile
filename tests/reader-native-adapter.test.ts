import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import meetings,{config as meetingConfig} from "../netlify/functions/reader-meetings.mts";
import geocode,{config as geocodeConfig} from "../netlify/functions/reader-geocode.mts";
import {PUBLIC_SITE_ORIGIN,ADMIN_ORIGIN} from "../lib/ops/origins.ts";

test("native reader adapters preserve public validation and the Admin host's absence",async()=>{
  assert.deepEqual(meetingConfig,{path:"/api/meetings",method:"GET"});
  assert.deepEqual(geocodeConfig,{path:"/api/geocode",method:"POST"});
  const context={waitUntil:(_work:Promise<unknown>)=>undefined};
  const invalid=await meetings(new Request(`${PUBLIC_SITE_ORIGIN}/api/meetings?zip=bad`),context);
  assert.equal(invalid.status,400);
  assert.equal(invalid.headers.get("x-wtp-reader-runtime"),"native");
  const address=new Request(`${PUBLIC_SITE_ORIGIN}/api/geocode`,{method:"POST",body:'{"address":"x"}'});
  const rejected=await geocode(address);
  assert.equal(rejected.status,400);
  assert.deepEqual(await rejected.json(),{match:false});
  assert.match(rejected.headers.get("cache-control")!,/no-store/);
  for(const [path,method,handler] of [["/api/meetings","GET",meetings],["/api/geocode","POST",geocode]] as const){
    const response=await handler(new Request(`${ADMIN_ORIGIN}${path}`,{method,headers:{host:new URL(ADMIN_ORIGIN).host}}),context);
    assert.equal(response.status,404);assert.equal(await response.text(),"");
    assert.equal(response.headers.get("x-robots-tag"),"noindex, nofollow, noarchive");
  }
});

test("the native place reader does not package acquisition adapters, PDF processing or the field-manual bank",async()=>{
  const result=await build({entryPoints:["netlify/functions/reader-meetings.mts"],bundle:true,write:false,metafile:true,
    platform:"node",format:"esm",target:"node24",external:["next","next/*"],logLevel:"silent"});
  const inputs=Object.values(result.metafile!.outputs).flatMap(output=>Object.keys(output.inputs));
  for(const name of ["pdfjs-dist","field-manual-notes.json","sources/composite/wiring.ts"]){
    assert.ok(!inputs.some(input=>input.includes(name)),`${name} must not initialize on a reader's first visit`);
  }
});
