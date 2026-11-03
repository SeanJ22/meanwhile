/**
 * The contract step of the move of the Box's links onto the work list. It deletes a Box row only when its link is on the work list with a
 * report from the same place (so its page and quote survive there), one page of rows at a time. Run it by hand, once, after a database snapshot
 * and after the moved links are proven draining: `node scripts/retire-moved-box-links.mts --snapshot-taken`.
 */
import { leadOf } from "../lib/core/leads.ts";
import pg from "pg";
import { workId } from "../lib/core/work.ts";

if (!process.argv.includes("--snapshot-taken")) throw new Error("retire-moved-box-links: take a database snapshot first, then pass --snapshot-taken");
const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!url) throw new Error("retire-moved-box-links: the control-plane database is not set");
// One connection, so each page's delete and its trigger change are one transaction.
const client = new pg.Client({ connectionString: url });
await client.connect();
const query = async (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => (await client.query(text, params)).rows;
const PAGE = 1_000;
let after = "", read = 0, deleted = 0;
for (;;) {
  const rows = await query("SELECT id, value FROM cp_box_findings WHERE id > $1 ORDER BY id LIMIT $2", [after, PAGE]);
  const moved = new Map<string, { id: string; subjectId: string }>();
  for (const { id, value } of rows) {
    const row = value as { state: string; subjectId: string; fact?: { field: string; value: unknown; recordClass: string | null }; exactQuote: string | null; sourceUrl: string | null; lastRecordedAt?: string; origins: { recordedAt: string }[] };
    if (!["waiting", "taken"].includes(row.state) || !row.fact) continue;
    const lead = leadOf({ subjectId: row.subjectId, field: row.fact.field, value: row.fact.value, recordClass: row.fact.recordClass, exactQuote: row.exactQuote, sourceUrl: row.sourceUrl, recordedAt: row.lastRecordedAt ?? row.origins[0]!.recordedAt });
    if (lead) moved.set(String(id), { id: workId(lead), subjectId: row.subjectId });
  }
  const held = moved.size ? await query(`SELECT id, jsonb_agg(r->>'subjectId') AS subjects FROM work, jsonb_array_elements(reports) r WHERE kind = 'lead' AND id = ANY($1::text[]) GROUP BY id`, [[...new Set([...moved.values()].map(each => each.id))]]) : [];
  const on = new Map(held.map(row => [String(row.id), row.subjects as string[]]));
  const safe = [...moved].filter(([, each]) => on.get(each.id)?.includes(each.subjectId)).map(([id]) => id);
  if (safe.length) {
    // The Box refuses deletes; the refusal is lifted for this page only, in one transaction.
    await query("BEGIN");
    try {
      await query("ALTER TABLE cp_box_findings DISABLE TRIGGER cp_box_findings_no_rewrite");
      deleted += (await query("DELETE FROM cp_box_findings WHERE id = ANY($1::text[]) RETURNING id", [safe])).length;
      await query("ALTER TABLE cp_box_findings ENABLE TRIGGER cp_box_findings_no_rewrite");
      await query("COMMIT");
    } catch (error) { await query("ROLLBACK"); throw error; }
  }
  read += rows.length;
  console.error(`retired ${deleted} of ${read} Box rows read`);
  if (rows.length < PAGE) break;
  after = String(rows.at(-1)!.id);
}
process.exit(0);
