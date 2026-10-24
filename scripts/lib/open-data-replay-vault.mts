/** Local replay storage only: callers receive and verify the exact production bytes and metadata. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
import {DurableEvidenceStore} from "../../lib/control-plane/evidence/durable-store.ts";
import type {EvidenceStore,ObjectMeta} from "../../lib/control-plane/evidence/store.ts";

export interface ReplayVaultTiming {compressionMs:number;decodeAndHashMs?:number}
export function compressedReplayVault(root:string,timing:ReplayVaultTiming={compressionMs:0}):EvidenceStore {
  const storage=new DurableEvidenceStore(root,{remote:null});
  const sourceMeta=(meta:ObjectMeta)=>JSON.parse(meta.custom!.originalMetadata) as ObjectMeta;
  return {
    async put(key,bytes,meta){const started=performance.now(),compressed=gzipSync(bytes,{level:1});timing.compressionMs+=performance.now()-started;await storage.put(key,compressed,{contentType:"application/gzip",contentHash:`sha256-${createHash("sha256").update(compressed).digest("hex")}`,byteLength:compressed.length,objectClass:meta.objectClass,custom:{originalMetadata:JSON.stringify(meta)}});},
    async get(key){const object=await storage.get(key);if(!object)return null;const started=performance.now(),meta=sourceMeta(object.meta),bytes=gunzipSync(object.bytes,{maxOutputLength:meta.byteLength});assert.equal(bytes.length,meta.byteLength);assert.equal(`sha256-${createHash("sha256").update(bytes).digest("hex")}`,meta.contentHash);if(timing.decodeAndHashMs!==undefined)timing.decodeAndHashMs+=performance.now()-started;return {key,bytes,meta};},
    async head(key){const meta=await storage.head(key);return meta?sourceMeta(meta):null;},
    list:prefix=>storage.list(prefix),
  };
}
