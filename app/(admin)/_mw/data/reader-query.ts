import "server-only";

/**
 * The reader store, for the slices Admin reads from its promoted pointers
 * (`lib/control-plane/admin-view/promoted-slices.ts`). Every call runs its
 * statements in one READ ONLY transaction over HTTP: one round trip, no socket
 * to open, and Postgres itself refuses a write. Null where this deployment
 * names no reader store.
 */
import { neon } from "@neondatabase/serverless";

import type { ReadOnlyQuery, Row } from "@/lib/control-plane/admin-view/promoted-slices.ts";

export function readerQuery(): ReadOnlyQuery | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const sql = neon(url);
  return async (statements) =>
    (await sql.transaction(statements.map((s) => sql.query(s.text, [...s.params])), { readOnly: true })) as unknown as (readonly Row[])[];
}
