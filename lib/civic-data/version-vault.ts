import { isCivicPayloadPart } from "./payload-ref.ts";
import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { Query } from "../facts/publish.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { CivicPayloadParts, type CivicPayloadPartIO } from "./payload-parts.ts";
import { partitionCivicPayload } from "./payload-codec.ts";

export interface CivicVersionVaultRef {
  readonly formatVersion: 1;
  readonly fingerprint: string;
  readonly root: string;
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
  const ref:CivicVersionVaultRef={formatVersion:1,fingerprint,root};
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
}
export interface CivicVersionRow {readonly ordinal: number; readonly value: Record<string,unknown>}

/** This accessor reads paths and selected rows; it never opens the stored candidate envelope. */
export function civicVersionVault(vault: EvidenceStore) {
  const parts = new CivicPayloadParts(factIO(vault));
  const rootOf = (ref: CivicVersionVaultRef) => {
    if (ref.formatVersion !== 1 || !/^[a-f0-9]{64}$/.test(ref.fingerprint)) throw new Error("CIVIC_VERSION_VAULT_REF_INVALID");
    keyOf(ref.root);
    return {$civicPayloadPart:ref.root};
  };
  const nodeOf = async (value: unknown): Promise<unknown> => {
    const node = await parts.node(value) as Node | null;
    return node?.kind === "object" ? node.value : node;
  };
  const pathOf = async (root: unknown, path: readonly string[]): Promise<unknown> => {
    let value = root;
    for (const key of path) {
      const node = await nodeOf(value) as Node | null;
      if (node?.kind === "array" && /^\d+$/.test(key)) {
        const index = Number(key), order = JSON.parse(await parts.load(node.order) as string) as number[];
        if (index >= order.length) return undefined;
        const group = order[index], position = order.slice(0,index).filter(value=>value===group).length;
        value = (await parts.node(node.groups![group]) as unknown[])[position];
      } else value = node !== null && typeof node === "object" && Object.hasOwn(node,key)
        ? (node as Record<string,unknown>)[key] : undefined;
    }
    return value;
  };
  async function* encodedRows(value: unknown): AsyncGenerator<unknown> {
    const node = await nodeOf(value) as Node | unknown[] | null;
    if (Array.isArray(node)) { yield* node; return; }
    if (node?.kind !== "array" || !Array.isArray(node.groups)) throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
    const order = JSON.parse(await parts.load(node.order) as string) as number[];
    const remaining = new Map<number,number>();
    for(const group of order)remaining.set(group,(remaining.get(group)??0)+1);
    const held = new Map<number,{rows:unknown[];next:number}>();
    for(const group of order){
      let chunk=held.get(group);
      if(!chunk){const rows=await parts.node(node.groups[group]);if(!Array.isArray(rows))throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
        chunk={rows,next:0};held.set(group,chunk);}
      if(chunk.next>=chunk.rows.length)throw new Error("CIVIC_VERSION_COLLECTION_INVALID");
      yield chunk.rows[chunk.next++];
      remaining.set(group,remaining.get(group)!-1);if(!remaining.get(group))held.delete(group);
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
    async rows(ref:CivicVersionVaultRef,path:readonly string[],selection:CivicVersionRowSelection={}):Promise<readonly CivicVersionRow[]>{
      const value=await pathOf(rootOf(ref),path);if(value===undefined)return [];
      const rows:CivicVersionRow[]=[],wanted=selection.match?new Set(selection.match.values):null;
      if(wanted?.size===0)return [];
      let ordinal=0;
      for await(const encoded of encodedRows(value)){
        ordinal++;
        if(selection.match&&!wanted!.has(String(await parts.load(await pathOf(encoded,selection.match.path)))))continue;
        const node=await nodeOf(encoded);if(!node||typeof node!=="object"||Array.isArray(node))throw new Error("CIVIC_VERSION_ROW_INVALID");
        const fields=selection.fields??Object.keys(node).filter(key=>!selection.omit?.includes(key));
        const selected=Object.fromEntries(fields.filter(key=>Object.hasOwn(node,key)).map(key=>[key,(node as Record<string,unknown>)[key]]));
        rows.push({ordinal,value:await parts.load(selected) as Record<string,unknown>});
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
  FROM members WHERE $3::text[] IS NULL OR reader_payload_value(value)#>>$3::text[]=ANY($4::text[]) ORDER BY ordinal_index`,
    [id,[...path],selection.match?[...selection.match.path]:null,selection.match?[...selection.match.values]:null,
      selection.fields?[...selection.fields]:null,[...selection.omit??[]]]);
  return rows.map(row=>({ordinal:Number(row.ordinal),value:row.value as Record<string,unknown>}));
}
