import { neon } from "@neondatabase/serverless";

interface CarryOverRow {
  readonly id: string; readonly received_at: string; readonly message: string;
  readonly surface: string; readonly contact_ref: string | null; readonly run_class: string;
  readonly run_id: string | null; readonly suspect_reason: string | null; readonly site: string;
  readonly reply_address: string | null; readonly contact_received_at: string | null;
}

/** One-time transfer after deployment. Counts only; reader prose never enters the log. */
export async function carryOverFeedback(sourceConnection: string, targetConnection: string, copy: boolean) {
  if (sourceConnection === targetConnection) throw new Error("Feedback carry-over requires two different stores.");
  const source = neon(sourceConnection);
  const target = neon(targetConnection);
  const newest = await target.query("SELECT max(received_at)::text AS newest FROM feedback", []);
  const since = newest[0]?.newest ?? "0001-01-01T00:00:00Z";
  const count = await source.query("SELECT count(*)::text AS count FROM feedback WHERE received_at > $1::timestamptz", [since]);
  if (!copy) return { kind: "PLAN" as const, since, reports: Number(count[0]?.count ?? 0), copied: 0 };
  let copied = 0;
  let cursor: { at: string; id: string } | null = null;
  while (true) {
    const rows: CarryOverRow[] = await source.query(`SELECT f.id, f.received_at::text, f.message, f.surface, f.contact_ref,
      f.run_class, f.run_id, f.suspect_reason, coalesce(to_jsonb(f)->>'site', 'live') AS site,
      c.address AS reply_address, c.received_at::text AS contact_received_at
      FROM feedback f LEFT JOIN feedback_contact c ON c.contact_ref = f.contact_ref
      WHERE f.received_at > $1::timestamptz
      AND ($2::timestamptz IS NULL OR (f.received_at, f.id) > ($2::timestamptz, $3::uuid))
      ORDER BY f.received_at, f.id LIMIT 100`, [since, cursor?.at ?? null, cursor?.id ?? null]) as CarryOverRow[];
    if (!rows.length) break;
    const statements = rows.flatMap(row => [
      ...(row.contact_ref && row.reply_address ? [target.query(`INSERT INTO feedback_contact(contact_ref,address,received_at)
        VALUES ($1,$2,$3::timestamptz) ON CONFLICT(contact_ref) DO NOTHING`,
        [row.contact_ref, row.reply_address, row.contact_received_at])] : []),
      target.query(`INSERT INTO feedback(id,received_at,message,surface,contact_ref,run_class,run_id,suspect_reason,site)
        VALUES ($1::uuid,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [row.id,row.received_at,row.message,row.surface,row.contact_ref,row.run_class,row.run_id,row.suspect_reason,row.site]),
    ]);
    const results = await target.transaction(statements);
    copied += results.reduce((total, result) => total + result.length, 0);
    const last: CarryOverRow = rows.at(-1)!;
    cursor = { at: last.received_at, id: last.id };
  }
  return { kind: "COPIED" as const, since, reports: Number(count[0]?.count ?? 0), copied };
}
