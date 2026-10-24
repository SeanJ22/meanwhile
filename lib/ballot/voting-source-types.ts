import type { SiteKind, VotingOfficeContact, VotingRule, VotingSite, VotingSource, VotingModel, VotingPublication, VotingBoundary } from "./voting-sites.ts";

export type VotingDoorShape = "file" | "list-page" | "address-lookup" | "identity-locked-lookup" | "county-directory" | "vendor-platform" | "map-service" | "json";
export type VotingPlatform = "voterfocus" | "voterview" | "where-to-vote" | "civix" | "power-bi";
export const isVotingSiteKind = (kind: VotingSourceDoor["covers"][number]): kind is SiteKind => kind !== "CANDIDATE_LIST" && kind !== "BALLOT_MEASURES";
export type VotingColumn = "id" | "name" | "address" | "room" | "kind" | "date" | "days" | "hours" | "precinct" | "town" | "countyName" | "countyFips" | "countySubdivisionGeoid" | "ward" | "districtOcdIds" | "tribalNation" | "reservation" | "aiannhGeoid" | "locationNotes" | "accessibilityNotes" | "rules" | "phone" | "email" | "officeName" | "officeAddress" | "lastUpdated" | "election" | "lat" | "lng";
export interface VotingDoorScope {
  state: string;
  ocdId: string;
  name: string;
  countyFips?: string;
  countySubdivisionGeoid?: string;
  population?: number;
}
export interface VotingExtraction {
  format?: "csv" | "tsv" | "xlsx" | "pdf" | "html" | "json";
  /** Exact public archive member; evidence and citations retain the publisher's archive URL. */
  archiveMember?: string;
  /** Column names (or 0-based indexes for a headerless file), joined in order. */
  columns?: Partial<Record<VotingColumn, string | string[]>>;
  headerRow?: number;
  headers?: string[];
  delimiter?: string;
  sheet?: string;
  /** Zero-based index among the source page's tables, for separately scoped county tables. */
  tableIndex?: number;
  jsonPath?: string;
  kind?: SiteKind;
  /** PDF column left edges in points; preserves wrapped text in each cell. */
  pdfColumns?: { name: string; x: number }[];
  /** A new record starts when this column matches. Other lines continue it. */
  pdfRecordStart?: { column: string; pattern: string };
  pdfCenteredRecords?: boolean;
  /** Repeated PDF blocks identified by their printed column headings and following section heading. */
  pdfBlocks?: { heading: string; end: string; columns: Record<string, string>; pageExclude?: string };
  records?: { pattern: string; group?: number; jsonString?: boolean; fields: Record<string, { pattern: string; group: number }>;
    /** Scope child locations to their published county/parish section and inherit its printed fields. */
    within?: { pattern: string; group?: number; fields?: Record<string, { pattern: string; group: number }> } };
  splitRows?: { column: string; pattern: string; alignedColumns?: string[]; alignedPattern?: string };
  filters?: Record<string, string>;
  /** The current official map's ArcGIS definitionExpression, applied to IDs and every batch. */
  where?: string;
  /** Regex capture groups applied to a named input column; data configuration only. */
  transforms?: Partial<Record<VotingColumn, { column: string; pattern: string; group: number }>>;
  pdfTop?: number;
  pdfBottom?: number;
  dataUrl?: string;
  dataMethod?: "GET" | "POST";
  /** Public JSON request captured from the official page, without credentials. */
  dataBody?: unknown;
  requestHeaders?: Record<string, string>;
  /** Address-only input names documented by the official portal. */
  addressFields?: Partial<Record<"address" | "streetNumber" | "street" | "city" | "state" | "zip", string>>;
  textAssertions?: string[];
  templates?: Partial<Record<VotingColumn, string>>;
  constants?: Partial<Record<VotingColumn, string>>;
}
export interface VotingSourceDoor {
  id: string;
  publisher: string;
  url: string;
  shape: VotingDoorShape;
  covers: (SiteKind | "CANDIDATE_LIST" | "BALLOT_MEASURES")[];
  scope: VotingDoorScope;
  electionDate: string;
  electionPageUrl: string;
  electionAssociationVerified?: boolean;
  scopeUnresolved?: boolean;
  /** The saved official linking page is authority for vendor-hosted routes. */
  officialLinkingPage?: import("../civic-data/source-authority.ts").OfficialLinkingPage;
  model?: VotingModel;
  matchingUnit?: "COUNTY" | "TOWN" | "WARD" | "PRECINCT";
  publication?: VotingPublication;
  delegation?: "county" | "town";
  boundaries?: VotingBoundary[];
  boundaryLayer?: boolean;
  changeNotices?: VotingChangeNotice[];
  platform?: VotingPlatform;
  extraction?: VotingExtraction;
  title?: string;
  fileUpdatedAt?: string;
  publicationMessage?: string;
  office?: VotingOfficeContact;
  rules?: VotingRule[];
  access?: { status: "open" | "robots" | "bot-wall" | "identity-locked" | "unreachable"; detail?: string; checkedAt?: string };
  discoveredFrom?: string;
  /** Older file URLs replaced once this source's current-election sites have published. */
  supersedes?: string[];
}
export interface VotingSourceBlank {
  id: string;
  doorId: string;
  scope: VotingDoorScope;
  owed: string;
  tried: string[];
  next: string[];
  status: "open";
  reason: "access" | "unpublished" | "extraction" | "earlier-election" | "missing-sites" | "geocode";
}
export interface VotingSourceAttempt { url: string; route: "direct" | "browser-ua"; outcome: string; }
interface VotingSourceContact { scope: VotingDoorScope; office: VotingOfficeContact; source: VotingSource }
export interface VotingSourceRead {
  doorId: string;
  /** Configured sections acquired together from the same source. */
  doorIds?: string[];
  contacts?: VotingSourceContact[];
  sites: VotingSite[];
  boundaries?: VotingBoundary[];
  office?: VotingOfficeContact;
  rules: VotingRule[];
  sources: VotingSource[];
  blanks: VotingSourceBlank[];
  attempts: VotingSourceAttempt[];
  rawBodies: import("./voting-source-fetch.ts").VotingCapture[];
  fileTitle?: string;
  fileUpdatedAt?: string;
  publicationMessage?: string;
}
export interface VotingSourceRuntime {
  captureCache?: Map<string, Promise<import("./voting-source-fetch.ts").VotingCapture[]>>;
  discoverySeen?: Set<string>;
  fetch: typeof fetch;
  deadlineMs?: number;
  onDiscoveredDoor?: (door: VotingSourceDoor, captures: { url: string; contentType: string; bytes: Uint8Array }[]) => Promise<void>;
  onDiscoveredSource?: (source: import("./voting-source-discovery.ts").ClassifiedVotingSource) => Promise<void>;
  resolveAiannhGeoid?: (tribalNation: string, reservation: string, state: string) => string | null;
  resolveCountyFips?: (countyName: string, state: string) => string | null;
  resolveScope?: (label: string, url: string, parent: VotingDoorScope) => VotingDoorScope | null;
  now?: () => string;
  /** The established browser-UA rung only; it must not solve a challenge. */
  browserFetch?: typeof fetch;
  geocode?: (address: string) => Promise<{ lat: number; lng: number } | null>;
}
export interface VotingChangeNotice {
  publishedAt: string;
  source: VotingSource;
  match: { id?: string; precinct?: string; name?: string };
  changes: Partial<Omit<VotingSite, "id" | "sources">>;
}
