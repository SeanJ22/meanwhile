/** The accepted source pointer owns these immutable reader files, using the existing evidence vault. */
import { createHash } from "node:crypto";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { netlifyEvidenceStoreFromEnv } from "../../control-plane/evidence/netlify-store.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { assertOpenDataProjection,openDataCandidate,type OpenDataCapture } from "./publication.ts";
import { openDataReports } from "./normalize.ts";
import type { OpenDataFact,OpenDataSource,OpenDataPartitionRef,OpenDataProjection } from "./model.ts";
/** Canonical reader files live in the shared remote vault, outside deployment bytes. */
export function openDataVault():EvidenceStore {
  const vault=netlifyEvidenceStoreFromEnv();
  if(!vault)throw Error("The shared open-data evidence vault is unavailable.");
  return vault;
}
export async function saveOpenDataPartition(input:{source:OpenDataSource;partition:string;rows:readonly OpenDataFact[];captures:readonly OpenDataCapture[];now:string}, vault:EvidenceStore=openDataVault()):Promise<OpenDataPartitionRef> {
  const candidate=openDataCandidate(input);
  if(!candidate.normalization.succeeded || candidate.dependentChecks.some(c=>!c.passed))throw Error("Reader slice differs from its captured source facts.");
  const value:OpenDataProjection={kind:"open-data",sourceId:input.source,records:input.rows,reports:openDataReports(input.rows)};
  assertOpenDataProjection(value,input.source);
  const bytes=new TextEncoder().encode(canonicalCivicDataJson(value)),sha256=createHash("sha256").update(bytes).digest("hex");
  const key=`project/freshness/source/${input.source}/reader/${sha256}.json`;
  await vault.put(key,bytes,{contentType:"application/json",contentHash:`sha256-${sha256}`,byteLength:bytes.length,objectClass:"IMMUTABLE_BODY"});
  return {id:input.partition,key,sha256,count:input.rows.length};
}
export async function readOpenDataPartition(source:OpenDataSource,reference:OpenDataPartitionRef,vault:EvidenceStore=openDataVault()):Promise<OpenDataProjection> {
  const object=await vault.get(reference.key);if(!object || createHash("sha256").update(object.bytes).digest("hex")!==reference.sha256)throw Error("Accepted reader slice is missing or corrupt.");
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(object.bytes)) as OpenDataProjection;
  assertOpenDataProjection(value,source);if(value.records.length!==reference.count)throw Error("Accepted reader count does not match its source manifest.");return value;
}
