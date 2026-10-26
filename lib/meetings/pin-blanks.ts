import type { FactDb, Query } from "../facts/publish.ts";
import { readPassCursor,writePassCursor } from "../facts/db.ts";

/** Reconcile in Postgres: source payloads never leave the database for this inventory. */
export const MISSING_PIN_BLANKS_SQL = `WITH sittings AS MATERIALIZED (
  SELECT s.value->>'id' AS id,max(s.value->>'bodyId') AS body_id,
    max(s.value->>'bodyName') AS name,
    upper(coalesce(substring(max(coalesce(s.value->>'bodyId',s.value->>'ocdId')) FROM '/(?:state|district|territory):([a-z]{2})'),
      substring(max(s.value->>'bodyId') FROM '^government:US-([A-Z]{2}):'))) AS state,
    bool_or(jsonb_typeof(reader_payload_value(s.value->'online'))='object') AS online,
    max(reader_payload_value(s.value->'venueGap')->>'publishedText') AS address,
    bool_or(jsonb_typeof(reader_payload_value(s.value->'location')->'lat')='number'
      AND jsonb_typeof(reader_payload_value(s.value->'location')->'lng')='number'
      OR jsonb_typeof(reader_payload_value(s.value->'mapPin')->'lat')='number'
      AND jsonb_typeof(reader_payload_value(s.value->'mapPin')->'lng')='number') AS pinned
  FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id,
    LATERAL (SELECT r.value) s
  WHERE r.record_class='MEETING' AND r.collection='meetings' AND r.promotion_key=ANY($2::text[]) AND r.row_id IS NOT NULL
  GROUP BY s.value->>'id'
), missing AS MATERIALIZED (
  SELECT s.id,coalesce(s.body_id,e.parent_id) AS body_id,
    coalesce(s.name,e.name) AS name,coalesce(s.state,e.state) AS state,s.online,s.address,e.id AS existing_id
  FROM sittings s LEFT JOIN entity e ON e.id='meeting:'||s.id
  LEFT JOIN LATERAL (SELECT f.entity_id FROM (
    SELECT entity_id,value FROM fact WHERE entity_id=coalesce(e.id,'meeting:'||s.id)
      AND status='live' AND field IN ('map_pin','location') ORDER BY field LIMIT 2
  ) f WHERE jsonb_typeof(f.value->'lat')='number' AND jsonb_typeof(f.value->'lng')='number' LIMIT 1) point ON true
  WHERE NOT coalesce(s.pinned,false) AND point.entity_id IS NULL
), entities AS (
  INSERT INTO entity(id,kind,name,state,parent_id)
  SELECT 'meeting:'||m.id,'meeting',coalesce(m.name,'Meeting'),coalesce(m.state,b.state),b.id
    FROM missing m LEFT JOIN entity b ON b.id=m.body_id WHERE m.existing_id IS NULL
  ON CONFLICT(id) DO NOTHING RETURNING id
), opened AS (
  INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at,attempts)
  SELECT 'meeting:'||id,'map_pin','ACQUIRE',
    CASE WHEN address IS NOT NULL THEN 'MEETING_ADDRESS_NOT_PLACED'
      WHEN online THEN 'ONLINE_OFFICE_ADDRESS_MISSING' ELSE 'BODY_OFFICE_ADDRESS_MISSING' END,
    jsonb_build_object('publishedText',address,'online',coalesce(online,false))::text,$1::timestamptz,0
  FROM missing CROSS JOIN (SELECT count(*) FROM entities) inserted
  ON CONFLICT(entity_id,field) DO NOTHING RETURNING entity_id
) SELECT count(*)::int AS opened FROM opened`;

const EXISTING_PIN_BLANKS_SQL = `WITH missing AS MATERIALIZED (
  SELECT e.id FROM entity e WHERE e.kind='meeting'
    AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id=e.id AND b.field='map_pin')
    AND NOT EXISTS(SELECT 1 FROM (
      SELECT value FROM fact WHERE entity_id=e.id AND status='live' AND field IN ('map_pin','location') ORDER BY field LIMIT 2
    ) f WHERE jsonb_typeof(f.value->'lat')='number' AND jsonb_typeof(f.value->'lng')='number') LIMIT 8192
), opened AS (
  INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at,attempts)
  SELECT m.id,'map_pin','ACQUIRE',
    CASE WHEN location.value IS NOT NULL THEN 'MEETING_ADDRESS_NOT_PLACED'
      WHEN online.value IS NOT NULL THEN 'ONLINE_OFFICE_ADDRESS_MISSING' ELSE 'BODY_OFFICE_ADDRESS_MISSING' END,
    jsonb_build_object('publishedText',coalesce(location.value->>'address',location.value->>'name'),'online',online.value)::text,$1::timestamptz,0
  FROM missing m LEFT JOIN LATERAL(SELECT value FROM fact WHERE entity_id=m.id AND field='location' AND status='live' LIMIT 1) location ON true
    LEFT JOIN LATERAL(SELECT value FROM fact WHERE entity_id=m.id AND field='online_access' AND status='live' LIMIT 1) online ON true
  ON CONFLICT(entity_id,field) DO NOTHING RETURNING entity_id
) SELECT count(*)::int AS opened FROM opened`;

const MISSING_OFFICE_BLANKS_SQL = `INSERT INTO blank(entity_id,field,stage,reason,next_try_at,attempts)
  SELECT e.id,'office_address','ACQUIRE','STREET_OFFICE_ADDRESS_MISSING',$1::timestamptz,0 FROM entity e
  WHERE e.kind IN ('body','government')
    AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id=e.id AND b.field='office_address') AND NOT EXISTS(
    SELECT 1 FROM (SELECT value_text FROM fact WHERE entity_id=e.id AND field='office_address' AND status='live' LIMIT 1) f
      WHERE f.value_text ~ '[0-9]' AND f.value_text !~* '\\m(?:p\\.?\\s*o\\.?\\s*box|post office box|private bag|rural route)\\M')
  ON CONFLICT(entity_id,field) DO NOTHING`;

/** Missing addresses remain acquisition work even when there is nothing useful to send to a geocoder. */
export async function openMissingPinBlanks(db: FactDb & { readonly query: Query }, now: string,
  more:()=>boolean=()=>true): Promise<number> {
  let opened=0;
  while(more()){
    const count=Number((await db.query(EXISTING_PIN_BLANKS_SQL,[now]))[0]?.opened??0);
    opened+=count;
    if(count<8192)break;
  }
  const cursor=await readPassCursor(db.query,"meeting-pin-blank-promotions");
  let after=cursor?JSON.parse(cursor) as [string,string]:["-infinity",""];
  while(more()){
    const partitions=await db.query(`SELECT key,promoted_at::text AS promoted_at FROM civic_data_promotions WHERE record_class='MEETING'
      AND (promoted_at,key)>($1::timestamptz,$2::text) ORDER BY promoted_at,key LIMIT 32`,after);
    if(!partitions.length)break;
    const last=partitions.at(-1)!;
    after=[String(last.promoted_at),String(last.key)];
    opened+=await db.transaction(async query=>{
      const rows=await query(MISSING_PIN_BLANKS_SQL,[now,partitions.map(row=>row.key)]);
      await writePassCursor(query,"meeting-pin-blank-promotions",JSON.stringify(after));
      return Number(rows[0]?.opened??0);
    });
  }
  if(more())await db.query(MISSING_OFFICE_BLANKS_SQL,[now]);
  return opened;
}
