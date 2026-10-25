import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/events/route.ts";

test("event failures retain the real error and storage step in the server log, without exposing them to the reader",async()=>{
  const before={role:process.env.WTP_DB_ROLE,context:process.env.NETLIFY_BLOBS_CONTEXT};
  process.env.WTP_DB_ROLE="local";process.env.NETLIFY_BLOBS_CONTEXT="";
  const lines:unknown[][]=[];const log=console.error;console.error=(...args:unknown[])=>{lines.push(args);};
  try {
    for(let i=0;i<2;i++) {
      const response=await POST(new Request("http://localhost/api/events",{method:"POST",headers:{origin:"http://localhost"},
        body:JSON.stringify({batchId:`batch-error-${i}`,continuityKey:"local-browser-value-123",events:[
          {id:`event-error-${i}`,type:"ZIP_VIEW",zip:"85701",occurredAt:"2026-10-25T04:33:00Z"},
        ]})}));
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:"event store unavailable"});
    }
    assert.equal(lines.length,2);
    const entry=lines[0][1] as {batchId:string;eventCount:number;error:Error};
    assert.equal(entry.batchId,"batch-error-0");assert.equal(entry.eventCount,1);
    assert.match(entry.error.message,/history could not be saved/);
    assert.ok(entry.error.cause instanceof Error);
    assert.equal(entry.error.cause.name,"MissingBlobsEnvironmentError");
    assert.match(entry.error.cause.stack!,/getStore/);
  }finally{
    console.error=log;
    if(before.role===undefined)delete process.env.WTP_DB_ROLE;else process.env.WTP_DB_ROLE=before.role;
    if(before.context===undefined)delete process.env.NETLIFY_BLOBS_CONTEXT;else process.env.NETLIFY_BLOBS_CONTEXT=before.context;
  }
});
