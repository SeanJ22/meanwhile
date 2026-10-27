import { recordFactConfirmation } from "../facts/confirmation.ts";
import type {FactDb,Query} from "../facts/publish.ts";
import {enqueueReaderPlaces,invalidateReaderCache,type ReaderCachePurger} from "../reader/cache.ts";
import {campaignFinanceSource} from "./state-sources.ts";

export async function rebuildCampaignCycles(db:FactDb,state:string,people:readonly string[],at:string,purge?:ReaderCachePurger):Promise<void> {
  if(people.length>500)throw new Error("Campaign cycle work exceeds one people batch");
  if(!people.length)return;
  const rules=campaignFinanceSource(state).resources.map(resource=>({id:resource.id,aggregation:resource.aggregation??null}));
  const changed=await db.transaction(async query=>{
    await query(`CREATE TEMP TABLE money_input ON COMMIT DROP AS
      SELECT f.entity_id,e.parent_id,f.value->>'filerName' AS committee,f.value,f.source_copy_id,f.checked_at,
        CASE WHEN value->>'transactionDate' ~ '^\\d{4}-' THEN substr(value->>'transactionDate',1,4)::int
          WHEN value->>'transactionDate' ~ '^\\d{1,2}/\\d{1,2}/\\d{4}' THEN substring(value->>'transactionDate' from '^\\d{1,2}/\\d{1,2}/(\\d{4})')::int
          ELSE substring(value->>'period' from '(20[0-9]{2})')::int END AS year,
        rule->>'aggregation' AS aggregation
      FROM entity e JOIN entity p ON p.id=e.parent_id AND p.kind='person' AND p.state=$1
      JOIN checked_fact f ON f.entity_id=e.id AND f.status='live' AND f.field LIKE 'campaign-money:%'
      JOIN jsonb_array_elements($3::jsonb) config(rule) ON value->>'resource'=rule->>'id' OR value->>'resource' LIKE (rule->>'id')||':%'
      WHERE e.state=$1 AND e.parent_id=ANY($2::text[]) AND value#>>'{person,id}'=e.parent_id
        AND value#>>'{person,name}'=p.name AND value->>'filingState'='FILED'
    `,[state,people,JSON.stringify(rules)]);
    // KREF repeats a receipt in election exports under different election and
    // statement labels. Keep the maximum multiplicity in any one export, rather
    // than summing copies of the same transaction across those exports.
    await query(`CREATE TEMP TABLE money_rows ON COMMIT DROP AS WITH keyed AS (
      SELECT entity_id,parent_id,committee,value,source_copy_id,checked_at,year,aggregation,
        CASE WHEN $1='KY' THEN jsonb_build_array(value->>'filerName',value->>'candidateName',value->>'office',
          value->>'filedDistrict',value->>'filedJurisdiction',value->>'transactionDate',value->'amounts',value->'donor',
          (SELECT jsonb_agg(q ORDER BY q->>'label',q->>'value') FROM jsonb_array_elements(value->'qualifiers') q
            WHERE q->>'label' NOT IN ('Filed statement','Election type')))
        ELSE to_jsonb(value->>'id') END AS transaction_key
      FROM money_input
    ), numbered AS (
      SELECT entity_id,parent_id,committee,value,source_copy_id,checked_at,year,aggregation,transaction_key,
        row_number() OVER (PARTITION BY entity_id,value->>'cycle',transaction_key,value#>>'{provenance,url}' ORDER BY value->>'id') AS occurrence
      FROM keyed
    ) SELECT DISTINCT ON(entity_id,value->>'cycle',transaction_key,occurrence)
      entity_id,parent_id,committee,value,source_copy_id,checked_at,year,aggregation
      FROM numbered ORDER BY entity_id,value->>'cycle',transaction_key,occurrence,
        value#>>'{provenance,publicationDate}' DESC NULLS LAST,value#>>'{provenance,url}',value->>'id'`,[state]);
    await query("CREATE INDEX ON money_rows(entity_id,((value->>'cycle')::int))");
    await query("CREATE INDEX ON money_rows(parent_id,((value->>'cycle')::int),(value#>>'{donor,key}'))");
    await query("ANALYZE money_rows");
    await query(`CREATE TEMP TABLE money_cycles ON COMMIT DROP AS WITH amounts AS (
      SELECT r.entity_id,r.value,r.aggregation,(value->>'cycle')::int AS cycle,a.item->>'label' AS label,(a.item->>'amount')::numeric AS amount
      FROM money_rows r CROSS JOIN LATERAL jsonb_array_elements(r.value->'amounts') a(item)
      WHERE year>=2020 AND (value->>'cycle')::int>=2020 AND aggregation IN ('TRANSACTION','CYCLE_TOTAL')
    ), sums AS (
      SELECT entity_id,cycle,label,sum(amount) AS amount FROM amounts WHERE aggregation='TRANSACTION' GROUP BY entity_id,cycle,label
    ), latest AS (
      SELECT DISTINCT ON(entity_id,cycle,label) entity_id,cycle,label,amount FROM amounts WHERE aggregation='CYCLE_TOTAL'
      ORDER BY entity_id,cycle,label,coalesce(value#>>'{provenance,publicationDate}',value#>>'{provenance,retrievedAt}') DESC NULLS LAST,value#>>'{provenance,url}',value->>'id'
    ), totals AS (
      SELECT entity_id,cycle,label,amount FROM latest
      UNION ALL SELECT s.entity_id,s.cycle,s.label,s.amount FROM sums s WHERE NOT EXISTS(SELECT 1 FROM latest l WHERE l.entity_id=s.entity_id AND l.cycle=s.cycle AND l.label=s.label)
    ), metadata AS (
      SELECT DISTINCT ON (entity_id,(value->>'cycle')::int) entity_id,parent_id,committee,(value->>'cycle')::int AS cycle,value->'person' AS person,source_copy_id
      FROM money_rows WHERE year>=2020 AND (value->>'cycle')::int>=2020 ORDER BY entity_id,(value->>'cycle')::int,value#>>'{provenance,publicationDate}' DESC NULLS LAST,value#>>'{provenance,url}',value->>'id'
    ), sources AS (
      SELECT entity_id,cycle,jsonb_agg(source ORDER BY source->>'rawHash',source->>'filingUrl') AS sources FROM (
        SELECT DISTINCT ON (entity_id,(value->>'cycle')::int,source->>'rawHash',source->>'filingUrl') entity_id,(value->>'cycle')::int AS cycle,source
        FROM money_rows CROSS JOIN LATERAL (
          SELECT (value->'provenance')||jsonb_build_object('filingUrl',value->>'filingUrl') AS source
          UNION ALL SELECT (amount->'provenance')||jsonb_build_object('filingUrl',coalesce(amount#>>'{provenance,filingUrl}',amount#>>'{provenance,url}'))
            FROM jsonb_array_elements(value->'amounts') a(amount) WHERE amount?'provenance'
        ) evidence WHERE year>=2020 AND (value->>'cycle')::int>=2020
          ORDER BY entity_id,(value->>'cycle')::int,source->>'rawHash',source->>'filingUrl',value#>>'{provenance,publicationDate}' DESC NULLS LAST,value#>>'{provenance,url}',value->>'id'
      ) s GROUP BY entity_id,cycle
    ) SELECT m.parent_id AS entity_id,'campaign-cycle:'||m.entity_id||':'||m.cycle AS field,m.source_copy_id,
      (SELECT min(r.checked_at) FROM money_rows r WHERE r.entity_id=m.entity_id AND (r.value->>'cycle')::int=m.cycle) AS checked_at,
      jsonb_build_object('id',m.entity_id||':'||m.cycle,'person',m.person,'committee',m.committee,'cycle',m.cycle,
        'totals',jsonb_agg(jsonb_build_object('label',t.label,'amount',t.amount) ORDER BY t.label),'sources',s.sources,
        'individualSmall',(SELECT (r.value#>>'{individualLines,small}')::numeric FROM money_rows r WHERE r.entity_id=m.entity_id AND (value->>'cycle')::int=m.cycle AND r.value?'individualLines' ORDER BY r.value#>>'{provenance,publicationDate}' DESC NULLS LAST,r.value#>>'{provenance,url}',r.value->>'id' LIMIT 1),
        'individualLarge',(SELECT (r.value#>>'{individualLines,large}')::numeric FROM money_rows r WHERE r.entity_id=m.entity_id AND (value->>'cycle')::int=m.cycle AND r.value?'individualLines' ORDER BY r.value#>>'{provenance,publicationDate}' DESC NULLS LAST,r.value#>>'{provenance,url}',r.value->>'id' LIMIT 1)) AS value
      FROM metadata m JOIN totals t ON t.entity_id=m.entity_id AND t.cycle=m.cycle JOIN sources s ON s.entity_id=m.entity_id AND s.cycle=m.cycle
      GROUP BY m.parent_id,m.entity_id,m.cycle,m.source_copy_id,m.person,m.committee,s.sources`);
    const cycles=await replaceCycles(query,at);
    const removedCycles=await query(`UPDATE fact f SET status='superseded' WHERE f.entity_id=ANY($1::text[]) AND f.field LIKE 'campaign-cycle:%' AND f.status='live'
      AND EXISTS(SELECT 1 FROM entity c JOIN fact raw ON raw.entity_id=c.id AND raw.field LIKE 'campaign-money:%' AND raw.produced_by LIKE 'campaign-person-money:'||$2||':%'
        WHERE c.parent_id=f.entity_id AND raw.value->>'cycle'=f.value->>'cycle' AND f.field LIKE 'campaign-cycle:'||c.id||':%')
      AND NOT EXISTS(SELECT 1 FROM money_cycles n WHERE n.entity_id=f.entity_id AND n.field=f.field) RETURNING f.entity_id`,[people,state]);
    await query(`CREATE TEMP TABLE money_donors ON COMMIT DROP AS WITH totals AS (
      SELECT parent_id,(value->>'cycle')::int AS cycle,value#>>'{donor,key}' AS key,sum((value#>>'{donor,amount}')::numeric) AS amount,min(checked_at) AS checked_at
      FROM money_rows WHERE year>=2020 AND (value->>'cycle')::int>=2020 AND aggregation='TRANSACTION' AND value?'donor'
      GROUP BY parent_id,(value->>'cycle')::int,value#>>'{donor,key}'
    ) SELECT t.parent_id AS entity_id,'campaign-donor:'||md5(t.parent_id||':'||t.cycle||':'||t.key) AS field,m.source_copy_id,t.checked_at,
      jsonb_build_object('person',m.value->'person','cycle',t.cycle,'key',t.key,'kind',m.value#>>'{donor,kind}',
        'filedName',m.value#>>'{donor,filedName}','amount',t.amount,'filingUrl',m.value->>'filingUrl','source',m.value->'provenance') AS value
      FROM totals t CROSS JOIN LATERAL (
        SELECT r.value,r.source_copy_id FROM money_rows r WHERE r.parent_id=t.parent_id AND (r.value->>'cycle')::int=t.cycle
          AND r.value#>>'{donor,key}'=t.key AND r.year>=2020 AND r.aggregation='TRANSACTION'
        ORDER BY r.value#>>'{provenance,publicationDate}' DESC NULLS LAST,r.value#>>'{provenance,url}',r.value->>'id' LIMIT 1
      ) m WHERE m.value#>>'{donor,kind}'='COMMITTEE_OR_ORGANIZATION' OR t.amount>200`);
    const removedDonors=await query(`UPDATE fact f SET status='superseded' WHERE entity_id=ANY($1::text[]) AND field LIKE 'campaign-donor:%' AND status='live'
      AND NOT EXISTS(SELECT 1 FROM money_donors n WHERE n.entity_id=f.entity_id AND n.field=f.field AND (n.value#>'{person,id}',n.value->'cycle',n.value->'key',n.value->'kind',n.value->'filedName',n.value->'amount') IS NOT DISTINCT FROM (f.value#>'{person,id}',f.value->'cycle',f.value->'key',f.value->'kind',f.value->'filedName',f.value->'amount')) RETURNING entity_id`,[people]);
    const addedDonors=await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
      SELECT n.entity_id,n.field,n.value,n.value->>'filedName','live','OFFICIAL',n.source_copy_id,'',$1,$1,'campaign-money',0 FROM money_donors n
      WHERE NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=n.entity_id AND f.field=n.field AND f.status='live' AND (f.value#>'{person,id}',f.value->'cycle',f.value->'key',f.value->'kind',f.value->'filedName',f.value->'amount') IS NOT DISTINCT FROM (n.value#>'{person,id}',n.value->'cycle',n.value->'key',n.value->'kind',n.value->'filedName',n.value->'amount')) RETURNING entity_id`,[at]);
    const donorChecks=await query(`SELECT n.source_copy_id,n.checked_at,array_agg(f.id) AS ids
      FROM money_donors n JOIN checked_fact f ON f.entity_id=n.entity_id AND f.field=n.field AND f.status='live'
      WHERE n.checked_at>f.checked_at GROUP BY n.source_copy_id,n.checked_at`);
    const donorConfirmed=new Set<string>();
    for(const row of donorChecks) for(const id of await recordFactConfirmation(query,{copyId:Number(row.source_copy_id),scope:"campaign-donors",at:new Date(row.checked_at as string).toISOString(),factIds:row.ids as number[]}))donorConfirmed.add(id);
    const affected=[...new Set([...cycles,...donorConfirmed,...[...removedCycles,...removedDonors,...addedDonors].map(row=>String(row.entity_id))])];
    if(affected.length)await enqueueReaderPlaces({entities:affected},query);
    return affected.length>0;
  });
  if(changed)await invalidateReaderCache({states:[state]},purge,null);
}

export async function replaceCycles(query:Query,at:string):Promise<readonly string[]> {
  const confirmations=await query(`SELECT n.source_copy_id,n.checked_at,array_agg(f.id) AS ids
    FROM money_cycles n JOIN checked_fact f ON f.entity_id=n.entity_id AND f.field=n.field AND f.status='live' AND f.value-'sources'=n.value-'sources'
    WHERE n.checked_at>f.checked_at GROUP BY n.source_copy_id,n.checked_at`);
  const confirmed=new Set<string>();
  for(const row of confirmations) for(const id of await recordFactConfirmation(query,{copyId:Number(row.source_copy_id),scope:"campaign-cycles",at:new Date(row.checked_at as string).toISOString(),factIds:row.ids as number[]}))confirmed.add(id);
  const removed=await query(`UPDATE fact f SET status='superseded' FROM money_cycles n WHERE f.entity_id=n.entity_id AND f.field=n.field AND f.status='live' AND f.value-'sources'<>n.value-'sources' AND n.checked_at>=(SELECT checked_at FROM checked_fact WHERE id=f.id) RETURNING f.entity_id`);
  const added=await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
    SELECT n.entity_id,n.field,n.value,n.value->>'committee','live','OFFICIAL',n.source_copy_id,'',n.checked_at,$1,'campaign-money',0 FROM money_cycles n
    WHERE NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=n.entity_id AND f.field=n.field AND f.status='live') RETURNING entity_id`,[at]);
  return [...new Set([...confirmed,...[...removed,...added].map(row=>String(row.entity_id))])];
}
