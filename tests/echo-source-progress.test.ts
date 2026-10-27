import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { ArchiveSourceOpen } from "../lib/sources/archive-download.ts";
import { echoSourceProgress } from "../lib/sources/open-data/echo-progress.ts";
import { ECHO_EXPORT } from "../lib/sources/open-data/model.ts";

const at="2026-10-25T08:00:00.000Z";
const header="REGISTRY_ID,FAC_NAME,FAC_STATE,FAC_ZIP\n",one="110017875450,One,AZ,85331\n",two="110071527578,Two,AZ,85331\n";
const csv=header+one+two;
function archive(chunks:AsyncIterable<string>,body=csv):ArchiveSourceOpen {
  return {textChunks:chunks,sourceSha256:createHash("sha256").update(body).digest("hex"),member:"ECHO_EXPORTER.csv",publishedAt:null,
    retrievedAt:at,checkedAt:at,lastCheckStatus:200,byteLength:Buffer.byteLength(body),finalUrl:ECHO_EXPORT,dispose:async()=>{}};
}
async function* bytes(body:string){yield body;}
test("EPA resumes the native row cursor and reuses completed source slices after an interrupted pass",async()=>{
  const saved=new Map<string,string>(),progress=new CivicReadCache({read:async key=>saved.get(key)??null,write:async(key,value)=>{saved.set(key,value);}});
  const vault=new MemoryEvidenceStore(),controller=new AbortController();
  const first=archive((async function*(){yield header+one;controller.abort(Error("pass deadline"));yield two;})());
  const capture={url:ECHO_EXPORT,retrievedAt:at,rawHash:first.sourceSha256,sourceRows:[]};
  const interrupted=await echoSourceProgress({archive:first,capture,vault,signal:controller.signal,now:()=>at,progress});
  await assert.rejects(()=>interrupted.acquire(),/pass deadline/);
  assert.equal((await vault.list("project/freshness/source/epa-echo/reader/")).length,1,"the completed prefix is saved before returning the deadline");
  const resumed=await echoSourceProgress({archive:archive(bytes(csv)),capture,vault,signal:new AbortController().signal,now:()=>at,progress});
  await resumed.acquire();
  const rows=[];for await(const row of resumed.rows())rows.push(row);
  assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.id)).size,2,"resuming never repeats an already parsed identity");
  await resumed.saveProjection({context:"same-inputs",position:1,partitions:[],replaced:[],reports:[]});
  const completed=await echoSourceProgress({archive:archive((async function*(){throw Error("completed bytes must not parse again");})()),
    capture,vault,signal:new AbortController().signal,now:()=>at,progress});
  await completed.acquire();assert.equal(completed.projection()?.position,1);
  const changed=await echoSourceProgress({archive:archive(bytes(csv.replace(",Two,",",New Two,")),csv.replace(",Two,",",New Two,")),
    capture:{...capture,rawHash:createHash("sha256").update(csv.replace(",Two,",",New Two,")).digest("hex")},vault,
    signal:new AbortController().signal,now:()=>at,progress});
  assert.equal(changed.projection(),undefined,"a new source body cannot reuse an old output prefix");
  await changed.acquire();
  const titles=[];for await(const row of changed.rows())titles.push(row.title);assert.ok(titles.includes("New Two"));
});
