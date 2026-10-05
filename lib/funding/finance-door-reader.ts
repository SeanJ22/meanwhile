import { createHash } from "node:crypto";
import { parseCsv } from "../reference/index.ts";
import { readZip } from "../sources/legiscan/zip.ts";
import type { DoorRecord } from "../doors/registry.ts";

export const FINANCE_DOOR_KINDS = ["campaign-finance-csv", "campaign-finance-search-api", "campaign-finance-bulk-zip"] as const;
export type FinanceDoorKind = typeof FINANCE_DOOR_KINDS[number];
export interface FinanceFiling {
  readonly id: string;
  readonly doorId: string;
  readonly ocdId: string;
  readonly committeeId: string;
  readonly registeredName: string;
  readonly candidateName: string | null;
  readonly office: string | null;
  readonly electionYear: number;
  readonly reportId: string | null;
  readonly period: string | null;
  readonly receipts: number | null;
  readonly expenditures: number | null;
  readonly cashOnHand: number | null;
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly retrievedAt: string;
}
export interface SavedFinanceResponse {
  readonly url: string;
  readonly bytes: Buffer;
  readonly retrievedAt: string;
  readonly complete: boolean;
}
export interface FinanceDoorRead {
  readonly doorId: string;
  readonly filings: readonly FinanceFiling[];
  readonly captures: readonly { url: string; hash: string; retrievedAt: string }[];
  readonly paginationComplete: boolean;
}
type Field = "committeeId" | "registeredName" | "candidateName" | "office" | "electionYear" | "reportId" | "period" | "receipts" | "expenditures" | "cashOnHand";
const FIELDS: readonly Field[] = ["committeeId", "registeredName", "candidateName", "office", "electionYear", "reportId", "period", "receipts", "expenditures", "cashOnHand"];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
function path(value: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((at, key) => at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined, value);
}
function amount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = text(value).replace(/^\$/, "").replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error("A filed amount could not be read.");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error("A filed amount is not finite.");
  return parsed;
}
function fieldMap(door: DoorRecord): Partial<Record<Field, string>> {
  if (typeof door.config.fieldMap !== "string") throw new Error("The finance door has no field map.");
  const value = JSON.parse(door.config.fieldMap) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The finance field map is unreadable.");
  const out: Partial<Record<Field, string>> = {};
  for (const field of FIELDS) if (typeof value[field] === "string" && value[field]) out[field] = value[field];
  for (const field of ["committeeId", "registeredName", "electionYear"] as const) {
    if (!out[field]) throw new Error(`The finance field map lacks ${field}.`);
  }
  return out;
}
function csvRows(bytes: Buffer, required: readonly string[]): Record<string, unknown>[] {
  const [headers, ...rows] = parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error("The filing export has no unique column names.");
  if (required.some(field => !headers.includes(field))) throw new Error("The filing export lacks its mapped identity columns.");
  return rows.filter(row => row.some(cell => cell.trim())).map(row => {
    if (row.length !== headers.length) throw new Error("A filing row differs from the export's columns.");
    return Object.fromEntries(headers.map((key, at) => [key, row[at]]));
  });
}

/** Read saved bytes through the door's field map; never hunt or join by a name. */
export function readFinanceDoor(door: DoorRecord, responses: readonly SavedFinanceResponse[]): FinanceDoorRead {
  if (!(FINANCE_DOOR_KINDS as readonly string[]).includes(door.kind) || !door.ocdId) throw new Error("This door does not identify a finance reader and jurisdiction.");
  if (!responses.length) throw new Error("No saved finance response is available.");
  const fields = fieldMap(door), filings: FinanceFiling[] = [], captures: FinanceDoorRead["captures"][number][] = [];
  let declaredTotal: number | null = null, returnedRows = 0;
  for (const response of responses) {
    if (!door.hosts.includes(new URL(response.url).hostname.toLowerCase())) throw new Error("The saved response is outside this door's source hosts.");
    if (!Number.isFinite(Date.parse(response.retrievedAt))) throw new Error("The saved response has no read date.");
    const sourceHash = hash(response.bytes);
    captures.push({ url: response.url, hash: sourceHash, retrievedAt: response.retrievedAt });
    let rows: Record<string, unknown>[];
    if (door.kind === "campaign-finance-search-api") {
      const value = JSON.parse(response.bytes.toString("utf8"));
      const found = typeof door.config.rowsPath === "string" ? path(value, door.config.rowsPath) : value;
      if (!Array.isArray(found) || found.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("The finance search response contains no record list.");
      rows = found;
      if (typeof door.config.totalPath === "string") {
        const stated = path(value, door.config.totalPath);
        if (typeof stated !== "number" && !(typeof stated === "string" && /^\d+$/.test(stated.trim()))) throw new Error("The search response's filed record count changed or is unreadable.");
        const total = Number(stated);
        if (!Number.isSafeInteger(total) || total < 0 || (declaredTotal !== null && declaredTotal !== total)) throw new Error("The search response's filed record count changed or is unreadable.");
        declaredTotal = total;
      }
    } else if (door.kind === "campaign-finance-bulk-zip") {
      if (typeof door.config.fileName !== "string") throw new Error("The bulk door lacks its export file name.");
      const entries = readZip(response.bytes).filter(entry => entry.name === door.config.fileName);
      if (entries.length !== 1) throw new Error("The bulk archive does not contain exactly the named export.");
      rows = csvRows(entries[0].data, [fields.committeeId!, fields.registeredName!, fields.electionYear!]);
    } else rows = csvRows(response.bytes, [fields.committeeId!, fields.registeredName!, fields.electionYear!]);
    returnedRows += rows.length;
    for (const row of rows) {
      const get = (field: Field) => fields[field] ? Object.hasOwn(row, fields[field]!) ? row[fields[field]!] : path(row, fields[field]!) : undefined;
      const committeeId = text(get("committeeId")), registeredName = text(get("registeredName"));
      const electionYear = Number(get("electionYear"));
      if (!committeeId || !registeredName || !Number.isSafeInteger(electionYear) || electionYear < 1900) throw new Error("A filing lacks its committee identifier, registered name or election cycle.");
      const reportId = text(get("reportId")) || null, period = text(get("period")) || null;
      filings.push({ id: `finance-filing:${hash(JSON.stringify([door.doorId, committeeId, electionYear, reportId, period]))}`,
        doorId: door.doorId, ocdId: door.ocdId, committeeId, registeredName,
        candidateName: text(get("candidateName")) || null, office: text(get("office")) || null,
        electionYear, reportId, period, receipts: amount(get("receipts")), expenditures: amount(get("expenditures")),
        cashOnHand: amount(get("cashOnHand")), sourceUrl: response.url, sourceHash, retrievedAt: response.retrievedAt });
    }
  }
  if (new Set(filings.map(row => row.id)).size !== filings.length) throw new Error("The filing response repeats a report identity; its rows cannot be silently summed.");
  return { doorId: door.doorId, filings, captures,
    paginationComplete: responses.every(row => row.complete) && (declaredTotal === null || declaredTotal === returnedRows) };
}
