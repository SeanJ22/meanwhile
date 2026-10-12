import type { AskInteractionRow } from "./ask-signal.ts";
import { getDb } from "./index.ts";
import { askInteractions } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/** Receives the existing prepared row; never changes collection or retention. */
export async function writeAskInteraction(row: AskInteractionRow, signal?: AbortSignal): Promise<void> {
  const answerMode = row.answerMode;
  if (answerMode === "OFF" || answerMode === "TRANSPORT_FAILED") {
    throw new Error(`${answerMode} is not a delivered Ask interaction`);
  }
  if (!process.env.DATABASE_URL) throw new Error("Ask question store is unavailable");
  assertWriteAllowed("an Ask interaction");
  signal?.throwIfAborted();
  const db = getDb();
  const query = db.insert(askInteractions).values({ ...row, answerMode }).toSQL();
  await db.$client.query(query.sql, query.params, { fetchOptions: { signal } });
}
