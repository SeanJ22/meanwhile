import { neon } from "@neondatabase/serverless";
import { assertWriteAllowed } from "./write-guard.ts";

interface CarryOverRow {
  id: string;
  received_at: string;
  message: string;
  surface: string;
  contact_ref: string | null;
  run_class: string;
  run_id: string | null;
  suspect_reason: string | null;
  site: string;
  about: string | null;
  zip: string | null;
  record_id: string | null;
  reply_address: string | null;
  contact_received_at: string | null;
}

/** One-time branch carry-over. Original IDs make retries harmless; no prose is logged. */
export async function carryOverFeedback(sourceConnection: string, targetConnection: string, copy: boolean) {
  if (sourceConnection === targetConnection) throw new Error("Feedback carry-over needs two different databases.");
  if (copy) assertWriteAllowed("feedback carry-over", { ...process.env, DATABASE_URL: targetConnection });
  const source = neon(sourceConnection);
  const target = neon(targetConnection);
  const summary = await source.query("SELECT count(*)::text AS count, max(received_at)::text AS through FROM feedback", []);
  const reports = Number(summary[0]?.count ?? 0);
  const through = summary[0]?.through as string | null;
  if (!copy || !through) return { kind: copy ? "COPIED" : "PLAN", through, reports, copied: 0 };

  let copied = 0;
  let cursor: { at: string; id: string } | null = null;
  while (true) {
    // JSON extraction lets the old store predate site/context columns. Never invent
    // the card or ZIP for a report filed before those fields existed.
    const rows = await source.query(`
      SELECT f.id, f.received_at::text, f.message, f.surface, f.contact_ref,
        f.run_class, f.run_id, f.suspect_reason,
        coalesce(to_jsonb(f)->>'site', 'live') AS site,
        to_jsonb(f)->>'about' AS about, to_jsonb(f)->>'zip' AS zip,
        to_jsonb(f)->>'record_id' AS record_id,
        c.address AS reply_address, c.received_at::text AS contact_received_at
      FROM feedback f LEFT JOIN feedback_contact c ON c.contact_ref = f.contact_ref
      WHERE f.received_at <= $1::timestamptz
        AND ($2::timestamptz IS NULL OR (f.received_at, f.id) > ($2::timestamptz, $3::uuid))
      ORDER BY f.received_at, f.id LIMIT 100`, [through, cursor?.at ?? null, cursor?.id ?? null]) as CarryOverRow[];
    if (!rows.length) break;
    const statements = rows.flatMap(row => [
      ...(row.contact_ref && row.reply_address ? [target.query(`
        INSERT INTO feedback_contact (contact_ref, address, received_at)
        VALUES ($1, $2, $3::timestamptz) ON CONFLICT (contact_ref) DO NOTHING`,
      [row.contact_ref, row.reply_address, row.contact_received_at])] : []),
      target.query(`
        INSERT INTO feedback (id, received_at, message, surface, contact_ref, run_class,
          run_id, suspect_reason, site, about, zip, record_id)
        VALUES ($1::uuid, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING RETURNING id`,
      [row.id, row.received_at, row.message, row.surface, row.contact_ref, row.run_class,
        row.run_id, row.suspect_reason, row.site, row.about, row.zip, row.record_id]),
    ]);
    const results = await target.transaction(statements);
    copied += results.reduce((total, result) => total + result.length, 0);
    const last = rows.at(-1)!;
    cursor = { at: last.received_at, id: last.id };
  }
  return { kind: "COPIED", through, reports, copied };
}
