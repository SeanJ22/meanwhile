import { fetchSource } from "../sources/fetch-source.ts";
import { createHash } from "node:crypto";
import { readZipEntries } from "../sources/archive.ts";

export const CENSUS_GOVERNMENT_UNITS_URL =
  "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP" as const;
export const AZ_BULK_FILING_GUIDE_URL =
  "https://apps.azsos.gov/cfs/Bulk-Filing-Guide-202607-Fontes.pdf" as const;

export const JURISDICTION_REFERENCE_HTTP_SOURCES = [
  {
    id: "census-government-units-2022",
    url: CENSUS_GOVERNMENT_UNITS_URL,
    finalHosts: ["www2.census.gov"],
    mediaType: "application/zip",
  },
  {
    id: "az-sos-bulk-filing-guide-2026",
    url: AZ_BULK_FILING_GUIDE_URL,
    finalHosts: ["apps.azsos.gov"],
    mediaType: "application/pdf",
  },
] as const;

export type JurisdictionReferenceHttpSourceId = (typeof JURISDICTION_REFERENCE_HTTP_SOURCES)[number]["id"];

/** A page read again to confirm a reviewed website correction. */
export type WebsiteCorrectionSourceId = `website-correction:${string}`;

/** Exact response-byte receipt. The timestamp belongs to this response, not the batch. */
export interface JurisdictionReferenceSourceReceipt {
  readonly sourceId: JurisdictionReferenceHttpSourceId | WebsiteCorrectionSourceId;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly rawHash: string;
  readonly byteCount: number;
}

export interface CensusJurisdictionUnitInput {
  readonly name: string;
  readonly govType: string;
  readonly county: string;
  readonly web: string;
  readonly pid: string;
  readonly state: string;
  readonly active: boolean;
}

export interface JurisdictionReferenceAcquisitionSuccess {
  readonly kind: "ACQUIRED";
  readonly receipts: readonly JurisdictionReferenceSourceReceipt[];
  readonly censusUnits: readonly CensusJurisdictionUnitInput[];
  readonly dependentSchoolSystems: readonly CensusJurisdictionUnitInput[];
  readonly workbook: {
    readonly member: "Govt_Units_2022_Final.xlsx";
    readonly rawHash: string;
    readonly byteCount: number;
  };
}

export interface JurisdictionReferenceAcquisitionFailure {
  readonly kind: "FAILED";
  readonly stage: "FETCH" | "HTTP" | "REDIRECT" | "SOURCE_SHAPE" | "ARCHIVE" | "WORKBOOK";
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly retrievedAt: string;
  readonly rawHash: string | null;
  readonly byteCount: number;
  readonly detail: string;
  readonly receipts: readonly JurisdictionReferenceSourceReceipt[];
}

export type JurisdictionReferenceAcquisitionResult =
  | JurisdictionReferenceAcquisitionSuccess
  | JurisdictionReferenceAcquisitionFailure;

type FetchClock = () => string;

interface WorkbookDenominators {
  readonly general: number;
  readonly special: number;
  readonly school: number;
  readonly dependent: number;
}

const PRODUCTION_DENOMINATORS: WorkbookDenominators = {
  general: 38_736,
  special: 39_555,
  school: 12_546,
  dependent: 1_313,
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function failed(input: Omit<JurisdictionReferenceAcquisitionFailure, "kind">): JurisdictionReferenceAcquisitionFailure {
  return { kind: "FAILED", ...input };
}

function exactFinalUrl(response: Response, requestedUrl: string): string {
  // A real fetch always supplies `url`. The fallback exists only because the
  // platform Response constructor used by the explicit test seam has no URL.
  return response.url || requestedUrl;
}

function sourceFor(id: JurisdictionReferenceHttpSourceId) {
  return JURISDICTION_REFERENCE_HTTP_SOURCES.find((source) => source.id === id)!;
}

async function fetchExactSource(
  id: JurisdictionReferenceHttpSourceId,
  fetchImpl: typeof fetch,
  clock: FetchClock,
  priorReceipts: readonly JurisdictionReferenceSourceReceipt[],
): Promise<
  | { readonly kind: "ACQUIRED"; readonly bytes: Uint8Array; readonly receipt: JurisdictionReferenceSourceReceipt }
  | JurisdictionReferenceAcquisitionFailure
> {
  const source = sourceFor(id);
  let response: Response;
  try {
    response = await fetchImpl(source.url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: source.mediaType },
    });
  } catch (error) {
    return failed({
      stage: "FETCH",
      requestedUrl: source.url,
      finalUrl: null,
      httpStatus: null,
      retrievedAt: clock(),
      rawHash: null,
      byteCount: 0,
      detail: `${id}: ${error instanceof Error ? error.message : String(error)}`,
      receipts: priorReceipts,
    });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const retrievedAt = clock();
  const finalUrl = exactFinalUrl(response, source.url);
  const rawHash = sha256(bytes);
  const receipt: JurisdictionReferenceSourceReceipt = {
    sourceId: id,
    requestedUrl: source.url,
    finalUrl,
    httpStatus: response.status,
    retrievedAt,
    rawHash,
    byteCount: bytes.byteLength,
  };
  if (!response.ok) {
    return failed({
      stage: "HTTP",
      requestedUrl: source.url,
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      rawHash,
      byteCount: bytes.byteLength,
      detail: `${id}: HTTP ${response.status}; authoritative source bytes were not accepted.`,
      receipts: [...priorReceipts, receipt],
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return failed({
      stage: "REDIRECT",
      requestedUrl: source.url,
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      rawHash,
      byteCount: bytes.byteLength,
      detail: `${id}: final response URL is not parseable: ${finalUrl}`,
      receipts: [...priorReceipts, receipt],
    });
  }
  if (parsed.protocol !== "https:" || !source.finalHosts.includes(parsed.hostname as never)) {
    return failed({
      stage: "REDIRECT",
      requestedUrl: source.url,
      finalUrl,
      httpStatus: response.status,
      retrievedAt,
      rawHash,
      byteCount: bytes.byteLength,
      detail: `${id}: final HTTPS host ${parsed.hostname || "(missing)"} is not registered.`,
      receipts: [...priorReceipts, receipt],
    });
  }
  return { kind: "ACQUIRED", bytes, receipt };
}

export function jurisdictionReferenceZipMember(archive: Uint8Array, wanted: string): Uint8Array {
  const entry = readZipEntries(archive, { maxMemberBytes: 256 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 }).find(entry => entry.name === wanted);
  if (!entry) throw new Error(`ZIP_MEMBER_MISSING:${wanted}`);
  return entry.data;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function sharedStrings(workbook: Uint8Array): string[] {
  const xml = new TextDecoder().decode(jurisdictionReferenceZipMember(workbook, "xl/sharedStrings.xml"));
  const result: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const runs = match[1]!.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    result.push(runs.map((run) => unescapeXml(run.replace(/^<t[^>]*>/, "").replace(/<\/t>$/, ""))).join(""));
  }
  if (result.length === 0) throw new Error("XLSX_SHARED_STRINGS_EMPTY");
  return result;
}

function columnIndex(reference: string): number {
  let result = 0;
  for (const letter of reference.replace(/\d+/g, "")) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function worksheetRow(rowXml: string, strings: readonly string[]): string[] {
  const cells: string[] = [];
  let cursor = 0;
  while ((cursor = rowXml.indexOf("<c", cursor)) !== -1) {
    const after = rowXml[cursor + 2];
    if (after !== " " && after !== ">" && after !== "/") {
      cursor += 2;
      continue;
    }
    const tagEnd = rowXml.indexOf(">", cursor);
    if (tagEnd === -1) break;
    const selfClosing = rowXml[tagEnd - 1] === "/";
    const attrs = rowXml.slice(cursor + 2, selfClosing ? tagEnd - 1 : tagEnd);
    const reference = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
    if (selfClosing) {
      cursor = tagEnd + 1;
      continue;
    }
    const close = rowXml.indexOf("</c>", tagEnd);
    if (close === -1) break;
    const inner = rowXml.slice(tagEnd + 1, close);
    cursor = close + 4;
    if (!reference) continue;
    const scalar = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const inline = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
    const value = /\bt="s"/.test(attrs) && scalar !== undefined
      ? strings[Number(scalar)] ?? ""
      : inline !== undefined
        ? unescapeXml(inline)
        : scalar !== undefined
          ? unescapeXml(scalar)
          : "";
    cells[columnIndex(reference)] = value;
  }
  return cells;
}

function pick(header: readonly string[], ...names: readonly string[]): number {
  for (const name of names) {
    const index = header.findIndex((value) => (value ?? "").trim().toUpperCase() === name.toUpperCase());
    if (index !== -1) return index;
  }
  return -1;
}

type SheetKind = "GENERAL" | "SPECIAL" | "SCHOOL" | "DEPENDENT";

function governmentType(kind: SheetKind, raw: string): string {
  if (kind === "SPECIAL") return "SPECIAL DISTRICT";
  if (kind === "SCHOOL") return "SCHOOL DISTRICT";
  if (kind === "DEPENDENT") return "DEPENDENT SCHOOL SYSTEM";
  const normalized = raw.toUpperCase();
  if (normalized.includes("COUNTY")) return "COUNTY";
  if (normalized.includes("MUNICIPAL")) return "MUNICIPAL";
  if (normalized.includes("TOWNSHIP")) return "TOWNSHIP";
  throw new Error(`XLSX_GENERAL_PURPOSE_TYPE_UNKNOWN:${raw || "(blank)"}`);
}

function parseSheet(
  workbook: Uint8Array,
  strings: readonly string[],
  path: string,
  kind: SheetKind,
  expectedRows: number,
): CensusJurisdictionUnitInput[] {
  const xml = new TextDecoder().decode(jurisdictionReferenceZipMember(workbook, path));
  const rows = [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((match) => worksheetRow(match[0], strings));
  const [header, ...data] = rows;
  if (!header) throw new Error(`XLSX_SHEET_EMPTY:${path}`);
  const indexes = {
    name: pick(header, "UNIT_NAME", "NAME"),
    state: pick(header, "STATE", "STATE_CODE"),
    county: pick(header, "COUNTY_AREA_NAME", "COUNTY_NAME"),
    web: pick(header, "WEB_ADDRESS", "WEBSITE", "WEB"),
    pid: pick(header, "CENSUS_ID_PID6", "CENSUS_ID", "ID"),
    active: pick(header, "IS_ACTIVE", "ACTIVE_FLAG", "ACTIVE"),
    unitType: pick(header, "UNIT_TYPE"),
  };
  for (const field of ["name", "state", "county", "web", "pid", "active"] as const) {
    if (indexes[field] === -1) throw new Error(`XLSX_REQUIRED_COLUMN_MISSING:${path}:${field}`);
  }
  if (kind === "GENERAL" && indexes.unitType === -1) throw new Error(`XLSX_REQUIRED_COLUMN_MISSING:${path}:unitType`);
  if (data.length !== expectedRows) throw new Error(`XLSX_ROW_COUNT_MISMATCH:${path}:${data.length}:${expectedRows}`);
  const result = data.map((row) => ({
    name: (row[indexes.name] ?? "").trim(),
    govType: governmentType(kind, indexes.unitType === -1 ? "" : (row[indexes.unitType] ?? "").trim()),
    county: (row[indexes.county] ?? "").trim(),
    web: (row[indexes.web] ?? "").trim(),
    pid: (row[indexes.pid] ?? "").trim(),
    state: (row[indexes.state] ?? "").trim(),
    active: (row[indexes.active] ?? "").trim().toUpperCase() !== "N",
  }));
  if (result.some((row) => !row.name || !row.pid)) throw new Error(`XLSX_REQUIRED_VALUE_MISSING:${path}`);
  return result;
}

function parseCensusWorkbook(archive: Uint8Array, expected: WorkbookDenominators): {
  readonly workbook: Uint8Array;
  readonly censusUnits: readonly CensusJurisdictionUnitInput[];
  readonly dependentSchoolSystems: readonly CensusJurisdictionUnitInput[];
} {
  const workbook = jurisdictionReferenceZipMember(archive, "Govt_Units_2022_Final.xlsx");
  const strings = sharedStrings(workbook);
  const general = parseSheet(workbook, strings, "xl/worksheets/sheet1.xml", "GENERAL", expected.general);
  const special = parseSheet(workbook, strings, "xl/worksheets/sheet2.xml", "SPECIAL", expected.special);
  const school = parseSheet(workbook, strings, "xl/worksheets/sheet3.xml", "SCHOOL", expected.school);
  const dependent = parseSheet(workbook, strings, "xl/worksheets/sheet4.xml", "DEPENDENT", expected.dependent);
  const censusUnits = [...general, ...special, ...school];
  const expectedCensusUnits = expected.general + expected.special + expected.school;
  if (censusUnits.length !== expectedCensusUnits) {
    throw new Error(`CENSUS_GOVERNMENT_DENOMINATOR_MISMATCH:${censusUnits.length}:${expectedCensusUnits}`);
  }
  if (new Set(censusUnits.map((row) => row.pid)).size !== censusUnits.length) {
    throw new Error("CENSUS_GOVERNMENT_PID_NOT_UNIQUE");
  }
  return { workbook, censusUnits, dependentSchoolSystems: dependent };
}

async function acquireWith(
  fetchImpl: typeof fetch,
  clock: FetchClock,
  denominators: WorkbookDenominators,
): Promise<JurisdictionReferenceAcquisitionResult> {
  const receipts: JurisdictionReferenceSourceReceipt[] = [];
  const census = await fetchExactSource("census-government-units-2022", fetchImpl, clock, receipts);
  if (census.kind === "FAILED") return census;
  receipts.push(census.receipt);

  const guide = await fetchExactSource("az-sos-bulk-filing-guide-2026", fetchImpl, clock, receipts);
  if (guide.kind === "FAILED") return guide;
  receipts.push(guide.receipt);
  if (guide.bytes.byteLength < 5 || new TextDecoder().decode(guide.bytes.subarray(0, 5)) !== "%PDF-") {
    return failed({
      stage: "SOURCE_SHAPE",
      requestedUrl: guide.receipt.requestedUrl,
      finalUrl: guide.receipt.finalUrl,
      httpStatus: guide.receipt.httpStatus,
      retrievedAt: guide.receipt.retrievedAt,
      rawHash: guide.receipt.rawHash,
      byteCount: guide.receipt.byteCount,
      detail: "az-sos-bulk-filing-guide-2026: response is not a PDF; refusing an HTML/error-body substitution.",
      receipts,
    });
  }

  let parsed: ReturnType<typeof parseCensusWorkbook>;
  try {
    parsed = parseCensusWorkbook(census.bytes, denominators);
  } catch (error) {
    return failed({
      stage: error instanceof Error && error.message.startsWith("ZIP_") ? "ARCHIVE" : "WORKBOOK",
      requestedUrl: census.receipt.requestedUrl,
      finalUrl: census.receipt.finalUrl,
      httpStatus: census.receipt.httpStatus,
      retrievedAt: census.receipt.retrievedAt,
      rawHash: census.receipt.rawHash,
      byteCount: census.receipt.byteCount,
      detail: `census-government-units-2022: ${error instanceof Error ? error.message : String(error)}`,
      receipts,
    });
  }
  return {
    kind: "ACQUIRED",
    receipts,
    censusUnits: parsed.censusUnits,
    dependentSchoolSystems: parsed.dependentSchoolSystems,
    workbook: {
      member: "Govt_Units_2022_Final.xlsx",
      rawHash: sha256(parsed.workbook),
      byteCount: parsed.workbook.byteLength,
    },
  };
}

/** Production acquisition has no path or fixture override. */
export async function acquireJurisdictionReferenceInputs(): Promise<JurisdictionReferenceAcquisitionResult> {
  return acquireWith(fetchSource, () => new Date().toISOString(), PRODUCTION_DENOMINATORS);
}

/**
 * Explicit deterministic seam for unit tests only. Production callers use the
 * zero-argument function above and cannot redirect acquisition to repo files.
 */
export const jurisdictionReferenceAcquisitionTestOnly = Object.freeze({
  acquire(
    fetchImpl: typeof fetch,
    clock: FetchClock,
    denominators: WorkbookDenominators,
  ): Promise<JurisdictionReferenceAcquisitionResult> {
    return acquireWith(fetchImpl, clock, denominators);
  },
});
