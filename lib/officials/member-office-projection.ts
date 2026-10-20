import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readPublishedArraySlice } from "../civic-data/published-array-slice.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import { memberOfficeScope } from "./member-office-scope.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import type { MemberOfficeRecord } from "./member-offices.ts";

const LEGACY_SCOPE = "US:state-legislator-member-offices";

/** Old evidence remains readable by state while newly acquired offices use state pointers. */
async function legacyOffices(state: string, options: PromotedCivicDataReadOptions): Promise<readonly MemberOfficeRecord[]> {
  if (options.store && !(options.store instanceof PostgresRoutineDataStore) && !("readPromotedEntry" in options.store)) return [];
  const code = requireRegistryState(state).toLowerCase();
  const native = code === "az" ? "az-legislature:" : code === "nh" ? "nh-general-court:" : code === "nj" ? "nj-legislature:" : "";
  const held = await readPublishedArraySlice<MemberOfficeRecord>({ recordClass: "CURATED_READER_RECORD", scope: LEGACY_SCOPE,
    path: ["records"], statePath: [], statePattern: "", selectors: [
      { path: ["sourceUrl"], pattern: `/(?:data/${code}/|${code}\\.(?:csv|zip|json)(?:[?#]|$)|state:${code}(?:/|$))` },
      { path: ["office", "state"], pattern: `^${code.toUpperCase()}$` },
      { path: ["officeholderId"], pattern: `^(?:${native ? native + "|" : ""}plural:${code}:)` },
    ] });
  return held?.records ?? [];
}

export async function readMemberOfficeProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  return readPromotedCivicData<CuratedReaderProjection>("CURATED_READER_RECORD", memberOfficeScope(state), options);
}

/** The two independent authorities are combined as records, without relabeling a legacy receipt as a new state publication. */
export async function readMemberOfficeRecords(state: string, options: PromotedCivicDataReadOptions = {}): Promise<readonly MemberOfficeRecord[]> {
  const [read, legacy] = await Promise.all([readMemberOfficeProjection(state, options), legacyOffices(state, options)]);
  if (read.kind === "STORE_UNREACHABLE") throw new Error(read.detail);
  const current = read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value.records as unknown as readonly MemberOfficeRecord[] : [];
  return [...new Map([...legacy, ...current].map(row => [row.id, row])).values()];
}
