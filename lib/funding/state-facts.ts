import { recordFactConfirmation } from "../facts/confirmation.ts";
import { createHash } from "node:crypto";
import { campaignRecordYear } from "./state-people.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { campaignFinanceStateScope } from "./state-sources.ts";
import { campaignSourceRecordHash, type CampaignSourceRecord } from "./state-source-records.ts";
import { enqueueReaderPlaces, invalidateReaderCache, type ReaderCachePurger } from "../reader/cache.ts";

const FIELD = "campaign-money:";
const SCHEME = "campaign-money-record";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const checkedAt=(row:CampaignSourceRecord,at:string)=>[row.provenance.checkedAt??at,...row.amounts.flatMap(amount=>amount.provenance
  ? [amount.provenance.checkedAt??amount.provenance.retrievedAt]:[])].sort()[0];
function campaignStateDivision(state: string): string {
  const place = US_JURISDICTIONS.find(place => place.usps === state);
  if (!place) throw new Error("Campaign money requires a supported state.");
  return `ocd-division/country:us/${place.prefix}:${place.slug}`;
}
const committeeId = (row: CampaignSourceRecord) => `campaign-committee:${row.state}:${digest(JSON.stringify([row.provenance.publisher, row.filerId ?? [row.filerName, row.candidateName, row.office, row.cycle], row.person?.id, row.person?.seat]))}`;

interface HeldFact { readonly entity_id: string; readonly field: string; readonly fingerprint: string|null; readonly retrieved_at:string; readonly provenance_kind: string; readonly id: number }

export async function readCampaignPredecessors(query: Query, state: string, records: readonly CampaignSourceRecord[]): Promise<ReadonlyMap<string, Pick<CampaignSourceRecord,"amounts"|"provenance"|"filingUrl">>> {
  if (records.length > 500) throw new Error("Campaign predecessors exceed one source batch.");
  const held = await query(`SELECT x.value AS record_id,f.value->'amounts' AS amounts,f.value->'provenance' AS provenance,f.value->>'filingUrl' AS filing_url FROM entity_external_id x JOIN entity e ON e.id=x.entity_id
    JOIN fact f ON f.entity_id=e.id AND f.field=$3||x.value AND f.status='live'
    JOIN unnest($2::text[],$5::text[]) expected(record_id,committee_id) ON expected.record_id=x.value AND expected.committee_id=e.id
    WHERE x.scheme=$1 AND x.value=ANY($2::text[]) AND e.state=$4`, [SCHEME, records.map(row=>row.id), FIELD, state, records.map(committeeId)]);
  return new Map(held.map(row => [String(row.record_id), {amounts:row.amounts as CampaignSourceRecord["amounts"],provenance:row.provenance as CampaignSourceRecord["provenance"],filingUrl:String(row.filing_url)}]));
}

export async function fileCampaignMoneyFacts(db: FactDb, state: string, records: readonly CampaignSourceRecord[], at: string,
  options: { readonly purge?: ReaderCachePurger; readonly onMoved?: (people:readonly string[])=>void } = {}): Promise<{ written: number; confirmed: number }> {
  if (records.length > 500 || records.some(row => row.state !== state || row.governmentOcdId !== null && campaignFinanceStateScope(row.governmentOcdId) !== `US-${state}:campaign-finance`)) throw new Error("Campaign facts exceed their state or source batch.");
  records = records.filter(row => row.person?.id && row.person.seat && row.person.sourceUrl && row.filerName && (campaignRecordYear(row) ?? 0) >= 2020);
  if (!records.length) return { written: 0, confirmed: 0 };
  const outcome = await db.transaction(async query => {
    const stateDivision = campaignStateDivision(state);
    const places = [...new Set([stateDivision, ...records.flatMap(row => row.governmentOcdId ?? [])])];
    const addedPlaces = await query(`INSERT INTO entity (id,kind,name,state,parent_id)
      SELECT id,'place',id,$2,CASE WHEN id<>$3 THEN $3 END FROM unnest($1::text[]) id ON CONFLICT DO NOTHING RETURNING id`, [places, state, stateDivision]);
    const persons = [...new Map(records.map(row => [row.person!.id, row.person!])).values()];
    const addedPeople = await query(`INSERT INTO entity (id,kind,name,state) SELECT id,'person',name,$3 FROM unnest($1::text[],$2::text[]) p(id,name)
      ON CONFLICT DO NOTHING RETURNING id`, [persons.map(person => person.id), persons.map(person => person.name), state]);
    const committees = [...new Map(records.map(row => [committeeId(row), row])).entries()];
    const changedCommittees = await query(`WITH previous AS MATERIALIZED (
      SELECT id,parent_id FROM entity WHERE id=ANY($1::text[])
    ), changed AS (INSERT INTO entity (id,kind,name,state,parent_id)
      SELECT id,'committee',name,$4,parent FROM unnest($1::text[],$2::text[],$3::text[]) c(id,name,parent)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id WHERE entity.state=EXCLUDED.state AND entity.kind='committee'
        AND (entity.name IS DISTINCT FROM EXCLUDED.name OR entity.parent_id IS DISTINCT FROM EXCLUDED.parent_id) RETURNING id
    ) SELECT id,(SELECT parent_id FROM previous WHERE previous.id=changed.id) AS previous_parent FROM changed`,
    [committees.map(([id]) => id), committees.map(([, row]) => row.filerName!), committees.map(([, row]) => row.person!.id), state]);
    const links = [...new Map(records.flatMap(row => [committeeId(row),row.person!.id].flatMap(entity=>[...new Set([stateDivision, ...(row.governmentOcdId ? [row.governmentOcdId] : [])])]
      .map(place => [`${entity}:${place}`, [entity, place]] as const)))).values()];
    const placed = await query(`INSERT INTO entity_place (entity_id,place_id) SELECT * FROM unnest($1::text[],$2::text[]) ON CONFLICT DO NOTHING RETURNING entity_id`, [links.map(link => link[0]), links.map(link => link[1])]);
    const affected = new Set([...addedPlaces, ...addedPeople, ...changedCommittees].map(row => String(row.id)));
    for (const row of changedCommittees) if (typeof row.previous_parent === "string") affected.add(row.previous_parent);
    for (const row of placed) affected.add(String(row.entity_id));
    const previous = await query(`SELECT f.id,f.entity_id,f.field,f.value->>'fingerprint' AS fingerprint,f.value#>>'{provenance,retrievedAt}' AS retrieved_at,f.provenance_kind FROM entity_external_id x JOIN entity e ON e.id=x.entity_id
      JOIN fact f ON f.entity_id=e.id AND f.field=$3||x.value AND f.status='live'
      WHERE x.scheme=$1 AND x.value=ANY($2::text[]) AND e.state=$4 FOR UPDATE OF f`, [SCHEME, records.map(row => row.id), FIELD, state]) as unknown as readonly HeldFact[];
    const byId = new Map(previous.map(row => [row.field.slice(FIELD.length), row]));
    const changed: CampaignSourceRecord[] = [], confirmed: {id:number;row:CampaignSourceRecord}[] = [], replaced: number[] = [];
    for (const row of records) {
      const old = byId.get(row.id);
      if (old && (old.provenance_kind === "OWNER" || Date.parse(old.retrieved_at) > Date.parse(row.provenance.retrievedAt))) continue;
      if (old && old.fingerprint === campaignSourceRecordHash(row) && old.entity_id === committeeId(row)) { confirmed.push({id:old.id,row}); continue; }
      changed.push(row);
      if (old) replaced.push(old.id);
    }
    const captures = [...new Map([...changed,...confirmed.map(item=>item.row)].map(row => [row.provenance.vaultKey, row.provenance])).values()];
    await query(`INSERT INTO source_copy (url,final_url,fetched_at,http_status,sha256,blob_key,is_archive)
      SELECT url,url,fetched::timestamptz,200,hash,key,false FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) s(url,fetched,hash,key)
      ON CONFLICT (blob_key) DO NOTHING`,
    [captures.map(source => source.url.split("#")[0]), captures.map(source => source.retrievedAt), captures.map(source => source.rawHash), captures.map(source => source.vaultKey)]);
    const copies = await query("SELECT id,blob_key FROM source_copy WHERE blob_key=ANY($1::text[])",[captures.map(source=>source.vaultKey)]);
    const sourceIds = new Map(copies.map(copy => [String(copy.blob_key), Number(copy.id)]));
    const confirmationGroups = new Map<string,{copyId:number;at:string;ids:number[]}>();
    for (const item of confirmed) {
      const copyId=sourceIds.get(item.row.provenance.vaultKey)!;
      const checked=checkedAt(item.row,at);
      const key=JSON.stringify([copyId,checked]);
      const group=confirmationGroups.get(key) ?? {copyId,at:checked,ids:[]};
      group.ids.push(item.id);
      confirmationGroups.set(key,group);
    }
    for (const group of confirmationGroups.values()) {
      for (const id of await recordFactConfirmation(query,{copyId:group.copyId,scope:`campaign-money:${state}`,at:group.at,factIds:group.ids})) affected.add(id);
    }
    if (!changed.length) {
      if (affected.size) await enqueueReaderPlaces({ entities: [...affected] }, query);
      return { written: 0, confirmed: confirmed.length, movedPeople:[] as string[], queued: affected.size > 0 };
    }
    const moved=[...new Set(changed.flatMap(row=>{const old=byId.get(row.id);return old && old.entity_id!==committeeId(row)?[old.entity_id]:[];}))];
    const movedPeople=moved.length?(await query("SELECT DISTINCT parent_id FROM entity WHERE id=ANY($1::text[]) AND state=$2 AND parent_id IS NOT NULL",[moved,state])).map(row=>String(row.parent_id)):[];
    const superseded = replaced.length ? await query("UPDATE fact SET status='superseded' WHERE id=ANY($1::bigint[]) RETURNING entity_id", [replaced]) : [];
    const written = await query(`INSERT INTO fact (entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
      SELECT entity,field,value::jsonb,text,'live','OFFICIAL',copy,'',checked,$7::timestamptz,producer,0
      FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::bigint[],$6::text[],$8::timestamptz[]) r(entity,field,value,text,copy,producer,checked) RETURNING entity_id`,
    [changed.map(committeeId), changed.map(row => FIELD + row.id), changed.map(row => JSON.stringify({...row,fingerprint:campaignSourceRecordHash(row)})), changed.map(row => row.nativeId ?? row.filerId ?? row.id),
      changed.map(row => sourceIds.get(row.provenance.vaultKey)), changed.map(row => `campaign-person-money:${state}:${row.resource}`), at,changed.map(row=>checkedAt(row,at))]);
    await query(`INSERT INTO entity_external_id (entity_id,scheme,value) SELECT entity,$3,value FROM unnest($1::text[],$2::text[]) r(entity,value)
      ON CONFLICT (scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id WHERE entity_external_id.entity_id IS DISTINCT FROM EXCLUDED.entity_id`, [changed.map(committeeId), changed.map(row => row.id), SCHEME]);
    for (const row of [...superseded, ...written]) affected.add(String(row.entity_id));
    for (const row of changed) affected.add(row.person!.id);
    for (const id of movedPeople) affected.add(id);
    await enqueueReaderPlaces({ entities: [...affected] }, query);
    return { written: changed.length, confirmed: confirmed.length, movedPeople, queued: true };
  });
  if (outcome.queued) await invalidateReaderCache({ states: [state] }, options.purge, null);
  if(outcome.movedPeople.length)options.onMoved?.(outcome.movedPeople);
  return {written:outcome.written,confirmed:outcome.confirmed};
}
