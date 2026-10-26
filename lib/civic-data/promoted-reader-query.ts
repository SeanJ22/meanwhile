import { readerDatabaseQuery } from "../reader/database.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

export function readerQuery(deadlineMs?: number): ReadOnlyQuery | null {
  return readerDatabaseQuery(deadlineMs);
}
