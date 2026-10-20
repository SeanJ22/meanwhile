import assert from "node:assert/strict";
import test from "node:test";
import type { Header } from "pmtiles";
import { createBoundaryReader } from "../lib/map/boundary-reader.ts";

test("the boundary worker reuses two bounded ZIP tiles before normal range reads", async () => {
  const calls:unknown[]=[],header={minZoom:0,maxZoom:14} as Header;
  const read=createBoundaryReader(url=>({getHeader:async()=>{calls.push(["header",url]);return header;},getZxy:async(z,x,y,signal)=>{calls.push([url,z,x,y,signal]);return{data:Uint8Array.of(7).buffer};}}));
  const point={kind:"prefetch" as const,url:"https://tiles.example/archive.pmtiles",zip:"00000",lat:0,lng:0};
  await read(point);
  assert.deepEqual((calls[1] as unknown[]).slice(0,4),[point.url,11,1024,1024]);
  assert.deepEqual((calls[2] as unknown[]).slice(0,4),[point.url,10,512,512]);
  const tile={kind:"tile" as const,url:point.url,z:11,x:1024,y:1024};
  const result=await read(tile);assert.ok(result&&"data"in result);assert.deepEqual([...new Uint8Array(result.data)],[7]);assert.equal(calls.length,3);
  await read({...tile,z:10,x:512,y:512});assert.equal(calls.length,3,"the automatic wider fit consumes its already held parent tile");
  const controller=new AbortController();await read(tile,controller.signal);
  assert.equal(calls.length,4);assert.equal((calls.at(-1) as unknown[])[4],controller.signal,"subsequent reads retain the archive's ordinary cancellation and ETag recovery");
});

test("an unsuccessful optional prefetch cannot poison the requested tile", async () => {
  let attempts=0;
  const read=createBoundaryReader(()=>({getHeader:async()=>({minZoom:0,maxZoom:14}as Header),getZxy:async()=>{if(++attempts===1)throw new Error("temporary source failure");return{data:new ArrayBuffer(0)};}}));
  await assert.rejects(read({kind:"prefetch",url:"https://tiles.example/archive",zip:"00000",lat:0,lng:0}),/temporary source failure/);
  assert.ok(await read({kind:"tile",url:"https://tiles.example/archive",z:11,x:1024,y:1024}));assert.equal(attempts,3);
});
