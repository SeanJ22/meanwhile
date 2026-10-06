/** DB-39: entry-row persistence. River owns creation/backfill and provider wiring.
 * No DDL runs here. Writes lock only affected identities and cost-profile keys,
 * preserving grow-only/place-result semantics without reading the whole Bank.
 */
import {
  emptyFieldManual, upsertEntries, normalizeEntry, type FieldManualEntry, type FieldManualQuery,
  type FieldManualStore,
} from "./field-manual.ts";

import { jobCostProfileFromTotals } from "./bank-job-cost.ts";
import { isDeepStrictEqual } from "node:util";
import { boundedQuery, type BoundableQueryOptions } from "./repository/request-bounds.ts";

export interface BankSql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): Promise<unknown>;
  withPinnedConnection?<T>(operation: (sql: BankSql) => Promise<T>): Promise<T>;
}
export interface BankEntryStore {
  importEntries(entries: readonly FieldManualEntry[], now: string): Promise<void>;
  mutateRolePlaybook(role: string, update: (entries: readonly FieldManualEntry[]) => FieldManualEntry | null, now: string): Promise<void>;
  readEntries(query: FieldManualQuery): Promise<{ store: FieldManualStore; total: number }>;
  scanEntries(afterId?: string, limit?: number): Promise<readonly FieldManualEntry[]>;
  mergeEntries(entries: readonly FieldManualEntry[], now: string): Promise<void>;
}
function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) return (result as { rows: T[] }).rows;
  throw new Error("BANK_ENTRY_QUERY_UNREADABLE");
}

/** Parameterized filters mirror entryMatches; the final projection retains its existing ranking and fix-map behavior. */
export function bankEntrySelection(query: FieldManualQuery): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const param = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const clauses = ["kind <> 'JOB_COST'"];
  if (query.kinds) clauses.push(`kind = ANY(${param(query.kinds)}::text[])`);
  clauses.push(query.subjectId ? `(kind NOT IN ('EXHAUSTED_RUNGS','PAID_ENDING') OR value->'payload'->>'subjectId' = ${param(query.subjectId)})` : "kind NOT IN ('EXHAUSTED_RUNGS','PAID_ENDING')");
  if (query.role) clauses.push(`(role = 'SHARED' OR role = ${param(query.role)})`);
  for (const [column, value] of [["states", query.state], ["record_classes", query.recordClass], ["platforms", query.platform]] as const) {
    if (value !== undefined) clauses.push(`(cardinality(${column}) = 0 OR ${column} @> ARRAY[${param(value.toLowerCase())}]::text[])`);
  }
  if (query.ocdIds?.length) clauses.push(`(cardinality(ocd_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(ocd_ids) scope CROSS JOIN unnest(${param(query.ocdIds.map(id => id.toLowerCase().split("#")[0]))}::text[]) subject WHERE subject = scope OR left(subject, length(scope) + 1) = scope || '/'))`);
  if (query.bodyIds?.length) clauses.push(`(cardinality(body_ids) = 0 OR body_ids && ${param(query.bodyIds)}::text[])`);
  return { text: `SELECT value FROM cp_field_manual_entries WHERE ${clauses.join(" AND ")} ORDER BY id`, params };
}

export const BANK_COST_TOTALS_SQL = `SELECT v->>'platform' AS platform, v->>'recordClass' AS record_class,
 count(*)::int AS attempts, count(*) FILTER (WHERE v->'success'='true'::jsonb)::int AS successes,
 CASE WHEN count(*) FILTER (WHERE jsonb_typeof(v->'durationMs')='number')=count(*) THEN sum((v->>'durationMs')::float8) ELSE NULL END AS total_ms,
 CASE WHEN count(*) FILTER (WHERE jsonb_typeof(v->'requestCount')='number')=count(*) THEN sum((v->>'requestCount')::float8) ELSE NULL END AS total_requests,
 CASE WHEN count(*) FILTER (WHERE jsonb_typeof(v->'usd')='number')=count(*) THEN sum((v->>'usd')::float8) ELSE NULL END AS total_usd
 FROM (SELECT value->'payload' AS v FROM cp_field_manual_entries WHERE kind='JOB_COST'
 AND ((value->'payload'->>'platform') || ':' || (value->'payload'->>'recordClass')) = ANY($1::text[])) costs
 GROUP BY v->>'platform',v->>'recordClass'`;

async function writeEntry(sql: BankSql, entry: FieldManualEntry, now: string) {
  await sql.query(`INSERT INTO cp_field_manual_entries
              (id, value, role, kind, states, platforms, record_classes, outcome, ocd_ids, body_ids, revision, updated_at)
              VALUES ($1,$2::jsonb,$3,$4,$5::text[],$6::text[],$7::text[],$8,$9::text[],$10::text[],1,$11::timestamptz)
              ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value, role=EXCLUDED.role, kind=EXCLUDED.kind,
              states=EXCLUDED.states, platforms=EXCLUDED.platforms, record_classes=EXCLUDED.record_classes,
              outcome=EXCLUDED.outcome, ocd_ids=EXCLUDED.ocd_ids, body_ids=EXCLUDED.body_ids,
              revision=cp_field_manual_entries.revision+1, updated_at=EXCLUDED.updated_at`,
    [entry.id, JSON.stringify(entry), entry.role, entry.kind, entry.states, entry.platforms, entry.recordClasses,
    entry.outcome, entry.ocdIds ?? [], entry.bodyIds ?? [], now]);
}
async function transaction<T>(sql: BankSql, operation: (tx: BankSql) => Promise<T>): Promise<T> {
  if (!sql.withPinnedConnection) throw new Error("BANK_ENTRY_PINNED_TRANSACTION_REQUIRED");
  return sql.withPinnedConnection(async tx => {
    await tx.query("BEGIN");
    try { const result = await operation(tx); await tx.query("COMMIT"); return result; }
    catch (error) { await tx.query("ROLLBACK").catch(() => {}); throw error; }
  });
}

export function createBankEntryStore(sql: BankSql): BankEntryStore {
  return {
    async importEntries(entries, now) {
      if (!entries.length) return;
      await transaction(sql, async tx => {
        for (const entry of [...entries].sort((a,b)=>a.id.localeCompare(b.id))) {
          await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`bank-entry:${entry.id}`]);
          const existing = rows<{ value: FieldManualEntry }>(await tx.query("SELECT value FROM cp_field_manual_entries WHERE id=$1 FOR UPDATE", [entry.id]))[0];
          const normalized = normalizeEntry(entry);
          if (existing && !isDeepStrictEqual(existing.value, JSON.parse(JSON.stringify(normalized)))) throw new Error(`BANK_MOVE_ENTRY_CONFLICT:${entry.id}`);
          if (!existing) await writeEntry(tx, normalized, now);
        }
      });
    },
    async mutateRolePlaybook(role, update, now) {
      await transaction(sql, async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`bank-playbook:${role}`]);
        const selection = bankEntrySelection({ kinds: ["PLAYBOOK"], role: role as FieldManualQuery["role"] });
        const entries = rows<{ value: FieldManualEntry }>(await tx.query(selection.text, selection.params)).map(row=>row.value);
        const entry = update(entries);
        if (entry) await writeEntry(tx, normalizeEntry(entry), now);
      });
    },
    async scanEntries(afterId, limit = 100) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("BANK_SCAN_PAGE_BOUND_REQUIRED");
      return rows<{ value: FieldManualEntry }>(await boundedQuery(sql, { operation: "bank.entries.scan", callClass: "PAGE" },
        "SELECT value FROM cp_field_manual_entries WHERE ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2",
        [afterId ?? null, limit],
      )).map(row => row.value);
    },
    async readEntries(query) {
      const selection = bankEntrySelection(query);
      const [selected, count] = await Promise.all([
        boundedQuery(sql, { operation: "bank.entries.projection", callClass: "DOCUMENT" }, selection.text, selection.params),
        boundedQuery(sql, { operation: "bank.entries.count", callClass: "POINT" }, "SELECT count(*)::text AS total FROM cp_field_manual_entries", []),
      ]);
      const total = Number(rows<{ total: string }>(count)[0]?.total);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("BANK_ENTRY_COUNT_UNREADABLE");
      return { store: { ...emptyFieldManual(), entries: rows<{ value: FieldManualEntry }>(selected).map(row => row.value) }, total };
    },
    async mergeEntries(entries, now) {
      if (!entries.length) return;
      if (!sql.withPinnedConnection) throw new Error("BANK_ENTRY_PINNED_TRANSACTION_REQUIRED");
      await sql.withPinnedConnection(async tx => {
        await tx.query("BEGIN");
        try {
          // Profile locks serialize only observations of the same platform/class.
          const profiles = [...new Set(entries.filter(e => e.kind === "JOB_COST").map(e => {
            const p = e.payload as { platform: string; recordClass: string };
            return `${p.platform}:${p.recordClass}`;
          }))].sort();
          const ids = [...new Set(entries.map(e => e.id))].sort();
          const locks = [...ids.map(id => `bank-entry:${id}`), ...profiles.map(key => `bank-profile:${key}`), ...entries.filter(e=>e.kind === "PLAYBOOK").map(e=>`bank-playbook:${e.role}`)].sort();
          for (const key of locks) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
          const prior = rows<{ value: FieldManualEntry }>(await tx.query(
            "SELECT value FROM cp_field_manual_entries WHERE id = ANY($1::text[]) FOR UPDATE",
            [ids],
          )).map(row => row.value);
          const next = upsertEntries({ ...emptyFieldManual(), entries: prior }, entries, now);
          for (const entry of next.entries.filter(e => ids.includes(e.id) && !(e.kind === "COST_PROFILE" && profiles.includes(`${(e.payload as { platform: string }).platform}:${(e.payload as { recordClass: string }).recordClass}`)))) {
            await writeEntry(tx, entry, now);
          }
          if (profiles.length) {
            const totals = rows<{ platform: string; record_class: string; attempts: number; successes: number; total_ms: number | null; total_requests: number | null; total_usd: number | null }>(await tx.query(BANK_COST_TOTALS_SQL, [profiles]));
            for (const t of totals) await writeEntry(tx, jobCostProfileFromTotals({ platform: t.platform, recordClass: t.record_class,
              attempts: t.attempts, successes: t.successes, totalMs: t.total_ms, totalRequests: t.total_requests, totalUsd: t.total_usd }, now), now);
          }
          await tx.query("COMMIT");
        } catch (error) {
          await tx.query("ROLLBACK").catch(() => {});
          throw error;
        }
      });
    },
  };
}
