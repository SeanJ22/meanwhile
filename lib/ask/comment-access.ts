import { readFactCommentAccess } from "../facts/comment-read.ts";
import { statementQuery } from "../facts/db.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

/** The resolved body's current rules, through the reader's existing socket. */
export async function readAskCommentAccess(bodyId: string, query: ReadOnlyQuery | null = readerDatabaseQuery()) {
  return query ? readFactCommentAccess(statementQuery(query), [bodyId]) : [];
}
