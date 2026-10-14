import { createHash } from "node:crypto";
import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_ELECTION_DAY, GOOGLE_CIVIC_STATES } from "./targets.ts";

export type CivicJson = Record<string, unknown>;
interface CivicAttribution {
  sourceUrl: string;
  sourceOrg: string;
  official: boolean;
  /** The API does not publish a publication timestamp. Never use electionDay or retrieval time as one. */
  publishedAt: string | null;
  collectedAt: string;
}
interface CivicFact {
  id: string;
  kind: "ELECTION" | "CONTEST" | "POLLING_LOCATION" | "EARLY_VOTE_SITE" | "DROP_OFF_LOCATION";
  electionId: string;
  state: string | null;
  ocdId: string | null;
  joinedDivisionId: string | null;
  /** All published fields, including candidates and referendum wording, preserved verbatim. */
  value: CivicJson;
  sources: CivicAttribution[];
}
export interface CivicLookup {
  formatVersion: 1;
  kind: "LOOKUP";
  electionId: string;
  state: string | null;
  checkedAt: string;
  status: "AVAILABLE" | "NO_DATA" | "OUTAGE";
  reason: string | null;
  rows: CivicFact[];
  counts: { loaded: number; joined: number; unjoined: number };
}
export interface CivicStateCoverage {
  state: string;
  governments: number;
  addresses: number;
  checked: number;
  unavailable: number;
  withoutAddress: number;
  loaded: number;
  joined: number;
  unjoined: number;
  reason: string | null;
}
interface CivicCatalog {
  formatVersion: 1;
  kind: "CATALOG" | "STATE";
  checkedAt: string;
  rows: CivicFact[];
  coverage: CivicStateCoverage[];
}
export type CivicProjection = CivicLookup | CivicCatalog;
const civicObject = (v: unknown): CivicJson => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Google Civic returned an invalid object.");
  return v as CivicJson;
};
const string = (v: unknown) => typeof v === "string" ? v : "";
function civicArray(v: unknown): CivicJson[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("Google Civic returned an invalid row list.");
  return v.map(civicObject);
}
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function civicSources(row: CivicJson, checkedAt: string, route: string): CivicAttribution[] {
  const sources = civicArray(row.sources);
  return (sources.length ? sources : [{ name: "Google Civic Information", official: false }]).map(source => ({
    sourceUrl: `${GOOGLE_CIVIC_API}${route}`,
    sourceOrg: `${string(source.name) || "Google Civic Information"} via Google Civic Information`,
    official: source.official === true,
    publishedAt: null,
    collectedAt: checkedAt,
  }));
}
export function civicElectionRows(raw: string, checkedAt: string, knownIds: ReadonlySet<string>): CivicFact[] {
  const data = civicObject(JSON.parse(raw));
  const rows = civicArray(data.elections).filter(row => row.electionDay === GOOGLE_CIVIC_ELECTION_DAY);
  return rows.map(row => {
    if (!string(row.id) || !string(row.name) || !string(row.ocdDivisionId).startsWith("ocd-division/")) throw new Error("Google Civic election identity is invalid.");
    const ocdId = string(row.ocdDivisionId);
    return { id: `google-civic:election:${row.id}`, kind: "ELECTION", electionId: string(row.id), state: null,
      ocdId, joinedDivisionId: knownIds.has(ocdId) ? ocdId : null, value: row, sources: civicSources(row, checkedAt, "elections") };
  });
}
export function civicLookupFromRaw(raw: string, electionId: string, checkedAt: string, knownIds: ReadonlySet<string> = new Set()): CivicLookup {
  const data = civicObject(JSON.parse(raw)), election = civicObject(data.election);
  if (election.id !== electionId || election.electionDay !== GOOGLE_CIVIC_ELECTION_DAY) throw new Error("Google Civic returned a different election.");
  const normalized = civicObject(data.normalizedInput);
  const state = string(normalized.state).toUpperCase();
  if (!GOOGLE_CIVIC_STATES.includes(state)) throw new Error("Google Civic did not resolve a US state or territory.");
  const rows: CivicFact[] = [];
  const occurrences = new Map<string, number>();
  const groups = [["contests", "CONTEST"], ["pollingLocations", "POLLING_LOCATION"], ["earlyVoteSites", "EARLY_VOTE_SITE"], ["dropOffLocations", "DROP_OFF_LOCATION"]] as const;
  for (const [field, kind] of groups) for (const row of civicArray(data[field])) {
    const division = row.district === undefined ? null : string(civicObject(row.district).id) || null;
    const ocdId = division?.startsWith("ocd-division/") ? division : null;
    // The API supplies no contest/site id. This identifies a saved observation, never a native government identity.
    const base = `google-civic:${electionId}:${state}:${kind}:${digest(row)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    rows.push({ id: `${base}:${occurrence}`, kind, electionId, state, ocdId,
      joinedDivisionId: ocdId !== null && knownIds.has(ocdId) ? ocdId : null,
      value: row, sources: civicSources(row, checkedAt, "voterinfo") });
  }
  const joined = rows.filter(row => row.joinedDivisionId !== null).length;
  return { formatVersion: 1, kind: "LOOKUP", electionId, state, checkedAt, status: rows.length ? "AVAILABLE" : "NO_DATA",
    reason: rows.length ? null : "Google Civic has not supplied contests or voting sites for this address.", rows,
    counts: { loaded: rows.length, joined, unjoined: rows.length - joined } };
}
export function unavailableCivicLookup(reason: string, checkedAt: string, electionId = ""): CivicLookup {
  return { formatVersion: 1, kind: "LOOKUP", electionId, state: null, checkedAt, status: "OUTAGE", reason, rows: [], counts: { loaded: 0, joined: 0, unjoined: 0 } };
}
export function assertCivicProjection(value: CivicProjection): void {
  if (value.formatVersion !== 1 || !["LOOKUP", "CATALOG", "STATE"].includes(value.kind) || !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.rows)) throw new Error("Invalid Google Civic projection.");
  if (new Set(value.rows.map(row => row.id)).size !== value.rows.length || value.rows.some(row => !row.id || !row.electionId || !row.sources.length || row.sources.some(source => !source.sourceOrg || !source.sourceUrl.startsWith(GOOGLE_CIVIC_API) || !Number.isFinite(Date.parse(source.collectedAt))))) throw new Error("Google Civic fact identity or attribution is missing.");
}
