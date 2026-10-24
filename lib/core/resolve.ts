import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";

/** Exact identity or saved alias. Unknown ids return null; ambiguous ids raise instead of picking a person. */
export async function resolveId(anyId: string, query: Query | null = factReader()): Promise<string | null> {
  if (!query) throw new Error("Reader identity database is unavailable");
  const [exact] = await query("SELECT id FROM entity WHERE id=$1", [anyId]);
  if (exact?.id != null) return String(exact.id);
  const [row] = await query("SELECT reader_resolve_id($1) AS id", [anyId]);
  return row?.id == null ? null : String(row.id);
}

/** The ordinary maintenance pass uses the same reconciliation as the migration. No reader event is rewritten. */
export async function syncReaderIds(query: Query): Promise<number> {
  const [row] = await query("SELECT reader_sync_ids() AS n");
  return Number(row?.n ?? 0);
}
