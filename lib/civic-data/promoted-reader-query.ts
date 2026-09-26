import { neon } from "@neondatabase/serverless";
import type { ReadOnlyQuery, Row } from "../control-plane/admin-view/promoted-slices.ts";

/** Shared server-side adapter for narrowly sliced promoted reader records.
 * Postgres enforces read-only access for the entire transaction. */
export function readerQuery(deadlineMs?: number): ReadOnlyQuery | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const sql = neon(url);
  return async statements => (await sql.transaction(
    statements.map(s => sql.query(s.text, [...s.params])),
    { readOnly: true, ...(deadlineMs === undefined ? {} : { fetchOptions: { signal: AbortSignal.timeout(deadlineMs) } }) },
  )) as unknown as (readonly Row[])[];
}
