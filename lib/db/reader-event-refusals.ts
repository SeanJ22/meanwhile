import { neon } from "@neondatabase/serverless";
import { assertWriteAllowed } from "./write-guard.ts";

/** Why `/api/events` turned a batch away. A count by day and reason; no batch content, no reader. */
export const REFUSAL_REASONS = ["TOO_LARGE", "NOT_JSON", "CROSS_ORIGIN", "RATE_LIMITED", "MALFORMED", "STORE_UNAVAILABLE"] as const;
export type RefusalReason = typeof REFUSAL_REASONS[number];

export async function countRefusedBatch(reason: RefusalReason, options: {
  readonly now?: Date;
  readonly query?: (statement: string, params: readonly unknown[]) => Promise<unknown>;
} = {}): Promise<void> {
  try {
    assertWriteAllowed("reader event refusals");
    const query = options.query ?? ((statement, params) => neon(process.env.DATABASE_URL!).query(statement, [...params]));
    await query(`INSERT INTO reader_event_refusals (day, reason, refusals) VALUES ($1::date, $2, 1)
      ON CONFLICT (day, reason) DO UPDATE SET refusals = reader_event_refusals.refusals + 1`,
    [(options.now ?? new Date()).toISOString().slice(0, 10), reason]);
  } catch {
    // Counting a refusal must never change the answer the reader's browser gets.
  }
}
