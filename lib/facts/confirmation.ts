import { AsyncLocalStorage } from "node:async_hooks";
import type { FactDb, Query } from "./publish.ts";
import { enqueueReaderPlaces, invalidateReaderCache, type ReaderCachePurger } from "../reader/cache.ts";
import { markSlices, slicesOf } from "../core/slice-marks.ts";

export interface FactConfirmation {
  readonly copyId: number;
  readonly scope: string;
  readonly at: string;
  readonly factIds: readonly number[];
  readonly receipts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** The receipt can move without modifying any of the confirmed fact versions. */
export async function recordFactConfirmation(query: Query, input: FactConfirmation): Promise<readonly string[]> {
  if (!input.factIds.length) return [];
  // One round trip per source; each persisted scope still covers at most 500 ids.
  const rows = await query(`WITH eligible AS MATERIALIZED (
    SELECT id,entity_id,id/500 AS bucket,md5(value::text) AS value_hash,jsonb_build_object('value_text',value_text,'quote',quote,'quote_start',quote_start,
      'second_copy_id',second_copy_id,'provenance_kind',provenance_kind) AS receipt
    FROM checked_fact WHERE id=ANY($4::bigint[]) AND status='live'
      AND (checked_at<$3::timestamptz OR checked_at=$3::timestamptz AND (source_copy_id IS DISTINCT FROM $1::bigint
        OR NOT jsonb_build_object('value_text',value_text,'quote',quote,'quote_start',quote_start,
          'second_copy_id',second_copy_id,'provenance_kind',provenance_kind) @> coalesce($5::jsonb->id::text,'{}'::jsonb)))
  ), saved AS (
    INSERT INTO fact_confirmation(source_copy_id,scope,checked_at,fact_ids,receipts)
    SELECT $1,$2||':facts:'||bucket,$3,array_agg(id ORDER BY id),jsonb_object_agg(id::text,receipt||coalesce($5::jsonb->id::text,'{}'::jsonb)||jsonb_build_object('checked_at',$3::timestamptz,'value_hash',value_hash)) FROM eligible GROUP BY bucket
    ON CONFLICT(source_copy_id,scope) DO UPDATE SET
      checked_at=greatest(fact_confirmation.checked_at,EXCLUDED.checked_at),
      fact_ids=ARRAY(SELECT DISTINCT id FROM unnest(fact_confirmation.fact_ids||EXCLUDED.fact_ids) id ORDER BY id),
      receipts=fact_confirmation.receipts||EXCLUDED.receipts
    WHERE fact_confirmation.checked_at<EXCLUDED.checked_at OR NOT fact_confirmation.fact_ids @> EXCLUDED.fact_ids
      OR NOT fact_confirmation.receipts @> EXCLUDED.receipts
    RETURNING scope
  ) SELECT DISTINCT entity_id FROM eligible WHERE EXISTS(SELECT 1 FROM saved WHERE scope=$2||':facts:'||eligible.bucket)`,
  [input.copyId,input.scope,input.at,input.factIds,JSON.stringify(input.receipts ?? {})]);
  const entities = rows.map(row => String(row.entity_id));
  if (entities.length) await query(`INSERT INTO fact_watermark(scope,version)
    SELECT scope,1 FROM (
      SELECT DISTINCT state::text AS scope FROM entity WHERE id=ANY($1::text[]) AND state IS NOT NULL
      UNION SELECT 'comment' WHERE EXISTS(SELECT 1 FROM fact WHERE id=ANY($2::bigint[]) AND field LIKE 'comment:%')
    ) scopes ON CONFLICT(scope) DO UPDATE SET version=fact_watermark.version+1`,[entities,input.factIds]);
  return entities;
}

interface Batch { readonly db: FactDb; readonly pending: Map<string, FactConfirmation> }
const batches = new AsyncLocalStorage<Batch>();

/** Called only after a successful fact transaction; a failed claim is never confirmed. */
export async function confirmFactSource(db: FactDb, confirmation: FactConfirmation, purge?: ReaderCachePurger): Promise<void> {
  const batch = batches.getStore();
  if (batch?.db === db) {
    const key = JSON.stringify([confirmation.copyId,confirmation.scope,confirmation.at]);
    const held = batch.pending.get(key);
    batch.pending.set(key, held ? {...confirmation,factIds:[...new Set([...held.factIds,...confirmation.factIds])],
      receipts:{...held.receipts,...confirmation.receipts}} : confirmation);
    return;
  }
  await saveConfirmations(db,[confirmation],purge);
}

async function saveConfirmations(db: FactDb, confirmations: readonly FactConfirmation[], purge?: ReaderCachePurger): Promise<void> {
  const affected = await db.transaction(async query => {
    const entities = new Set<string>();
    for (const confirmation of confirmations) for (const id of await recordFactConfirmation(query,confirmation)) entities.add(id);
    if (entities.size) await enqueueReaderPlaces({entities:[...entities]},query);
    const states = entities.size ? await query("SELECT DISTINCT state FROM entity WHERE id=ANY($1::text[]) AND state IS NOT NULL",[[...entities]]) : [];
    return {entities:[...entities],states:states.map(row=>String(row.state)),marks:entities.size ? await slicesOf(query,[...entities]) : []};
  });
  await markSlices(affected.marks, db);
  if (affected.entities.length) await invalidateReaderCache({states:affected.states.filter(state=>state!=="US"),
    nationalPeople:affected.states.includes("US")},purge,null);
}

/** A roster or box pass files each saved-copy/scope confirmation once. Successful
 * claims survive a later failure in the pass, just as their facts already do. */
export async function withFactConfirmations<T>(db: FactDb, work: () => Promise<T>, purge?: ReaderCachePurger): Promise<T> {
  if (batches.getStore()?.db === db) return work();
  const batch: Batch = {db,pending:new Map()};
  return batches.run(batch,async () => {
    try { return await work(); }
    finally { if (batch.pending.size) await saveConfirmations(db,[...batch.pending.values()],purge); }
  });
}
