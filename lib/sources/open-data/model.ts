import { echoSourceIdentity, ECHO_PROGRAM_ID_FIELDS } from "./echo-identity.ts";
/** Native source facts. Unresolved geography is retained, never treated as absence. */
export const OPEN_DATA_SOURCES = ["socrata-discovery", "epa-echo"] as const;
export type OpenDataSource = typeof OPEN_DATA_SOURCES[number];
export const SOCRATA_CATALOG = "https://api.us.socrata.com/api/catalog/v1";
export const ECHO_EXPORT = "https://echo.epa.gov/files/echodownloads/echo_exporter.zip";
export const OPEN_DATA_PARSER = "src-so/1";
export const OPEN_DATA_CLOCKS = { "socrata-discovery": 86400000, "epa-echo": 7 * 86400000 } as const;

export interface OpenDataFact {
  readonly id: string;
  readonly kind: "SOCRATA_DATASET" | "EPA_FACILITY";
  readonly sourceId: OpenDataSource;
  readonly nativeIds: Readonly<Record<string, string>>;
  readonly title: string;
  readonly state: string | null;
  readonly divisionIds: readonly string[];
  readonly bodyIds: readonly string[];
  readonly zip: string | null;
  readonly sourceUrl: string;
  readonly sourceOrg: string;
  readonly official: boolean;
  /** Null means the publisher did not supply a publication date. */
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
  readonly capturedAt: string;
  readonly description: string;
  readonly fields: Readonly<Record<string, unknown>>;
  /** Exact source cells: full during normalization, interpreted cells in reader artifacts, identity cells in the public API. */
  readonly sourceRow: Readonly<Record<string, unknown>>;
}
export interface OpenDataReport {
  readonly id: string;
  readonly state: string;
  readonly loaded: number;
  readonly joined: number;
  readonly unjoined: number;
}
export interface OpenDataProjection {
  readonly kind: "open-data";
  readonly sourceId: OpenDataSource;
  readonly records: readonly OpenDataFact[];
  readonly reports: readonly OpenDataReport[];
  /** Immutable reader slices become canonical through this source's promoted manifest. */
  readonly partitions?: readonly OpenDataPartitionRef[];
}
export interface OpenDataPartitionRef {
  readonly id:string;
  readonly key:string;
  readonly sha256:string;
  readonly count:number;
}
export const openDataScope = (source: OpenDataSource, partition = "national") => `${source}:${partition}`;
export const divisionPartition = (id: string) => `division:${id}`;
export const zipPartition = (zip: string) => `zip:${zip}`;

export function openDataFactIssue(row: OpenDataFact): string | null {
  if (!row || !OPEN_DATA_SOURCES.includes(row.sourceId) || !row.id || !row.title ||
      !row.sourceRow || !Object.keys(row.nativeIds ?? {}).length || !/^https:\/\//.test(row.sourceUrl ?? "") ||
      !Number.isFinite(Date.parse(row.capturedAt ?? "")) || !Array.isArray(row.divisionIds) || !Array.isArray(row.bodyIds)) return "Source identity or captured evidence is missing.";
  if (row.sourceId === "socrata-discovery" && (row.kind !== "SOCRATA_DATASET" || !row.nativeIds.socrata_id || !row.nativeIds.domain)) return "Dataset identity is missing.";
  if (row.sourceId === "epa-echo" && row.kind !== "EPA_FACILITY") return "Facility identity is missing.";
  if (row.kind === "SOCRATA_DATASET") {
    const resource = row.sourceRow.resource as Record<string,unknown> | undefined;
    const metadata = row.sourceRow.metadata as Record<string,unknown> | undefined;
    if (String(resource?.id).trim() !== row.nativeIds.socrata_id || String(metadata?.domain).trim().toLowerCase() !== row.nativeIds.domain || String(resource?.name).trim() !== row.title) return "Dataset values differ from the captured source row.";
  } else {
    const identity=echoSourceIdentity(row.sourceRow);
    if(!identity||row.id!==`epa-echo:${identity.key}`||Object.entries(identity.identifiers).some(([key,value])=>row.nativeIds[key]!==value)||
      String(row.sourceRow.FAC_NAME??row.sourceRow.FacName).trim()!==row.title)return "Facility values differ from the captured source row.";
  }
  if ([row.publishedAt, row.updatedAt].some(at => at !== null && !Number.isFinite(Date.parse(at)))) return "Publisher date is invalid.";
  if (row.zip !== null && !/^\d{5}$/.test(row.zip)) return "Source ZIP is invalid.";
  return null;
}
/** The public API retains only the native identity fields needed by the card's source check. */
export function openDataReaderRecord(row:OpenDataFact):OpenDataFact {
  return {...row,sourceRow:row.kind==="SOCRATA_DATASET"?
    {resource:{id:row.nativeIds.socrata_id,name:row.title},metadata:{domain:row.nativeIds.domain}}:
    {REGISTRY_ID:row.sourceRow.REGISTRY_ID??row.sourceRow.RegistryID??"",FAC_NAME:row.sourceRow.FAC_NAME??row.sourceRow.FacName,
      DFR_URL:row.sourceRow.DFR_URL,...Object.fromEntries(ECHO_PROGRAM_ID_FIELDS.filter(key=>row.sourceRow[key]).map(key=>[key,row.sourceRow[key]]))}};
}
