import { normalizeText, type Claim, type FieldKind, type SavedCopy } from "./check.ts";
import { door, holdUnchecked, type Decision, type DoorInput, type DoorOutcome } from "../core/door.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import { resolveId } from "../core/resolve.ts";
import { canonicalSubject } from "./entities.ts";
import { recordFactConfirmation } from "./confirmation.ts";

export type Query = (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

/** One real transaction; the Neon HTTP driver cannot hold one across statements. */
export interface FactDb {
  transaction<T>(work: (query: Query) => Promise<T>): Promise<T>;
}

type BlankStage = "ACQUIRE" | "READ" | "CHECK" | "DECIDE" | "PUBLISH";

export interface Clocks {
  windowHours(kind: FieldKind): number;
  retryMinutes(kind: FieldKind): number;
}

export interface PublishInput extends Claim {
  readonly field: string;
  readonly value: unknown;
  readonly producedBy: string;
  readonly costUsd: number;
  /** Findings from a hunter or walker carry claims to check against the saved page. A "loader" is not checked yet; a "checked" loader quotes the exact line of its saved copy and is. */
  readonly acquisition?: "loader" | "hunter" | "walker" | "checked";
}

export type PublishOutcome = { readonly decision: Decision; readonly factId: number | null } | { readonly blank: string };

export async function openBlank(query: Query, input: { readonly entityId: string; readonly field: string; readonly stage: BlankStage;
  readonly reason: string; readonly detail?: string | null; readonly retryMinutes: number; readonly countAttempt?: boolean }): Promise<void> {
  await query(`INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
    VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int), 1)
    ON CONFLICT (entity_id, field) DO UPDATE SET stage = EXCLUDED.stage, reason = EXCLUDED.reason, detail = EXCLUDED.detail,
      attempts = blank.attempts + 1, next_try_at = EXCLUDED.next_try_at, updated_at = now()
    WHERE (blank.stage,blank.reason,blank.detail) IS DISTINCT FROM (EXCLUDED.stage,EXCLUDED.reason,EXCLUDED.detail)
      OR blank.next_try_at<=now() OR $7::boolean`,
  [input.entityId, input.field, input.stage, input.reason, input.detail ?? null, Math.max(1, Math.round(input.retryMinutes)), input.countAttempt ?? false]);
}

/** A reader pressed "Want us to get this sooner?": the subject's blanks stop waiting out their back-off and the press is counted. */
export async function moveBlanksUp(query: Query, entityId: string): Promise<void> {
  await query(`UPDATE blank SET reader_requests = reader_requests + 1, next_try_at = least(next_try_at, now()), updated_at = now()
    WHERE entity_id = $1`, [entityId]);
}

const failureDetail = (c: Pick<PublishInput, "copy" | "fieldKind" | "provenance" | "value" | "valueText" | "quote" | "producedBy">) =>
  JSON.stringify({ sourceUrl: c.copy.finalUrl, copyId: c.copy.id, fieldKind: c.fieldKind, provenance: c.provenance,
    value: c.value, valueText: c.valueText, quote: c.quote, producedBy: c.producedBy });

/**
 * A fact that failed its check never goes live: its blank opens with the reason for a detective. A fact checked on a saved line
 * (`checked`) also moves this producer's live fact for the field that was published unchecked to held with the reason, so readers
 * stop seeing it; it stays in history.
 */
async function failedCheck(db: FactDb, input: DoorInput, reason: string, clocks: Clocks, checked: boolean, purge?: ReaderCachePurger): Promise<void> {
  let changed: ReaderCacheScope | undefined;
  await db.transaction(async query => {
    const requested = input.entity?.id ?? input.subjectId!;
    const entityId = await resolveId(requested, query) ?? await canonicalSubject(query, requested);
    if (!(await query("SELECT 1 FROM entity WHERE id=$1", [entityId])).length) return;
    await openBlank(query, { entityId, field: input.field, stage: "CHECK", reason: `CHECK_FAILED:${reason}`,
      detail: failureDetail(input), retryMinutes: clocks.retryMinutes(input.fieldKind) });
    if (!checked || !await holdUnchecked(query, { entityId, field: input.field, producedBy: input.producedBy, reason: `CHECK_FAILED:${reason}` })) return;
    await enqueueReaderPlaces({ entities: [entityId] }, query);
    changed = await readerCacheScopeForEntity(query, entityId);
  });
  if (changed) await invalidateReaderCache(changed, purge, null);
}

/** A copy past its window means its source was not re-checked: nothing changes for readers and the loader raises fix work for the source. */
export const STALE = "COPY_OUTSIDE_FRESHNESS_WINDOW";

/** A fact checked on a saved line is tried twice before it goes to a detective; any other is tried once. */
async function settle(db: FactDb, input: DoorInput, run: () => Promise<DoorOutcome>, checked: boolean, clocks: Clocks, purge?: ReaderCachePurger): Promise<DoorOutcome> {
  let outcome: DoorOutcome = { refused: "NO_EXACT_LINE" };
  for (let attempt = 0; attempt < (checked ? 2 : 1) && "refused" in outcome && outcome.refused !== "SUBJECT_NOT_FOUND" && outcome.refused !== STALE; attempt++) outcome = await run();
  if ("refused" in outcome && !(checked && outcome.refused === STALE)) await failedCheck(db, input, outcome.refused, clocks, checked, purge);
  return outcome;
}

/** Older callers retain their blank result; every fact is written by the same door. */
export async function publishClaim(db: FactDb, input: PublishInput, clocks: Clocks, now = new Date(),
  options: { readonly purge?: ReaderCachePurger } = {}): Promise<PublishOutcome> {
  const outcome = await settle(db, input, () => door(db, input, clocks, now, options), input.acquisition === "checked", clocks, options.purge);
  return "refused" in outcome ? { blank: outcome.refused } : outcome;
}

/** A switched loader's fact is checked at the line of its saved copy that `find` returns, and never goes live unchecked: the lookup and the check run once more, then a detective gets it. */
export function publishLoaded(db: FactDb, input: DoorInput, find: () => { readonly quote: string; readonly valueText: string } | null,
  clocks: Clocks, now: Date, options: { readonly purge?: ReaderCachePurger } = {}): Promise<DoorOutcome> {
  return settle(db, input, async () => { const line = find(); return line ? door(db, { ...input, ...line, acquisition: "checked" }, clocks, now, options) : { refused: "NO_EXACT_LINE" }; },
    true, clocks, options.purge);
}

/** A source recheck records its exact live fact versions together. */
export async function restampFacts(db: FactDb, facts: readonly { readonly id: number; readonly entityId: string; readonly field: string; readonly quote: string }[],
  copy: Pick<SavedCopy, "id" | "text" | "fetchedAt">): Promise<number> {
  if (!facts.length) return 0;
  const page = normalizeText(copy.text);
  return db.transaction(async query => {
    const receipts = Object.fromEntries(facts.map(fact => {
      const start = fact.quote ? page.indexOf(normalizeText(fact.quote)) : -1;
      return [String(fact.id),{quote_start:start<0?null:start}];
    }));
    const eligible = await query(`SELECT id,entity_id,field FROM checked_fact WHERE id=ANY($1::bigint[]) AND status='live'
      AND checked_at<=$2::timestamptz AND (checked_at<$2::timestamptz OR source_copy_id IS DISTINCT FROM $3::bigint
        OR quote_start IS DISTINCT FROM ($4::jsonb->id::text->>'quote_start')::int)`,
      [facts.map(fact=>fact.id),copy.fetchedAt.toISOString(),copy.id,JSON.stringify(receipts)]);
    const changed = await recordFactConfirmation(query,{copyId:copy.id,scope:"source-recheck",at:copy.fetchedAt.toISOString(),
      factIds:eligible.map(row=>Number(row.id)),receipts});
    if (changed.length) {
      await query(`DELETE FROM blank b USING unnest($1::text[],$2::text[]) f(entity_id,field)
        WHERE b.entity_id=f.entity_id AND b.field=f.field`,[eligible.map(row=>row.entity_id),eligible.map(row=>row.field)]);
      await enqueueReaderPlaces({entities:changed},query);
    }
    return changed.length ? eligible.length : 0;
  });
}
