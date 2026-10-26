import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCivicReadCacheHost } from "../lib/db/civic-read-cache-host.ts";
import { runtimeCivicReadCache } from "../lib/db/civic-read-cache.ts";

test("job rows and source cursors survive ordinary copy eviction and a host restart",async()=>{
  const cwd=process.cwd(),root=await mkdtemp(join(tmpdir(),"db03-job-state-"));
  const before=process.env.DATABASE_URL;
  let host:Awaited<ReturnType<typeof startCivicReadCacheHost>>|undefined;
  try {
    process.chdir(root);process.env.DATABASE_URL="postgres://readonly:fixture@job-cache.invalid/neondb";
    host=await startCivicReadCacheHost({maxBytes:256,maxCopyBytes:256});
    const cache=runtimeCivicReadCache()!,state=cache.jobState();
    await cache.checkpoint("source","AZ",{position:128,hash:"a".repeat(64)});
    await state.row({namespace:"research",key:"held",current:async()=>({etag:"1",value:{text:"held".repeat(100)}})});
    for(let i=0;i<8;i++)await cache.row({namespace:"parts",key:String(i),current:async()=>({etag:"1",value:"new".repeat(20)})});
    await host.close();host=await startCivicReadCacheHost({maxBytes:256,maxCopyBytes:256});
    const next=runtimeCivicReadCache()!;
    assert.deepEqual(await next.readCheckpoint("source","AZ"),{position:128,hash:"a".repeat(64)});
    assert.deepEqual(await next.jobState().row({namespace:"research",key:"held",current:async etag=>{assert.equal(etag,"1");return {etag:"1",unchanged:true};}}),{text:"held".repeat(100)});
  } finally {
    await host?.close();process.chdir(cwd);if(before===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before;
    await rm(root,{recursive:true,force:true});
  }
});
