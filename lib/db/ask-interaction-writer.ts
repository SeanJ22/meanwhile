import type { AskInteractionRow } from "./ask-signal.ts";
import { getDb } from "./index.ts";
import { askInteractions } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/** Receives the existing prepared row; never changes collection or retention. */
export async function writeAskInteraction(row: AskInteractionRow): Promise<void> {
  const answerMode = row.answerMode;
  if (answerMode === "OFF" || answerMode === "TRANSPORT_FAILED") {
    throw new Error(`${answerMode} is not a delivered Ask interaction`);
  }
  if (!process.env.DATABASE_URL) throw new Error("Ask question store is unavailable");
  assertWriteAllowed("an Ask interaction");
  await getDb().insert(askInteractions).values({ ...row, answerMode });
}
