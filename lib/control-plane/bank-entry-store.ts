/** DB-39: entry-row persistence. River owns creation/backfill and provider wiring.
 * No DDL runs here. Writes lock only affected identities and cost-profile keys,
 * preserving grow-only/place-result semantics without reading the whole Bank.
 */
import {
  emptyFieldManual, upsertEntries, type FieldManualEntry, type FieldManualQuery,
  type FieldManualStore,
} from "./field-manual.ts";

export interface BankSql {
  query(text: string, params?: readonly unknown[]): Promise<unknown>;
  withPinnedConnection?<T>(operation: (sql: BankSql) => Promise<T>): Promise<T>;
}
export interface BankEntryStore {
  readEntries(query: FieldManualQuery): Promise<{ store: FieldManualStore; total: number }>;
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
  clauses.push(query.subjectId ? `(kind <> 'EXHAUSTED_RUNGS' OR value->'payload'->>'subjectId' = ${param(query.subjectId)})` : "kind <> 'EXHAUSTED_RUNGS'");
  if (query.role) clauses.push(`(role = 'SHARED' OR role = ${param(query.role)})`);
  for (const [column, value] of [["states", query.state], ["record_classes", query.recordClass], ["platforms", query.platform]] as const) {
    if (value !== undefined) clauses.push(`(cardinality(${column}) = 0 OR ${column} @> ARRAY[${param(value.toLowerCase())}]::text[])`);
  }
  if (query.ocdIds?.length) clauses.push(`(cardinality(ocd_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(ocd_ids) scope CROSS JOIN unnest(${param(query.ocdIds.map(id => id.toLowerCase().split("#")[0]))}::text[]) subject WHERE subject = scope OR left(subject, length(scope) + 1) = scope || '/'))`);
  if (query.bodyIds?.length) clauses.push(`(cardinality(body_ids) = 0 OR body_ids && ${param(query.bodyIds)}::text[])`);
  return { text: `SELECT value FROM cp_field_manual_entries WHERE ${clauses.join(" AND ")} ORDER BY id`, params };
}

export function createBankEntryStore(sql: BankSql): BankEntryStore {
  return {
    async readEntries(query) {
      const selection = bankEntrySelection(query);
      const [selected, count] = await Promise.all([
        sql.query(selection.text, selection.params),
        sql.query("SELECT count(*)::text AS total FROM cp_field_manual_entries"),
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
          const locks = [...ids.map(id => `bank-entry:${id}`), ...profiles.map(key => `bank-profile:${key}`)].sort();
          for (const key of locks) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
          const prior = rows<{ value: FieldManualEntry }>(await tx.query(
            "SELECT value FROM cp_field_manual_entries WHERE id = ANY($1::text[]) OR (kind = 'JOB_COST' AND ((value->'payload'->>'platform') || ':' || (value->'payload'->>'recordClass')) = ANY($2::text[])) FOR UPDATE",
            [ids, profiles],
          )).map(row => row.value);
          const next = upsertEntries({ ...emptyFieldManual(), entries: prior }, entries, now);
          for (const entry of next.entries.filter(e => ids.includes(e.id) || e.kind === "COST_PROFILE")) {
            await tx.query(`INSERT INTO cp_field_manual_entries
              (id, value, role, kind, states, platforms, record_classes, outcome, ocd_ids, body_ids, revision, updated_at)
              VALUES ($1,$2::jsonb,$3,$4,$5::text[],$6::text[],$7::text[],$8,$9::text[],$10::text[],1,$11::timestamptz)
              ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value, role=EXCLUDED.role, kind=EXCLUDED.kind,
              states=EXCLUDED.states, platforms=EXCLUDED.platforms, record_classes=EXCLUDED.record_classes,
              outcome=EXCLUDED.outcome, ocd_ids=EXCLUDED.ocd_ids, body_ids=EXCLUDED.body_ids,
              revision=cp_field_manual_entries.revision+1, updated_at=EXCLUDED.updated_at`,
              [entry.id, JSON.stringify(entry), entry.role, entry.kind, entry.states, entry.platforms, entry.recordClasses,
                entry.outcome, entry.ocdIds ?? [], entry.bodyIds ?? [], now]);
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
