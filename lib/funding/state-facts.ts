import { createHash } from "node:crypto";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { campaignFinanceStateScope } from "./state-sources.ts";
import { campaignSourceRecordHash, type CampaignSourceRecord } from "./state-source-records.ts";

const FIELD = "campaign-money:";
const SCHEME = "campaign-money-record";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function campaignStateDivision(state: string): string {
  const place = US_JURISDICTIONS.find(place => place.usps === state);
  if (!place) throw new Error("Campaign money requires a supported state.");
  return `ocd-division/country:us/${place.prefix}:${place.slug}`;
}
const committeeId = (row: CampaignSourceRecord) => `campaign-committee:${row.state}:${digest(JSON.stringify([row.resource.split(":")[0], row.filerId]))}`;

interface HeldFact { readonly entity_id: string; readonly field: string; readonly value: CampaignSourceRecord; readonly provenance_kind: string; readonly id: number }

export async function readCampaignPredecessors(query: Query, state: string, ids: readonly string[]): Promise<ReadonlyMap<string, CampaignSourceRecord>> {
  if (ids.length > 500) throw new Error("Campaign predecessors exceed one source batch.");
  const held = await query(`SELECT x.value AS record_id,f.value FROM entity_external_id x JOIN entity e ON e.id=x.entity_id
    JOIN fact f ON f.entity_id=e.id AND f.field=$3||x.value AND f.status='live'
    WHERE x.scheme=$1 AND x.value=ANY($2::text[]) AND e.state=$4`, [SCHEME, ids, FIELD, state]);
  return new Map(held.map(row => [String(row.record_id), row.value as CampaignSourceRecord]));
}

export async function fileCampaignMoneyFacts(db: FactDb, state: string, records: readonly CampaignSourceRecord[], at: string): Promise<{ written: number; confirmed: number }> {
  if (records.length > 500 || records.some(row => row.state !== state || row.governmentOcdId !== null && campaignFinanceStateScope(row.governmentOcdId) !== `US-${state}:campaign-finance`)) throw new Error("Campaign facts exceed their state or source batch.");
  if (!records.length) return { written: 0, confirmed: 0 };
  return db.transaction(async query => {
    const stateDivision = campaignStateDivision(state);
    const places = [...new Set([stateDivision, ...records.flatMap(row => row.governmentOcdId ?? [])])];
    await query(`INSERT INTO entity (id,kind,name,state,parent_id)
      SELECT id,'place',id,$2,CASE WHEN id<>$3 THEN $3 END FROM unnest($1::text[]) id ON CONFLICT DO NOTHING`, [places, state, stateDivision]);
    const committees = [...new Map(records.map(row => [committeeId(row), row])).entries()];
    await query(`INSERT INTO entity (id,kind,name,state,parent_id)
      SELECT id,'committee',name,$4,parent FROM unnest($1::text[],$2::text[],$3::text[]) c(id,name,parent)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id WHERE entity.state=EXCLUDED.state AND entity.kind='committee'`,
    [committees.map(([id]) => id), committees.map(([, row]) => row.filerName ?? row.filerId ?? "Unjoined campaign filings"), committees.map(([, row]) => row.governmentOcdId ?? stateDivision), state]);
    const links = [...new Map(records.flatMap(row => [...new Set([stateDivision, ...(row.governmentOcdId ? [row.governmentOcdId] : [])])]
      .map(place => [`${committeeId(row)}:${place}`, [committeeId(row), place]] as const))).values()];
    await query(`INSERT INTO entity_place (entity_id,place_id) SELECT * FROM unnest($1::text[],$2::text[]) ON CONFLICT DO NOTHING`, [links.map(link => link[0]), links.map(link => link[1])]);
    const previous = await query(`SELECT f.id,f.entity_id,f.field,f.value,f.provenance_kind FROM entity_external_id x JOIN entity e ON e.id=x.entity_id
      JOIN fact f ON f.entity_id=e.id AND f.field=$3||x.value AND f.status='live'
      WHERE x.scheme=$1 AND x.value=ANY($2::text[]) AND e.state=$4 FOR UPDATE OF f`, [SCHEME, records.map(row => row.id), FIELD, state]) as unknown as readonly HeldFact[];
    const byId = new Map(previous.map(row => [row.field.slice(FIELD.length), row]));
    const changed: CampaignSourceRecord[] = [], confirmed: number[] = [], replaced: number[] = [];
    for (const row of records) {
      const old = byId.get(row.id);
      if (old && (old.provenance_kind === "OWNER" || Date.parse(old.value.provenance.retrievedAt) > Date.parse(row.provenance.retrievedAt))) continue;
      if (old && campaignSourceRecordHash(old.value) === campaignSourceRecordHash(row) && old.entity_id === committeeId(row)) { confirmed.push(old.id); continue; }
      changed.push(row);
      if (old) replaced.push(old.id);
    }
    if (confirmed.length) await query("UPDATE fact SET checked_at=$2 WHERE id=ANY($1::bigint[])", [confirmed, at]);
    if (!changed.length) return { written: 0, confirmed: confirmed.length };
    const captures = [...new Map(changed.map(row => [row.provenance.vaultKey, row.provenance])).values()];
    const copies = await query(`INSERT INTO source_copy (url,final_url,fetched_at,http_status,sha256,blob_key,is_archive)
      SELECT url,url,fetched::timestamptz,200,hash,key,false FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) s(url,fetched,hash,key)
      ON CONFLICT (blob_key) DO UPDATE SET blob_key=EXCLUDED.blob_key RETURNING id,blob_key`,
    [captures.map(source => source.url.split("#")[0]), captures.map(source => source.retrievedAt), captures.map(source => source.rawHash), captures.map(source => source.vaultKey)]);
    const sourceIds = new Map(copies.map(copy => [String(copy.blob_key), Number(copy.id)]));
    if (replaced.length) await query("UPDATE fact SET status='superseded' WHERE id=ANY($1::bigint[])", [replaced]);
    await query(`INSERT INTO fact (entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
      SELECT entity,field,value::jsonb,text,'live','OFFICIAL',copy,'',$7::timestamptz,$7::timestamptz,producer,0
      FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::bigint[],$6::text[]) r(entity,field,value,text,copy,producer)`,
    [changed.map(committeeId), changed.map(row => FIELD + row.id), changed.map(row => JSON.stringify(row)), changed.map(row => row.nativeId ?? row.filerId ?? row.id),
      changed.map(row => sourceIds.get(row.provenance.vaultKey)), changed.map(row => `campaign-finance:${state}:${row.resource}`), at]);
    await query(`INSERT INTO entity_external_id (entity_id,scheme,value) SELECT entity,$3,value FROM unnest($1::text[],$2::text[]) r(entity,value)
      ON CONFLICT (scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id`, [changed.map(committeeId), changed.map(row => row.id), SCHEME]);
    return { written: changed.length, confirmed: confirmed.length };
  });
}
