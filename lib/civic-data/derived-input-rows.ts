import type { Query } from "../facts/publish.ts";

export interface DerivedInputHead {
  readonly id:string;readonly recordClass:string;readonly scope:string;readonly state:string;
  readonly readModelSha256:string|null;readonly readModelKind:string|null;
}
export interface DerivedWiringRow {readonly key:string;readonly status:string;readonly officialHost:string;readonly route:string;}

/** Every promoted input's immutable envelope and GOOD normalized hash, without its source bodies. */
export async function readDerivedInputHeads(query:Query,ids:readonly string[]):Promise<readonly DerivedInputHead[]>{
  if(!ids.length)return [];
  const rows=await query(`SELECT c.id,c.record_class,c.scope,c.state,
    CASE WHEN c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.validation_receipt->>'decision'='GOOD' AND c.validation_receipt->>'candidateId'=c.id
      AND c.validation_receipt->>'recordClass'=c.record_class AND c.validation_receipt->>'scope'=c.scope
      AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)
      THEN c.normalized_hash ELSE NULL END AS read_model_hash,
    CASE WHEN c.record_class='CURATED_READER_RECORD' AND c.scope='US:meeting-source-wiring'
      THEN reader_payload_node(c.candidate->'readModel')->>'kind' END AS read_model_kind
    FROM civic_data_candidates c WHERE c.id=ANY($1::text[])`,[[...new Set(ids)]]);
  return rows.map(row=>({id:String(row.id),recordClass:String(row.record_class),scope:String(row.scope),state:String(row.state),
    readModelSha256:typeof row.read_model_hash==="string"?row.read_model_hash:null,readModelKind:typeof row.read_model_kind==="string"?row.read_model_kind:null}));
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
export async function readDerivedWiringRows(query:Query,id:string,keys:readonly string[]):Promise<readonly DerivedWiringRow[]>{
  if(!keys.length)return [];
  const rows=await query(`WITH current_rows AS MATERIALIZED (
      SELECT r.value FROM civic_data_rows r WHERE r.version_id=$1 AND r.collection='derivedWiring' AND r.row_id=ANY($2::text[])
    ), selected AS (
      SELECT value FROM current_rows UNION ALL
      SELECT reader_payload_node(m.item) FROM civic_data_candidates c,
        LATERAL reader_payload_members(reader_payload_node(c.candidate->'readModel')->'records') m
      WHERE c.id=$1 AND reader_payload_node(m.item)->>'id'=ANY($2::text[])
        AND NOT EXISTS(SELECT 1 FROM civic_data_rows r WHERE r.version_id=$1 AND r.collection='derivedWiring')
    ) SELECT value->>'id' AS key,value->>'status' AS status,
      lower(reader_payload_node(value->'row')->>'officialHost') AS official_host,
      reader_payload_node(value->'row')->>'route' AS route FROM selected`,[id,[...new Set(keys)]]);
  return rows.flatMap(row=>typeof row.key==="string"&&typeof row.status==="string"&&row.status.trim()&&typeof row.official_host==="string"&&row.official_host.trim()&&typeof row.route==="string"&&row.route.trim()
    ?[{key:row.key,status:row.status,officialHost:row.official_host,route:row.route}]:[]);
}
