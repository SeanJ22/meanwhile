import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import type { AskInteractionRow } from "./ask-signal.ts";
import { getDb } from "./index.ts";
import { askInteractions } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/** One full interaction, including an unanswered question when transport failed. */
export async function writeAskInteraction(row: AskInteractionRow): Promise<void> {
  if (row.answerMode === "OFF") throw new Error("OFF is not a delivered Ask interaction");
  if (!process.env.DATABASE_URL) throw new Error("Ask question store is unavailable");
  assertWriteAllowed("an Ask interaction");
  // STEP-7 release bridge: the same single insert spans the contract rename.
  // PostgreSQL maps the JSON to the table's actual row type atomically and
  // ignores the absent alias. River removes this bridge after STEP-7 applies.
  const columns = getTableColumns(askInteractions);
  const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [columns[key as keyof typeof columns].name, value]));
  const payload = { ...values, id: randomUUID(), question_scrubbed: row.question };
  await getDb().$client.query(
    'insert into "ask_interactions" select (jsonb_populate_record(NULL::"ask_interactions", $1::jsonb)).*',
    [JSON.stringify(payload)],
  );
}
