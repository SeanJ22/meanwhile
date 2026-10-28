import type { Query } from "../facts/publish.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { readCivicCandidatePath, readCivicCandidateRows } from "./candidate-vault.ts";

export interface DerivedInputHead {
  readonly id:string;readonly recordClass:string;readonly scope:string;readonly state:string;
  readonly readModelSha256:string|null;readonly readModelKind:string|null;
}
export interface DerivedWiringRow {readonly key:string;readonly status:string;readonly officialHost:string;readonly route:string;}

/** Every promoted input's immutable envelope and GOOD normalized hash, without its source bodies. */
export async function readDerivedInputHeads(query:Query,ids:readonly string[],vault?:EvidenceStore|(()=>EvidenceStore)):Promise<readonly DerivedInputHead[]>{
  if(!ids.length)return [];
  const rows=await query(`SELECT c.id,c.record_class,c.scope,c.state,
    CASE WHEN c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.validation_receipt->>'decision'='GOOD' AND c.validation_receipt->>'candidateId'=c.id
      AND c.validation_receipt->>'recordClass'=c.record_class AND c.validation_receipt->>'scope'=c.scope
      AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)
      AND (p.current_version_id IS NULL OR p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
      THEN c.normalized_hash ELSE NULL END AS read_model_hash,
    (p.current_version_id IS NOT NULL) AS is_current,
    CASE WHEN c.record_class='CURATED_READER_RECORD' AND c.scope='US:meeting-source-wiring' AND p.current_version_id IS NOT NULL
      AND (p.current_version_id IS NULL OR p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
      THEN reader_payload_node(p.payload)->>'kind' END AS read_model_kind
    FROM civic_data_candidates c LEFT JOIN civic_data_promotions p ON p.current_version_id=c.id WHERE c.id=ANY($1::text[])`,[[...new Set(ids)]]);
  return Promise.all(rows.map(async row=>{
    const kind=typeof row.read_model_kind==="string"?row.read_model_kind:row.is_current!==true && row.record_class==="CURATED_READER_RECORD" && row.scope==="US:meeting-source-wiring"
      ? await readCivicCandidatePath(query,vault??(await import("./raw-capture-remote.ts")).rawCaptureVault,String(row.id),["readModel","kind"]) : null;
    return {id:String(row.id),recordClass:String(row.record_class),scope:String(row.scope),state:String(row.state),
      readModelSha256:typeof row.read_model_hash==="string"?row.read_model_hash:null,readModelKind:typeof kind==="string"?kind:null};
  }));
}

export function selectDerivedWiringRows(value:unknown,keys:readonly string[]):readonly DerivedWiringRow[]{
  const model=value as {records?:unknown[]}|null;
  return (Array.isArray(model?.records)?model.records:[]).flatMap(value=>{
    const row=value as {id?:unknown;status?:unknown;row?:{officialHost?:unknown;route?:unknown}};
    return typeof row?.id==="string"&&keys.includes(row.id)&&typeof row.status==="string"&&row.status.trim()&&
      typeof row.row?.officialHost==="string"&&row.row.officialHost.trim()&&typeof row.row.route==="string"&&row.row.route.trim()
      ?[{key:row.id,status:row.status,officialHost:row.row.officialHost.toLowerCase(),route:row.row.route}]:[];
  });
}

/** Current keyed wiring or exact immutable historical members; neither path returns unrelated wiring rows. */
export async function readDerivedWiringRows(query:Query,id:string,keys:readonly string[],vault?:EvidenceStore|(()=>EvidenceStore)):Promise<readonly DerivedWiringRow[]>{
  if(!keys.length)return [];
  const [head]=await query(`SELECT p.key AS current_key,(p.current_version_id IS NULL OR p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint) AS valid
    FROM civic_data_candidates c LEFT JOIN civic_data_promotions p ON p.current_version_id=c.id WHERE c.id=$1`,[id]);
  if(!head || head.valid!==true)return [];
  if(!head.current_key){
    const provider=vault??(await import("./raw-capture-remote.ts")).rawCaptureVault;
    const rows=await readCivicCandidateRows(query,provider,id,["records"],{match:{path:["id"],values:[...new Set(keys)]},fields:["id","status"]});
    const records=await Promise.all(rows.map(async ({ordinal,value})=>{
      const base=["readModel","records",String(ordinal-1),"row"];
      const [officialHost,route]=await Promise.all([readCivicCandidatePath(query,provider,id,[...base,"officialHost"]),
        readCivicCandidatePath(query,provider,id,[...base,"route"])]);
      return {...value,row:{officialHost,route}};
    }));
    return selectDerivedWiringRows({records},keys);
  }
  const rows=await query(`WITH source AS MATERIALIZED (
      SELECT c.id,p.key AS current_key FROM civic_data_candidates c
      LEFT JOIN civic_data_promotions p ON p.current_version_id=c.id WHERE c.id=$1
        AND (p.current_version_id IS NULL OR p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
    ), current_rows AS MATERIALIZED (
      SELECT r.value FROM source JOIN civic_data_rows r ON r.version_id=source.id
      WHERE r.collection='derivedWiring' AND r.row_id=ANY($2::text[])
    ), selected AS (
      SELECT value FROM current_rows UNION ALL
      SELECT reader_payload_node(m.item) FROM source JOIN civic_data_promotions p ON p.key=source.current_key,
        LATERAL reader_payload_members(reader_payload_node(p.payload)->'records') m
      WHERE reader_payload_node(m.item)->>'id'=ANY($2::text[])
        AND NOT EXISTS(SELECT 1 FROM civic_data_rows r WHERE r.version_id=$1 AND r.collection='derivedWiring')
    ) SELECT value->>'id' AS key,value->>'status' AS status,
      lower(reader_payload_node(value->'row')->>'officialHost') AS official_host,
      reader_payload_node(value->'row')->>'route' AS route FROM selected`,[id,[...new Set(keys)]]);
  return rows.flatMap(row=>typeof row.key==="string"&&typeof row.status==="string"&&row.status.trim()&&typeof row.official_host==="string"&&row.official_host.trim()&&typeof row.route==="string"&&row.route.trim()
    ?[{key:row.key,status:row.status,officialHost:row.official_host,route:row.route}]:[]);
}
