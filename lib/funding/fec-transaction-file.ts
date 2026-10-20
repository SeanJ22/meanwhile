import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { fecId, fecText, fecScheduleCursor, type FecReadPage, type FecRow } from "./fec-api.ts";
import type { ContributionRow } from "./types.ts";

/** Complete committee pagination and amendment reconciliation stay on disk.
 * The source's top five current organization receipts are the only result retained. */
export async function collectFecOrganizationReceipts(read: FecReadPage, committeeId: string, cycle: number,
  project: (row: FecRow) => ContributionRow[]): Promise<ContributionRow[]> {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => {
    exec(sql: string): void; close(): void; prepare(sql: string): {run(...values: (string | null)[]): unknown; iterate(): Iterable<Record<string, unknown>>; get(): unknown};
  } };
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-fec-ledger-"));
  const db = new DatabaseSync(temporaryPath(join(directory, "ledger.sqlite")));
  try {
    db.exec(`PRAGMA cache_size=-1024; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE;
      CREATE TABLE receipts(id TEXT PRIMARY KEY,original_id TEXT,transaction_id TEXT,report TEXT,file_order TEXT NOT NULL,id_order TEXT NOT NULL,payload TEXT NOT NULL,observed_at TEXT);
      CREATE INDEX original_ids ON receipts(original_id); CREATE TABLE cursors(value TEXT PRIMARY KEY)`);
    const insert = db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?)"), cursor = db.prepare("INSERT INTO cursors VALUES(?)");
    let seen = 0, expected: number | undefined;
    const query: Record<string, string | number | boolean> = { committee_id: committeeId, two_year_transaction_period: cycle,
      is_individual: false, sort: "-contribution_receipt_amount", per_page: 100 };
    const numeric = (value: string | null) => value && /^\d+$/.test(value) ? BigInt(value).toString() : "0";
    for (;;) {
      const page = await read("/schedules/schedule_a/", query), count = page.pagination.count;
      if (!Number.isSafeInteger(count) || count! < 0 || expected !== undefined && expected !== count) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_COUNT_INVALID");
      expected = count!;
      db.exec("BEGIN");
      try {
        for (const row of page.results) {
          const id = fecId(row.sub_id), original = fecId(row.original_sub_id), year = fecId(row.report_year), reportType = fecText(row.report_type);
          if (row.committee_id !== committeeId || !id) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TRANSACTION_IDENTITY_INVALID");
          const payload = Object.fromEntries(["committee_id", "sub_id", "original_sub_id", "file_number", "transaction_id", "report_year", "report_type", "memoed_subtotal", "is_deleted", "entity_type", "line_number", "contribution_receipt_amount", "contributor_state", "contributor_id", "contribution_receipt_date", "contributor"].map(key => [key, row[key]]));
          if (["CCM", "COM", "ORG", "PAC", "PTY"].includes(String(row.entity_type))) payload.contributor_name = row.contributor_name;
          try { insert.run(id, original && original !== "0" ? original : null, fecText(row.transaction_id), year && reportType ? `${year}:${reportType}` : null,
            numeric(fecId(row.file_number)), numeric(id), JSON.stringify(payload), page.sourceObservedAt ?? null); }
          catch (error) { if (/UNIQUE constraint failed/.test(String(error))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TRANSACTION_IDENTITY_INVALID"); throw error; }
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      seen += page.results.length;
      if (seen > expected) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_OVERFLOW");
      if (seen === expected) break;
      const next = fecScheduleCursor(page.pagination);
      if (!page.results.length || !next) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_CURSOR_INVALID");
      try { cursor.run(JSON.stringify(next)); } catch (error) { if (/UNIQUE constraint failed/.test(String(error))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_CURSOR_INVALID"); throw error; }
      Object.assign(query, next);
    }
    db.exec(`CREATE TEMP TABLE current AS WITH keyed AS (
      SELECT *, CASE WHEN original_id IS NOT NULL THEN 'original:'||original_id
        WHEN EXISTS(SELECT 1 FROM receipts n WHERE n.original_id=r.id) THEN 'original:'||id
        WHEN transaction_id IS NOT NULL THEN 'report:'||coalesce(report,'unscoped')||':'||transaction_id ELSE 'sub:'||id END AS transaction_key
      FROM receipts r) SELECT *,row_number() OVER(PARTITION BY transaction_key ORDER BY length(file_order) DESC,file_order DESC,length(id_order) DESC,id_order DESC) AS rank FROM keyed`);
    if (db.prepare("SELECT 1 FROM current WHERE transaction_key LIKE 'report:unscoped:%' GROUP BY transaction_key HAVING count(*)>1 LIMIT 1").get())
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TRANSACTION_AMENDMENT_SCOPE_UNRESOLVED");
    let top: ContributionRow[] = [];
    for (const row of db.prepare("SELECT payload,observed_at FROM current WHERE rank=1").iterate()) {
      const native = JSON.parse(String(row.payload)) as FecRow;
      if (native.memoed_subtotal === true || native.is_deleted === true) continue;
      const projected = project(native).map(value => ({ ...value, ...(row.observed_at ? { sourceObservedAt: String(row.observed_at) } : {}) }));
      top = [...top, ...projected].sort((a, b) => b.amount - a.amount).slice(0, 5);
    }
    return top;
  } finally { db.close(); await rm(temporaryPath(directory), { recursive: true, force: true }); }
}
