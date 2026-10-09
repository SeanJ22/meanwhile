/** New Hampshire's native filer index publishes independently of any ballot. */
import { nativeStateMoneyRecord } from "../lib/funding/state-native.ts";
import { runStateFinance, type StateFinanceIO, type StateFinanceCollected } from "./lib/state-money-runner.mts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";

export const AGENCY = "New Hampshire Secretary of State — Campaign Finance System";
export const API = "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
export const PUBLIC_PAGE = "https://cfs.sos.nh.gov/";
export const HEADERS = { "content-type": "application/json", accept: "application/json, text/plain, */*",
  origin: PUBLIC_PAGE.slice(0, -1), referer: PUBLIC_PAGE, from: "seanj22@gmail.com", "x-purpose": "civic campaign-finance index" };
export interface FilerRow {
  filerName: string; firstnameLastname: string | null; officeSoughtName: string | null;
  districtName: string | null; town: string | null; electionYear: number | null;
  totalRaised: number | null; totalSpent: number | null; filerEntityId: number | null;
  electionCycle: string | null; filerTypeDesc: string | null;
}
export interface FilerPage { status: number; totalItems: number | null; items: FilerRow[]; observedAt?: string }
export type FetchPage = (input: { surname: string; pageNumber: number; pageSize: number }) => Promise<FilerPage>;
export interface FilerRead { ok: boolean; rows: FilerRow[]; retrieved: number; totalItems: number | null;
  denominatorProven: boolean; reason?: string }

export function parseNhFilerPage(raw: string): Omit<FilerPage, "status"> {
  const body = JSON.parse(raw) as { data?: { items?: FilerRow[]; totalItems?: number } };
  if (!Array.isArray(body.data?.items) || !Number.isSafeInteger(body.data?.totalItems) || body.data!.totalItems! < 0) throw new Error("NH_FILER_PAGE_INVALID");
  return { items: body.data!.items!, totalItems: body.data!.totalItems! };
}

/** Short, changed, duplicate or failed pages leave verified rows usable; no absence is inferred. */
export async function readFilers(surname: string, fetchPage: FetchPage, options: { year?: number | null; pageSize?: number; maxPages?: number;
  startPage?: number; startOffset?: number; expectedTotal?: number | null; onPage?: (page: FilerPage, pageNumber: number) => void } = {}): Promise<FilerRead> {
  const rows: FilerRow[] = [], seen = new Set<string>();
  const size = options.pageSize ?? 500;
  const startPage = options.startPage ?? 1, offset = options.startOffset ?? (startPage - 1) * size;
  let expected: number | null = options.expectedTotal ?? null;
  const result = (ok: boolean, reason?: string): FilerRead => ({ ok, rows: options.year === undefined || options.year === null ? rows : rows.filter(row => row.electionYear === options.year),
    retrieved: rows.length, totalItems: expected, denominatorProven: ok && expected !== null, ...(reason ? { reason } : {}) });
  try {
    for (let pageNumber = startPage; pageNumber < startPage + (options.maxPages ?? 200); pageNumber++) {
      const page = await fetchPage({ surname, pageNumber, pageSize: size });
      if (page.status !== 200) return result(false, `NH filer page ${pageNumber}: HTTP ${page.status}`);
      if (!Number.isSafeInteger(page.totalItems) || page.totalItems! < 0 || expected !== null && page.totalItems !== expected) return result(false, "NH filer denominator changed or is missing");
      expected = page.totalItems;
      for (const row of page.items) {
        if (!row || !Number.isSafeInteger(row.filerEntityId) || !Number.isSafeInteger(row.electionYear)) continue;
        const key = `${row.filerEntityId}:${row.electionYear}`;
        if (seen.has(key)) return result(false, "NH filer pagination repeated a source identity");
        seen.add(key);
      }
      if (offset + rows.length + page.items.length > expected!) return result(false, "NH filer page exceeded its denominator");
      rows.push(...page.items); options.onPage?.(page, pageNumber);
      if (offset + rows.length === expected) return result(true);
      if (!page.items.length) return result(false, "NH filer result was truncated");
    }
    return result(false, "NH filer page limit reached; continuation remains owed");
  } catch { return result(false, "NH filer retrieval failed; received rows remain usable"); }
}

export function nhNativeRecord(row: FilerRow, observedAt: string): StateMoneyRecord | null {
  if (!row || typeof row !== "object" || !Number.isSafeInteger(row.filerEntityId) || row.filerEntityId! <= 0 ||
      !Number.isSafeInteger(row.electionYear) || row.electionYear! < 1900 || typeof row.filerName !== "string" || !row.filerName.trim()) return null;
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const raised = numeric(row.totalRaised), spent = numeric(row.totalSpent), empty = raised === 0 && spent === 0;
  return nativeStateMoneyRecord({ state: "NH", committeeId: String(row.filerEntityId), name: row.filerName,
    candidateName: typeof row.firstnameLastname === "string" ? row.firstnameLastname : "",
    office: typeof row.officeSoughtName === "string" ? row.officeSoughtName : null, year: row.electionYear!,
    receipts: empty ? null : raised, spent: empty ? null : spent,
    filingState: empty ? "REGISTERED_NO_ACTIVITY_REPORTED" : raised !== null || spent !== null ? "FILED" : "ROUTE_UNREAD",
    period: typeof row.electionCycle === "string" && row.electionCycle.trim() ? row.electionCycle : `${row.electionYear} election cycle`, sourceUrl: PUBLIC_PAGE, agency: AGENCY, observedAt });
}
export async function collectNhFinance(io: StateFinanceIO): Promise<StateFinanceCollected> {
  const records: StateMoneyRecord[] = [];
  const startPage = io.cursors["nh:next-page"] ?? 1;
  const read = await readFilers("", async ({ surname, pageNumber, pageSize }) => {
    const acquired = await io.read(API, { headers: HEADERS, body: JSON.stringify({ filerName: surname, pageNumber, pageSize }), validate: parseNhFilerPage });
    return { ...parseNhFilerPage(acquired.text), status: acquired.receipt.httpStatus, observedAt: acquired.receipt.sourceObservedAt };
  }, { startPage, startOffset: io.cursors["nh:offset"] ?? 0, expectedTotal: startPage > 1 ? io.cursors["nh:source-total"] : null, onPage: (page, pageNumber) => {
    io.cursors["nh:next-page"] = pageNumber + 1; io.cursors["nh:source-total"] = page.totalItems!;
    io.cursors["nh:offset"] = (io.cursors["nh:offset"] ?? 0) + page.items.length;
    for (const row of page.items) {
    const record = nhNativeRecord(row, page.observedAt!); if (record) records.push(record);
    else io.gaps.push({ code: "NH_NATIVE_ID_OR_PERIOD_UNRESOLVED", detail: "A filer row lacks its native ID or election period; no person or amount was invented." });
  } } });
  if (read.ok || read.reason?.includes("denominator")) { io.cursors["nh:next-page"] = 1; io.cursors["nh:offset"] = 0; }
  if (!read.ok) io.gaps.push({ code: "NH_INDEX_PARTIAL", detail: read.reason! });
  return { records, complete: read.ok, query: `All New Hampshire filer index pages; ${read.retrieved}/${read.totalItems ?? "unstated"} source rows, each with its filed election period` };
}
if (import.meta.filename === process.argv[1]) await runStateFinance("NH", API, collectNhFinance);
