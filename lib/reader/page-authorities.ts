import { currentReaderSelection } from "../db/reader-route.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Statement } from "../control-plane/admin-view/promoted-slices.ts";

export type PageAdditional=Statement & {readonly canonicalKeys?:true;readonly pageId?:string};
export const AUTHORITY_FIELDS="key text,record_class text,scope text,source_id text,current_version_id text,last_known_good_version_id text,promoted_at text,validation_receipt jsonb,payload jsonb,normalized_hash text,retrieved_at text,confirmation text,published boolean";
export const AUTHORITY_COLUMNS="key,record_class,scope,source_id,current_version_id,last_known_good_version_id,promoted_at,validation_receipt,payload,normalized_hash,retrieved_at,confirmation,published";

export function statePageId(state:string):string {
  const place=Object.values(FIPS_TO_STATE).find(row=>row.postal===state.toUpperCase());
  if(!place)throw new Error(`Unknown state ${state}`);
  return `ocd-division/country:us/${place.prefix}:${state.toLowerCase()}`;
}

/** A source section belongs to the selected ZIP, its own division, or its state page. */
export function authorityPageId(key:string):string {
  const selection=currentReaderSelection();
  const state=key.includes('+US-')?undefined:/(?:US-|\/(?:state|territory|district):)([a-z]{2})(?:[:/]|$)/i.exec(key)?.[1]?.toUpperCase();
  if(selection?.zip && (!state || !selection.states?.length || selection.states[0]===state))return `zip:${selection.zip}`;
  const translation="CURATED_READER_RECORD:US:plain-english-translations:";
  if(key.startsWith(translation))return key.slice(translation.length);
  return state?statePageId(state):selection?.states?.length===1?statePageId(selection.states[0]):'ocd-division/country:us';
}

/** Each requested section is selected by its page primary key and its own source key. */
export function savedCanonicalStatement(keys:readonly string[],additional?:PageAdditional):Statement {
  const requested=keys.map(key=>({key,page_id:authorityPageId(key)}));
  const extraSql=additional?.text.replace(/\$(\d+)/g,(_,n:string)=>`$${Number(n)+1}`);
  const more=additional?.canonicalKeys && additional.pageId
    ? ` UNION SELECT unnest(canonical_keys),${quote(additional.pageId)} FROM additional` : '';
  const pages=[...new Set([...requested.map(row=>row.page_id),...additional?.pageId?[additional.pageId]:[]])];
  const shelf=`SELECT p.* FROM requested r JOIN place_page page ON page.place_id=r.page_id
    CROSS JOIN LATERAL jsonb_to_record(page.context->'authorities'->r.key) AS p(${AUTHORITY_FIELDS}) WHERE p.key IS NOT NULL`;
  const empty=`SELECT ${AUTHORITY_COLUMNS} FROM shelf LIMIT 0`;
  return {params:[JSON.stringify(requested),...additional?.params??[]],text:`WITH
    ${additional?`additional AS MATERIALIZED (${extraSql}),`:''}
    requested AS (SELECT key,page_id FROM jsonb_to_recordset($1::jsonb) r(key text,page_id text)${more}),
    shelf AS MATERIALIZED (${shelf})
    SELECT 'promotion' AS row_kind,shelf.*,NULL::text AS part_hash,NULL::jsonb AS part_payload FROM shelf
    UNION ALL SELECT 'missing-page',empty.*,id,to_jsonb(ARRAY(SELECT key FROM requested r WHERE r.page_id=id)) FROM unnest(ARRAY[${pages.map(quote).join(',')}]::text[]) AS wanted(id)
      LEFT JOIN LATERAL (${empty}) empty ON true
      WHERE NOT EXISTS(SELECT 1 FROM place_page page WHERE page.place_id=id AND page.context->>'authorityFormat'='1'
        AND NOT EXISTS(SELECT 1 FROM requested r WHERE r.page_id=id AND NOT (coalesce(page.context->'authorityKeys','[]'::jsonb)?r.key OR page.context->'authorities'?r.key)))
    ${additional?`UNION ALL SELECT 'additional',empty.*,NULL,coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM additional a),'[]'::jsonb)
      FROM (SELECT 1) singleton LEFT JOIN LATERAL (${empty}) empty ON true`:''}`};
}

/** The keyed source metadata and Checked dates were resolved when the page was built. */
export function savedSelectedPointerSql():string {
  const zip=currentReaderSelection()?.zip;
  const root=zip?quote(`zip:${zip}`):`coalesce((SELECT 'ocd-division/country:us/'||CASE WHEN upper(match[1])='DC' THEN 'district'
    WHEN upper(match[1]) IN ('AS','GU','MP','PR','VI') THEN 'territory' ELSE 'state' END||':'||lower(match[1])
    FROM regexp_match($1::text,'(?:US-|/(?:state|territory|district):)([A-Za-z]{2})(?:[:/]|$)') AS match),'ocd-division/country:us')`;
  return `SELECT p.* FROM place_page page CROSS JOIN LATERAL jsonb_each(page.context->'authorities') section
    CROSS JOIN LATERAL jsonb_to_record(section.value) AS p(${AUTHORITY_FIELDS}) WHERE p.key=$1 AND page.place_id=${root}`;
}

const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
