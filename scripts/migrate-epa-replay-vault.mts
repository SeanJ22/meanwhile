/** Losslessly encode a terminated replay's committed objects before removing their duplicate raw files. */
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { mkdir,readFile,rm,writeFile,statfs } from "node:fs/promises";
import { join,resolve } from "node:path";
import { keyToRelativePath } from "../lib/control-plane/evidence/durable-store.ts";
import { createEpaReplayVault,epaReplayShard } from "./lib/epa-held-spool.mts";
const receipt=resolve("docs/measurements/src-01/epa-four-writer-failed-raw.json"),failure=JSON.parse(await readFile(receipt,"utf8")) as {rawVaultRoots:[string,string];[key:string]:unknown};
const runId=randomUUID(),roots:[string,string]=[join("/workspace/src01-scratch",`epa-failed-encoded-a-${runId}`),join("/workspace/src01-scratch",`epa-failed-encoded-b-${runId}`)];
await Promise.all(roots.map(root=>mkdir(root,{recursive:true})));
const source=createEpaReplayVault(failure.rawVaultRoots,"raw"),target=createEpaReplayVault(roots,"gzip-level1"),keys=await source.list("project/freshness/source/epa-echo/reader/"),digest=createHash("sha256");
let count=0,bytes=0;const started=performance.now();
await writeFile(join(roots[0],"migration.json"),JSON.stringify({sourceRoots:failure.rawVaultRoots,targetRoots:roots,expectedObjects:keys.length,encoding:"gzip-level1"}));
for(const key of keys){
  const original=await source.get(key);assert.ok(original);await target.put(key,original.bytes,original.meta);
  const decoded=await target.get(key);assert.ok(decoded);assert.deepEqual(decoded.meta,original.meta);assert.equal(Buffer.compare(decoded.bytes,original.bytes),0);
  digest.update(JSON.stringify([key,original.meta.contentHash,original.bytes.length])).update("\n");count++;bytes+=original.bytes.length;
  // Only this verified duplicate is removed; the encoded logical object and all source evidence remain.
  const file=join(failure.rawVaultRoots[epaReplayShard(key)],keyToRelativePath(key));await rm(file);await rm(`${file}.meta.json`);
  if(count%2000===0){const fs=await statfs(roots[0]);console.log(JSON.stringify({objects:count,logicalBytes:bytes,elapsedMs:performance.now()-started,workspaceFreeBytes:Number(fs.bavail)*Number(fs.bsize)}));}
}
const migration={status:"PASS",encoding:"gzip-level1",vaultRoots:roots,objects:count,logicalBytes:bytes,sha256:digest.digest("hex"),elapsedMs:performance.now()-started,allDecodedBytesAndMetadataVerifiedBeforeRawDuplicateRemoval:true};
failure.partialStorageMigration=migration;await writeFile(receipt,JSON.stringify(failure,null,2));await writeFile(join(roots[0],"migration.json"),JSON.stringify(migration,null,2));console.log(JSON.stringify(migration));
