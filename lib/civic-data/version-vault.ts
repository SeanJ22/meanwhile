import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { Query } from "../facts/publish.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { CivicPayloadParts, type CivicPayloadPartIO } from "./payload-parts.ts";
import { CIVIC_PAYLOAD_STRING_CHUNK_UNITS, isCivicPayloadPart, partitionCivicPayload } from "./payload-codec.ts";

export interface CivicVersionVaultRef {
  readonly formatVersion: 1;
  readonly fingerprint: string;
  readonly root: string;
  readonly stringChunkUnits?: number;
}
type Part = { readonly hash: string; readonly payload: unknown };
type Node = { kind?: string; value?: unknown; groups?: unknown[]; order?: unknown; chunks?: unknown[] };
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const keyOf = (hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("CIVIC_VERSION_VAULT_HASH_INVALID");
  return `project/freshness/facts/sha256/${hash}`;
};
const versionKey = (fingerprint: string) => {
  keyOf(fingerprint);
  return `project/freshness/facts/versions/${fingerprint}`;
};

export async function civicVersionRef(vault: EvidenceStore, fingerprint: string): Promise<CivicVersionVaultRef|null> {
  const object=await vault.get(versionKey(fingerprint));if(!object)return null;
  if(object.meta.contentHash!==`sha256-${sha256(object.bytes)}`)throw new Error("CIVIC_VERSION_VAULT_REF_CORRUPT");
  const ref=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(object.bytes)) as CivicVersionVaultRef;
  if(ref.formatVersion!==1||ref.fingerprint!==fingerprint)throw new Error("CIVIC_VERSION_VAULT_REF_INVALID");
  keyOf(ref.root);return ref;
}

async function inBatches<T, R>(values: readonly T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let start = 0; start < values.length; start += 8) result.push(...await Promise.all(values.slice(start,start+8).map(read)));
  return result;
}

function factIO(vault: EvidenceStore): CivicPayloadPartIO {
  return {
    existing: async hashes => (await inBatches(hashes,async hash => {
      const meta = await vault.head(keyOf(hash));
      if (meta && meta.contentHash !== `sha256-${hash}`) throw new Error("CIVIC_VERSION_VAULT_CORRUPT");
      return meta ? hash : null;
    })).filter((hash): hash is string => hash !== null),
    write: async parts => { await inBatches(parts,async part => {
      const bytes = new TextEncoder().encode(JSON.stringify(part.payload));
      if (sha256(bytes) !== part.hash) throw new Error("CIVIC_VERSION_VAULT_HASH_INVALID");
      await vault.put(keyOf(part.hash),bytes,{contentHash:`sha256-${part.hash}`,byteLength:bytes.byteLength,
        contentType:"application/json",objectClass:"IMMUTABLE_BODY"});
    }); },
    read: async hashes => inBatches(hashes,async hash => {
      const object = await vault.get(keyOf(hash));
      if (!object || sha256(object.bytes) !== hash) throw new Error(`CIVIC_VERSION_VAULT_MISSING_OR_CORRUPT:${hash}`);
      return {hash,payload:JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(object.bytes))};
    }),
  };
}

/** Preserve the exact historical facts while the writer owns them. Parts shared across versions are stored once. */
export async function holdCivicVersion(vault: EvidenceStore, model: unknown, fingerprint: string): Promise<CivicVersionVaultRef> {
  if (canonicalCivicDataHash(model,{durable:true}) !== fingerprint) throw new Error("CIVIC_VERSION_FINGERPRINT_MISMATCH");
  const saved=await civicVersionRef(vault,fingerprint);if(saved)return saved;
  const plan = partitionCivicPayload(model), io = factIO(vault);
  let root: string;
  const parts: Part[] = [...plan.parts];
  if (isCivicPayloadPart(plan.value)) root = plan.value.$civicPayloadPart;
  else {
    const payload = {kind:"object",value:plan.value};
    root = sha256(JSON.stringify(payload)); parts.push({hash:root,payload});
  }
  const known = new Set(await io.existing(parts.map(part=>part.hash)));
  await io.write(parts.filter(part=>!known.has(part.hash)));
  const ref:CivicVersionVaultRef={formatVersion:1,fingerprint,root,stringChunkUnits:CIVIC_PAYLOAD_STRING_CHUNK_UNITS};
  const bytes=new TextEncoder().encode(JSON.stringify(ref));
  try { await vault.put(versionKey(fingerprint),bytes,{contentHash:`sha256-${sha256(bytes)}`,byteLength:bytes.byteLength,
    contentType:"application/json",objectClass:"IMMUTABLE_BODY"}); }
  catch(error){const raced=await civicVersionRef(vault,fingerprint);if(raced)return raced;throw error;}
  return ref;
}

export interface CivicVersionRowSelection {
  /** Exact source identifiers, body ids, or other named fields used by the historical reader. */
  readonly match?: {readonly path: readonly string[]; readonly values: readonly string[]};
  readonly fields?: readonly string[];
  readonly omit?: readonly string[];
  readonly afterOrdinal?: number;
  readonly limit?: number;
}
export interface CivicVersionRow {readonly ordinal: number; readonly value: Record<string,unknown>}
export interface CivicVersionTextRange {readonly offset?:number;readonly count?:number}
export interface CivicVersionTextWindow {
  readonly text:string;readonly offset:number;readonly nextOffset:number;readonly totalLength:number;
  /** Legacy SQL offsets count Unicode code points; archived string parts count UTF-16 units. Keep this with a lazy text locator. */
  readonly offsetUnit:"UNICODE_CODE_POINTS"|"UTF16_CODE_UNITS";
}
function validateRowRange(selection: CivicVersionRowSelection): void {
  if (!Number.isSafeInteger(selection.afterOrdinal ?? 0) || (selection.afterOrdinal ?? 0) < 0 ||
      selection.limit !== undefined && (!Number.isSafeInteger(selection.limit) || selection.limit < 1)) throw new Error("CIVIC_VERSION_ROW_RANGE_INVALID");
}
function textRange(range:CivicVersionTextRange):{offset:number;count:number}{
  const offset=range.offset??0,count=range.count??32768;
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<0||count<0||!Number.isSafeInteger(offset+count))
    throw new Error("CIVIC_VERSION_TEXT_RANGE_INVALID");
  return {offset,count};
}

/** This accessor reads paths and selected rows; it never opens the stored candidate envelope. */
export function civicVersionVault(vault: EvidenceStore) {
  const parts = new CivicPayloadParts(factIO(vault));
  const rootOf = (ref: CivicVersionVaultRef) => {
    if (ref.formatVersion !== 1 || !/^[a-f0-9]{64}$/.test(ref.fingerprint)) throw new Error("CIVIC_VERSION_VAULT_REF_INVALID");
    keyOf(ref.root);
    if(ref.stringChunkUnits!==undefined&&(!Number.isSafeInteger(ref.stringChunkUnits)||ref.stringChunkUnits<=0))
      throw new Error("CIVIC_VERSION_VAULT_REF_INVALID");
    return {$civicPayloadPart:ref.root};
  };
  const nodeOf = async (value: unknown): Promise<unknown> => {
    if(!isCivicPayloadPart(value))return value;
    const node = await parts.node(value) as Node | null;
    return node?.kind === "object" ? node.value : node;
  };
  const pathOf = async (root: unknown, path: readonly string[]): Promise<unknown> => {
    let value = root;
    for (const key of path) {
      const node = await nodeOf(value) as Node | null;
      if (isCivicPayloadPart(value) && node?.kind === "array" && /^\d+$/.test(key)) {
        const index = Number(key), order = JSON.parse(await parts.load(node.order) as string) as number[];
        if (index >= order.length) return undefined;
        const group = order[index], position = order.slice(0,index).filter(value=>value===group).length;
        value = (await parts.node(node.groups![group]) as unknown[])[position];
      } else value = node !== null && typeof node === "object" && Object.hasOwn(node,key)
        ? (node as Record<string,unknown>)[key] : undefined;
    }
    return value;
  };
  async function* encodedRows(value: unknown, afterOrdinal = 0): AsyncGenerator<unknown> {
    const node = await nodeOf(value) as Node | unknown[] | null;
    if (Array.isArray(node)) { yield* node.slice(afterOrdinal); return; }
    if (!isCivicPayloadPart(value) || node?.kind !== "array" || !Array.isArray(node.groups)) throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
    const order = JSON.parse(await parts.load(node.order) as string) as number[];
    const remaining = new Map<number,number>();
    for(const group of order)remaining.set(group,(remaining.get(group)??0)+1);
    const held = new Map<number,unknown[]>(), positions = new Map<number,number>();
    for(let index=0;index<order.length;index++){
      const group=order[index], position=positions.get(group)??0;
      positions.set(group,position+1);
      remaining.set(group,remaining.get(group)!-1);
      if(index<afterOrdinal)continue;
      let chunk=held.get(group);
      if(!chunk){const rows=await parts.node(node.groups[group]);if(!Array.isArray(rows))throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
        chunk=rows;held.set(group,chunk);}
      if(position>=chunk.length)throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
      yield chunk[position];
      if(!remaining.get(group))held.delete(group);
    }
  }
  return {
    async read(ref:CivicVersionVaultRef):Promise<unknown>{
      const value=await parts.load(rootOf(ref));
      if(canonicalCivicDataHash(value,{durable:true})!==ref.fingerprint)throw new Error("CIVIC_VERSION_FINGERPRINT_MISMATCH");
      return value;
    },
    async path(ref:CivicVersionVaultRef,path:readonly string[]):Promise<unknown>{
      const value=await pathOf(rootOf(ref),path);
      return value===undefined?null:parts.load(value);
    },
    /** Zero count returns the length. A text window opens only its immutable string chunks, plus the final chunk for length. */
    async text(ref:CivicVersionVaultRef,path:readonly string[],range:CivicVersionTextRange={}):Promise<CivicVersionTextWindow|null>{
      const {offset,count}=textRange(range),value=await pathOf(rootOf(ref),path);
      if(value===undefined||value===null)return null;
      const node=await nodeOf(value) as Node|string|null;
      let totalLength:number,base=0,text:string;
      if(typeof node==="string"){text=node;totalLength=text.length;}
      else if(isCivicPayloadPart(value)&&node?.kind==="string"&&node.chunks?.length){
        // Version 1 originally used 8192 UTF-16 units, before the size became explicit on the ref.
        const units=ref.stringChunkUnits??8192,chunks=node.chunks;
        const last=await parts.load(chunks.at(-1));if(typeof last!=="string")throw new Error("CIVIC_VERSION_TEXT_INVALID");
        totalLength=(chunks.length-1)*units+last.length;
        if(!count||offset>=totalLength)return{text:"",offset:Math.min(offset,totalLength),nextOffset:Math.min(offset,totalLength),totalLength,offsetUnit:"UTF16_CODE_UNITS"};
        // One neighboring unit on either side preserves a surrogate pair crossing a window boundary.
        const first=Math.floor(Math.max(0,offset-1)/units),end=Math.min(chunks.length,Math.floor(Math.min(totalLength-1,offset+count)/units)+1);
        const selected=await parts.load(chunks.slice(first,end));
        if(!Array.isArray(selected)||!selected.every(value=>typeof value==="string"))throw new Error("CIVIC_VERSION_TEXT_INVALID");
        text=selected.join("");base=first*units;
      }else throw new Error("CIVIC_VERSION_TEXT_INVALID");
      let start=Math.min(offset,totalLength)-base,end=Math.min(offset+count,totalLength)-base;
      if(count&&start>0&&/[\uDC00-\uDFFF]/.test(text[start]??"")&&/[\uD800-\uDBFF]/.test(text[start-1]))start--;
      if(count&&/[\uD800-\uDBFF]/.test(text[end-1]??"")&&/[\uDC00-\uDFFF]/.test(text[end]??""))end++;
      return{text:count?text.slice(start,end):"",offset:base+start,nextOffset:count?base+end:base+start,totalLength,offsetUnit:"UTF16_CODE_UNITS"};
    },
    async rows(ref:CivicVersionVaultRef,path:readonly string[],selection:CivicVersionRowSelection={}):Promise<readonly CivicVersionRow[]>{
      validateRowRange(selection);
      const value=await pathOf(rootOf(ref),path);if(value===undefined)return [];
      const rows:CivicVersionRow[]=[],wanted=selection.match?new Set(selection.match.values):null;
      if(wanted?.size===0)return [];
      let ordinal=selection.afterOrdinal??0;
      for await(const encoded of encodedRows(value,ordinal)){
        ordinal++;
        if(selection.match&&!wanted!.has(String(await parts.load(await pathOf(encoded,selection.match.path)))))continue;
        const node=await nodeOf(encoded);if(!node||typeof node!=="object"||Array.isArray(node))throw new Error("CIVIC_VERSION_ROW_INVALID");
        const fields=selection.fields??Object.keys(node).filter(key=>!selection.omit?.includes(key));
        const selected=Object.fromEntries(fields.filter(key=>Object.hasOwn(node,key)).map(key=>[key,(node as Record<string,unknown>)[key]]));
        rows.push({ordinal,value:await parts.load(selected) as Record<string,unknown>});
        if(selection.limit !== undefined && rows.length >= selection.limit) break;
      }
      return rows;
    },
  };
}

type VaultProvider=EvidenceStore|(()=>EvidenceStore);
interface VersionHead {readonly id:string;readonly fingerprint:string|null;readonly legacy:boolean;readonly current:boolean;readonly ref:CivicVersionVaultRef|null}
async function versionHead(query:Query,id:string):Promise<VersionHead|null>{
  const [row]=await query(`SELECT c.id,coalesce(c.read_model_fingerprint,c.normalized_hash) AS fingerprint,
    c.candidate ? 'readModel' AS legacy,c.candidate#>'{vault,readModel}' AS read_model_ref,
    EXISTS(SELECT 1 FROM civic_data_promotions p WHERE p.current_version_id=c.id) AS current
    FROM civic_data_candidates c WHERE c.id=$1`,[id]);
  if(!row)return null;
  return {id:String(row.id),fingerprint:row.fingerprint as string|null,legacy:row.legacy===true,current:row.current===true,
    ref:row.read_model_ref as CivicVersionVaultRef|null??null};
}
async function versionArchive(provider:VaultProvider,head:VersionHead):Promise<{vault:EvidenceStore;ref:CivicVersionVaultRef}|null>{
  // Passing rawCaptureVault as a factory lets legacy field reads work without
  // opening a remote vault they never need. New writers carry the exact root.
  if(typeof provider==="function"&&head.legacy&&!head.ref)return null;
  const vault=typeof provider==="function"?provider():provider;
  const ref=head.ref??(head.fingerprint?await civicVersionRef(vault,head.fingerprint):null);
  return ref?{vault,ref}:null;
}
const sourceRoot=(head:VersionHead)=>head.current
  ? "SELECT payload AS value,0 AS depth FROM civic_data_promotions WHERE current_version_id=$1"
  : "SELECT candidate->'readModel' AS value,0 AS depth FROM civic_data_candidates WHERE id=$1";

/** Legacy versions keep their original rows; a legacy read selects only the requested path. */
export async function readCivicVersionPath(query:Query,vault:VaultProvider,id:string,path:readonly string[]):Promise<unknown>{
  const head=await versionHead(query,id);if(!head)return null;
  const archive=await versionArchive(vault,head);
  if(archive)return civicVersionVault(archive.vault).path(archive.ref,path);
  if(!head.current&&!head.legacy)throw new Error(`CIVIC_VERSION_VAULT_MISSING:${id}`);
  if(!path.length)throw new Error("CIVIC_VERSION_LEGACY_PATH_REQUIRED");
  const [row]=await query(`WITH RECURSIVE selected(value,depth) AS (
    ${sourceRoot(head)}
    UNION ALL SELECT CASE WHEN jsonb_typeof(reader_payload_node(value))='array' OR reader_payload_node(value)->>'kind'='array'
      THEN (SELECT item FROM reader_payload_members(value) WHERE ordinal_index=(($2::text[])[depth+1])::int+1)
      ELSE reader_payload_node(value)->($2::text[])[depth+1] END,depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ) SELECT reader_payload_value(value) AS value FROM selected ORDER BY depth DESC LIMIT 1`,[id,[...path]]);
  return row?.value??null;
}

/** The four historical readers can keep their exact version/row selection without downloading a former candidate. */
export async function readCivicVersionRows(query:Query,vault:VaultProvider,id:string,path:readonly string[],selection:CivicVersionRowSelection={}):Promise<readonly CivicVersionRow[]>{
  validateRowRange(selection);
  const head=await versionHead(query,id);if(!head)return [];
  const archive=await versionArchive(vault,head);
  if(archive)return civicVersionVault(archive.vault).rows(archive.ref,path,selection);
  if(!head.current&&!head.legacy)throw new Error(`CIVIC_VERSION_VAULT_MISSING:${id}`);
  const rows=await query(`WITH RECURSIVE selected(value,depth) AS (
    ${sourceRoot(head)}
    UNION ALL SELECT reader_payload_node(value)->($2::text[])[depth+1],depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ), members AS (SELECT ordinal_index,reader_payload_node(item) AS value FROM selected,
    LATERAL reader_payload_members(selected.value) WHERE depth=cardinality($2::text[]))
  SELECT ordinal_index AS ordinal,reader_payload_value(CASE WHEN $5::text[] IS NULL THEN value-$6::text[]
    ELSE (SELECT coalesce(jsonb_object_agg(key,value->key),'{}'::jsonb) FROM unnest($5::text[]) key WHERE value?key) END) AS value
  FROM members WHERE ordinal_index > $7::int AND ($3::text[] IS NULL OR reader_payload_value(value)#>>$3::text[]=ANY($4::text[])) ORDER BY ordinal_index LIMIT $8::int`,
    [id,[...path],selection.match?[...selection.match.path]:null,selection.match?[...selection.match.values]:null,
      selection.fields?[...selection.fields]:null,[...selection.omit??[]],selection.afterOrdinal??0,selection.limit??null]);
  return rows.map(row=>({ordinal:Number(row.ordinal),value:row.value as Record<string,unknown>}));
}

/** The archive planner can retain a lazy locator without fetching an old agenda's complete text. */
export async function readCivicVersionText(query:Query,vault:VaultProvider,id:string,path:readonly string[],range:CivicVersionTextRange={}):Promise<CivicVersionTextWindow|null>{
  const {offset,count}=textRange(range),head=await versionHead(query,id);if(!head)return null;
  const archive=await versionArchive(vault,head);
  if(archive)return civicVersionVault(archive.vault).text(archive.ref,path,range);
  if(!head.current&&!head.legacy)throw new Error(`CIVIC_VERSION_VAULT_MISSING:${id}`);
  if(!path.length)throw new Error("CIVIC_VERSION_LEGACY_PATH_REQUIRED");
  const [row]=await query(`WITH RECURSIVE selected(value,depth) AS (
    ${sourceRoot(head)}
    UNION ALL SELECT CASE WHEN jsonb_typeof(reader_payload_node(value))='array' OR reader_payload_node(value)->>'kind'='array'
      THEN (SELECT item FROM reader_payload_members(value) WHERE ordinal_index=(($2::text[])[depth+1])::int+1)
      ELSE reader_payload_node(value)->($2::text[])[depth+1] END,depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ), document AS (SELECT reader_payload_value(value)#>>'{}' AS text FROM selected WHERE depth=cardinality($2::text[]))
  SELECT substring(text FROM $3::int+1 FOR $4::int) AS text,char_length(text) AS total FROM document`,[id,[...path],offset,count]);
  if(typeof row?.text!=="string")return null;
  const totalLength=Number(row.total);
  return{text:row.text,offset:Math.min(offset,totalLength),nextOffset:Math.min(offset,totalLength)+[...row.text].length,totalLength,offsetUnit:"UNICODE_CODE_POINTS"};
}
