/** Shared OpenFEC identities, paging and amendment rules for acquisition and Ask. */
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
export type FecRow = Record<string, unknown>;
export interface FecPage { results: FecRow[]; pagination: { count?: number; pages?: number; last_indexes?: Record<string, unknown> }; sourceObservedAt?: string }
const sourceObservations = new WeakMap<FecRow, string>();
export const fecSourceObservedAt = (row: FecRow): string | undefined => sourceObservations.get(row);
export const fecObject = (value: unknown): FecRow | null => value && typeof value === "object" && !Array.isArray(value) ? value as FecRow : null;
export const fecText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export const fecNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
export const fecId = (value: unknown): string | null => typeof value === "string" && value ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;

/** FEC sub_ids exceed JavaScript's safe integer range. Never round a native key. */
export function parseFecPage(raw: string): FecPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw, (key: string, value: unknown, context?: { source?: string }) =>
      ["sub_id", "original_sub_id", "last_index", "file_number"].includes(key) && typeof value === "number" && context?.source && /^\d+$/.test(context.source) ? context.source : value);
  } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_JSON_INVALID"); }
  const body = fecObject(parsed), pagination = fecObject(body?.pagination);
  if (!Array.isArray(body?.results) || body.results.some(row => !fecObject(row))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_RESULTS_INVALID");
  return { results: body.results, pagination: pagination ?? {} };
}

export function fecScheduleCursor(pagination: FecPage["pagination"]): Record<string, string> | null {
  const next = pagination.last_indexes;
  const index = fecId(next?.last_index), amount = next?.last_contribution_receipt_amount;
  if (!index || !(typeof amount === "string" || typeof amount === "number" && Number.isFinite(amount))) return null;
  return { last_index: index, last_contribution_receipt_amount: String(amount) };
}

export function fecCycle(asOf: Date, requested?: string): number {
  const cycle = requested === undefined ? Math.ceil(asOf.getUTCFullYear() / 2) * 2 : Number(requested);
  if (!Number.isSafeInteger(cycle) || cycle < 1900 || cycle % 2 !== 0) throw new Error("FEC_CYCLE_INVALID");
  return cycle;
}
export type FecReadPage = (path: string, params: Record<string, string | number | boolean>) => Promise<FecPage>;

/** Completeness is the source's stable denominator, never a short local page. */
export async function readFecPages(read: FecReadPage, path: string, params: Record<string, string | number | boolean>, cursor = false): Promise<FecRow[]> {
  const rows: FecRow[] = [], cursors = new Set<string>(), nativeIds = new Set<string>();
  let expected: number | null = null, page = 1;
  const query = { ...params, per_page: 100 };
  for (;;) {
    const result = await read(path, cursor ? query : { ...query, page });
    const count = result.pagination.count;
    if (!Number.isSafeInteger(count) || count! < 0 || expected !== null && count !== expected) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_COUNT_INVALID");
    expected = count!;
    if (cursor) for (const row of result.results) {
      const id = fecId(row.sub_id);
      if (!id || nativeIds.has(id)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_CURSOR_IDENTITY_INVALID");
      nativeIds.add(id);
    }
    if (result.sourceObservedAt) for (const row of result.results) sourceObservations.set(row, result.sourceObservedAt);
    rows.push(...result.results);
    if (rows.length > expected) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_OVERFLOW");
    if (rows.length === expected) return rows;
    if (!result.results.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_TRUNCATED");
    if (cursor) {
      const next = fecScheduleCursor(result.pagination);
      if (!next || cursors.has(JSON.stringify(next))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_CURSOR_INVALID");
      cursors.add(JSON.stringify(next)); Object.assign(query, next);
    } else {
      const pages = result.pagination.pages;
      if (!Number.isSafeInteger(pages) || page >= pages!) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_PAGINATION_TRUNCATED");
      page++;
    }
  }
}

/** Latest filed version of each native transaction; memo records are not extra money. */
export function currentFecTransactions(rows: readonly FecRow[], committeeId: string): FecRow[] {
  const byTransaction = new Map<string, FecRow>(), subIds = new Set<string>();
  const originals = new Set(rows.map(row => fecId(row.original_sub_id)).filter((id): id is string => Boolean(id && id !== "0")));
  const order = (row: FecRow) => [fecId(row.file_number) ?? "0", fecId(row.sub_id) ?? "0"].map(id => BigInt(/^\d+$/.test(id) ? id : "0"));
  for (const row of rows) {
    const id = fecId(row.sub_id), transaction = fecText(row.transaction_id);
    if (row.committee_id !== committeeId || !id || subIds.has(id)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TRANSACTION_IDENTITY_INVALID");
    subIds.add(id);
    const original = fecId(row.original_sub_id);
    const reportYear = fecId(row.report_year), reportType = fecText(row.report_type);
    const originalId = original && original !== "0" ? original : originals.has(id) ? id : null;
    // Software may reuse a transaction ID in a different report. Only a native
    // original-row link or the same native report period establishes amendment identity.
    const report = reportYear && reportType ? `${reportYear}:${reportType}` : null;
    const key = originalId ? `original:${originalId}` : transaction ? `report:${report ?? "unscoped"}:${transaction}` : `sub:${id}`;
    const previous = byTransaction.get(key);
    if (previous && !originalId && !report) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TRANSACTION_AMENDMENT_SCOPE_UNRESOLVED");
    const nextOrder = order(row), heldOrder = previous ? order(previous) : null;
    if (!heldOrder || nextOrder[0] > heldOrder[0] || nextOrder[0] === heldOrder[0] && nextOrder[1] > heldOrder[1]) byTransaction.set(key, row);
  }
  return [...byTransaction.values()].filter(row => row.memoed_subtotal !== true && row.is_deleted !== true);
}
