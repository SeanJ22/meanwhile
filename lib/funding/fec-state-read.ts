import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readPublishedArraySlice, type PublishedArraySlice } from "../civic-data/published-array-slice.ts";
import { fecFundingScope } from "../civic-data/fec-state-scope.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import type { FundingCandidate, FundingSnapshot, SecondHopCommittee } from "./types.ts";

export interface FecStateReadOptions extends PromotedCivicDataReadOptions {
  readonly targetKeys?: readonly string[];
  readonly districts?: readonly string[];
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function validSnapshot(value: FundingSnapshot, version: string | null): void {
  if (!value || value.formatVersion !== 1 || !Array.isArray(value.candidates) || !Array.isArray(value.absences) ||
    value.candidates.some(row => !row || !Array.isArray(row.targetKeys) || !Array.isArray(row.topContributions)))
    throw new Error(`FEC projection ${version} does not satisfy FundingSnapshot.`);
}
function select(snapshot: FundingSnapshot, state: string, options: FecStateReadOptions): FundingSnapshot {
  validSnapshot(snapshot, null);
  if (snapshot.candidates.some(row => row.state !== state)) throw new Error("FEC_STATE_BOUNDARY_MISMATCH");
  const candidates = snapshot.candidates.filter(row => options.targetKeys !== undefined
    ? row.targetKeys.some(key => options.targetKeys!.includes(key)) || options.targetKeys.includes(`fec:${row.fecCandidateId}`)
    : options.districts !== undefined ? row.office === "S" || options.districts.includes(row.district ?? "") : true);
  const books = new Set(candidates.flatMap(row => row.topContributions.flatMap(receipt => receipt.contributorCommitteeId ?? [])));
  const keys = new Set([...candidates.map(row => row.fecCandidateId), ...books]);
  return { ...snapshot, candidates, absences: [], secondHop: snapshot.secondHop?.filter(row => books.has(row.committeeId)),
    refreshAttempts: Object.fromEntries(Object.entries(snapshot.refreshAttempts ?? {}).filter(([key]) => keys.has(key))) };
}

/** Select only a state's exact native subjects before immutable payload parts
 * cross the connection. The original version/hash remains its provenance. */
async function readSlice(scope: string, state: string, options: FecStateReadOptions): Promise<(CivicDataReadResult<FundingSnapshot> & { readonly sourceInput: PublishedArraySlice<unknown>["input"] }) | null> {
  const pattern = (keys: readonly string[]) => keys.length ? `^(?:${keys.map(escape).join("|")})$` : "a^";
  const selectors = options.targetKeys !== undefined ? [
    { path: ["targetKeys", "*"], pattern: pattern(options.targetKeys) },
    { path: ["fecCandidateId"], pattern: pattern(options.targetKeys.flatMap(key => /^fec:([HS]\d[A-Z]{2}\d{5})$/.exec(key)?.[1] ?? [])) },
  ] : options.districts !== undefined ? [{ path: ["office"], pattern: "^S$" }, { path: ["district"], pattern: pattern(options.districts) }] : undefined;
  const native = await readPublishedArraySlice<FundingCandidate>({ recordClass: "FEC_FUNDING", scope,
    path: ["candidates"], statePath: ["state"], statePattern: `^${state}$`, selectors,
    ...(selectors ? { requiredSelectors: [{ path: ["state"], pattern: `^${state}$` }] } : {}) });
  if (!native) return null;
  const sameVersion = <T>(read: PublishedArraySlice<T> | null): PublishedArraySlice<T> | null => {
    if (read && (read.input.versionId !== native.input.versionId || read.input.readModelSha256 !== native.input.readModelSha256)) throw new Error("FEC_SOURCE_VERSION_MOVED");
    return read;
  };
  const header = sameVersion(await readPublishedArraySlice<Omit<FundingSnapshot, "candidates" | "absences" | "secondHop" | "refreshAttempts">>({ recordClass: "FEC_FUNDING", scope,
    path: [], statePath: [], statePattern: ".*", objectRecord: true, omitKeys: ["candidates", "absences", "secondHop", "refreshAttempts"] }));
  if (!header?.records[0]) throw new Error("FEC_SNAPSHOT_HEADER_UNREADABLE");
  const candidates = native.records;
  validSnapshot({ ...header.records[0], candidates: [...candidates], absences: [] }, native.input.versionId);
  const wanted = [...new Set(candidates.flatMap(row => row.topContributions.flatMap(receipt => receipt.contributorCommitteeId ?? [])))];
  const secondHop = wanted.length ? sameVersion(await readPublishedArraySlice<SecondHopCommittee>({ recordClass: "FEC_FUNDING", scope, path: ["secondHop"], statePath: ["committeeId"], statePattern: pattern(wanted) })) : null;
  const attempts = sameVersion(await readPublishedArraySlice<Record<string, string>>({ recordClass: "FEC_FUNDING", scope,
    path: ["refreshAttempts"], statePath: [], statePattern: ".*", objectRecord: true, keepKeys: [...candidates.map(row => row.fecCandidateId), ...wanted] }));
  const value: FundingSnapshot = { ...header.records[0], candidates: [...candidates], absences: [],
    secondHop: (secondHop?.records ?? []).filter(row => (row.cycle ?? header.records[0].cycle) === header.records[0].cycle),
    refreshAttempts: attempts?.records[0], coverage: { discoveryRoute: header.records[0].coverage?.discoveryRoute ?? "bulk", countsByState: { [state]: header.records[0].coverage?.countsByState[state] ?? candidates.length } } };
  validSnapshot(value, native.input.versionId);
  if (value.candidates.some(row => row.state !== state)) throw new Error("FEC_STATE_BOUNDARY_MISMATCH");
  const metadata = { recordClass: "FEC_FUNDING" as const, scope, sourceId: native.sourceId, version: native.sourceVersion, versionId: native.input.versionId,
    lastKnownGoodVersionId: native.input.versionId, retrievedAt: native.retrievedAt, sourceThrough: native.sourceThrough, promotedAt: native.input.promotedAt, stale: "UNKNOWN" as const, staleAt: null };
  return { kind: "PROMOTED", value, metadata, sourceInput: native.input, projection: { key: `FEC_FUNDING:${scope}`, recordClass: "FEC_FUNDING", scope,
    sourceId: native.sourceId, versionId: native.input.versionId, lastKnownGoodVersionId: native.input.versionId, promotedAt: native.input.promotedAt, receipt: native.receipt, payload: value } };
}

export async function readFecStateSnapshot(state: string, options: FecStateReadOptions = {}): Promise<CivicDataReadResult<FundingSnapshot> & { readonly sourceInput?: PublishedArraySlice<unknown>["input"] }> {
  const selected = requireRegistryState(state), scope = fecFundingScope(selected);
  const sql = options.store ? options.store instanceof PostgresRoutineDataStore : readerDatabaseQuery() !== null;
  if (sql && (options.targetKeys !== undefined || options.districts !== undefined)) {
    const current = await readSlice(scope, selected, options); if (current) return current;
    const legacy = await readSlice("federal-supported", selected, options); if (legacy) return legacy;
  }
  const current = await readPromotedCivicData<FundingSnapshot>("FEC_FUNDING", scope, options);
  if (current.kind === "PROMOTED") { validSnapshot(current.value, current.metadata.versionId); return { ...current, value: select(current.value, selected, options) }; }
  if (current.kind !== "NOT_RECORDED" || !sql) return current;
  return await readSlice("federal-supported", selected, options) ?? current;
}
