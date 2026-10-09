/** New Jersey native ELEC filings; source errors never become report absences. */
import { ELEC_CONTROL_LOCATION, ELEC_ENTITY_ENDPOINT, ELEC_LOCATION_PAGE, elecFilingUrl, elecRequestBody,
  normalizeElecFiling, normalizeElecRow, parseLocationCodes, totalElecMoney, type ElecEntity, type ElecMoneyTotal } from "../lib/hunt/nj-elec.ts";
import { nativeStateMoneyRecord } from "../lib/funding/state-native.ts";
import { runStateFinance, type StateFinanceIO, type StateFinanceCollected } from "./lib/state-money-runner.mts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

export const AGENCY = "New Jersey Election Law Enforcement Commission";
const HEADERS = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest", Referer: ELEC_LOCATION_PAGE };
export function parseElecEntities(raw: string): { rows: ElecEntity[]; total: number; pageRows: number; invalidRows: number } {
  const parsed = JSON.parse(raw) as { data?: Record<string, unknown>[]; recordsTotal?: number; recordsFiltered?: number };
  const total = parsed.recordsFiltered ?? parsed.recordsTotal;
  if (!Array.isArray(parsed.data) || !Number.isSafeInteger(total) || total! < 0) throw new Error("ELEC_ENTITY_PAGE_INVALID");
  const rows: ElecEntity[] = [];
  let invalidRows = 0;
  for (const rawRow of parsed.data) {
    try {
      const row = normalizeElecRow(rawRow);
      if (!row.entityId || !row.entityName) invalidRows++;
      else rows.push(row);
    } catch { invalidRows++; }
  }
  return { rows, total: total!, pageRows: parsed.data.length, invalidRows };
}

export type ElecFilingRead = { kind: "FILED"; money: ElecMoneyTotal; observedAt: string } | { kind: "EMPTY"; observedAt: string } | { kind: "FAILED" };
export async function readElecFilings(io: Pick<StateFinanceIO, "read">, id: string): Promise<ElecFilingRead> {
  try {
    const validate = (raw: string) => {
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error("ELEC_FILINGS_NOT_ARRAY");
      const rows = value.map(normalizeElecFiling);
      if (rows.some(row => String(row.entityId) !== id)) throw new Error("ELEC_FILINGS_WRONG_ENTITY");
      return rows;
    };
    const acquired = await io.read(elecFilingUrl(id), { headers: HEADERS, validate });
    const rows = validate(acquired.text);
    return rows.length ? { kind: "FILED", money: totalElecMoney(rows), observedAt: acquired.receipt.sourceObservedAt }
      : { kind: "EMPTY", observedAt: acquired.receipt.sourceObservedAt };
  } catch { return { kind: "FAILED" }; }
}

export async function collectNjFinance(io: StateFinanceIO): Promise<StateFinanceCollected> {
  const index = await io.read(ELEC_LOCATION_PAGE, { validate: raw => { if (!parseLocationCodes(raw).size) throw new Error("ELEC_LOCATIONS_UNREADABLE"); } });
  const codes = parseLocationCodes(index.text);
  const control = await io.read(ELEC_ENTITY_ENDPOINT, { headers: HEADERS,
    body: elecRequestBody({ locationCode: ELEC_CONTROL_LOCATION, electionYear: String(io.year), length: 100 }), validate: parseElecEntities });
  const empty = parseElecEntities(control.text);
  if (empty.pageRows || empty.total !== 0) throw new Error("ELEC_LOCATION_FILTER_NOT_APPLIED");
  const ordered = [...codes].sort(([, a], [, b]) => (io.attempts[`location:${a}:${io.year}`] ?? "").localeCompare(io.attempts[`location:${b}:${io.year}`] ?? "") || a.localeCompare(b));
  const records: StateMoneyRecord[] = [], seen = new Set<string>();
  let complete = true, completed = 0;
  for (const [name, code] of ordered) {
    if (io.signal.aborted) { complete = false; break; }
    io.attempts[`location:${code}:${io.year}`] = new Date().toISOString();
    const cursorKey = `nj:${io.year}:${code}`;
    let start = io.cursors[`${cursorKey}:start`] ?? 0, expected: number | null = start ? io.cursors[`${cursorKey}:total`] ?? null : null;
    const locationIds = new Set<string>();
    try {
      for (;;) {
        const pageRead = await io.read(ELEC_ENTITY_ENDPOINT, { headers: HEADERS,
          body: elecRequestBody({ locationCode: code, electionYear: String(io.year), start, length: 100 }), validate: parseElecEntities });
        const page = parseElecEntities(pageRead.text);
        if (expected !== null && page.total !== expected) { io.cursors[`${cursorKey}:start`] = 0; throw new Error("ELEC_PAGINATION_CHANGED"); }
        expected = page.total;
        if (page.invalidRows) {
          complete = false;
          io.gaps.push({ code: "ELEC_ENTITY_IDENTITY_UNRESOLVED", detail: `${name}: ${page.invalidRows} rows lack native entity identity; other filing queries remain usable.` });
        }
        for (const entity of page.rows) {
          if (locationIds.has(entity.entityId)) throw new Error("ELEC_PAGINATION_REPEATED");
          locationIds.add(entity.entityId);
          if (Number(entity.electionYear) !== io.year) throw new Error("ELEC_PERIOD_MISMATCH");
          if (seen.has(entity.entityId)) continue;
          seen.add(entity.entityId);
          const filing = await readElecFilings(io, entity.entityId);
          if (filing.kind === "FAILED") {
            complete = false;
            io.gaps.push({ code: "ELEC_FILING_UNREAD", detail: `${entity.entityId}: filing retrieval failed; previous facts retained; no report absence inferred.` });
            continue;
          }
          const money = filing.kind === "FILED" ? filing.money : null;
          records.push(nativeStateMoneyRecord({ state: "NJ", committeeId: entity.entityId, name: entity.entityName,
            candidateName: entity.entityName, office: entity.office || null, year: io.year,
            receipts: money?.receipts ?? null, spent: money?.disbursements ?? null, reportCount: money?.reportsCounted ?? 0,
            filingState: money?.moneyReports ? money.receipts !== null || money.disbursements !== null ? "FILED" : "ROUTE_UNREAD"
              : money ? "REGISTERED_NO_ACTIVITY_REPORTED" : "NO_REPORTS_ON_FILE",
            period: money ? `${io.year}: ${money.forms.join(", ")} through ${money.latestFiling ?? "unstated date"}` : `${io.year} ${entity.electionType || "election"}`,
            sourceUrl: `${ELEC_LOCATION_PAGE}?entity=${encodeURIComponent(entity.entityId)}`, agency: AGENCY, observedAt: filing.observedAt }));
        }
        start += page.pageRows;
        if (start > expected) throw new Error("ELEC_PAGINATION_OVERFLOW");
        io.cursors[`${cursorKey}:start`] = start; io.cursors[`${cursorKey}:total`] = expected;
        if (start === expected) { io.cursors[`${cursorKey}:start`] = 0; break; }
        if (!page.pageRows) throw new Error("ELEC_PAGINATION_TRUNCATED");
      }
      completed++;
    } catch {
      complete = false;
      io.gaps.push({ code: "ELEC_LOCATION_PARTIAL", detail: `${name}: source pages did not complete; independently received filing records remain usable.` });
    }
  }
  return { records, complete, query: `ELEC ${io.year} native entity and amendment-resolved filing records; ${completed}/${codes.size} source locations completed` };
}
if (import.meta.filename === process.argv[1]) {
  if (!process.argv.includes("--promote")) throw new Error("Invoke the registered state-finance adapter with --promote.");
  prepareProductionCivicDataWrite();
  await runStateFinance("NJ", ELEC_LOCATION_PAGE, collectNjFinance, new PostgresRoutineDataStore());
}
