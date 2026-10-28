import { memberOfficeStateScope, readMemberOfficeRows, type MemberOfficeSlice } from "../officials/member-office-data.ts";
import { selectedRegistryStates } from "../registry/runtime-read-model.ts";
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { validateOnce } from "./validated-once.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";

import { ballotNavigationScope } from "./ballot-navigation-scope.ts";
import { readStateAuthorityProjection } from "./state-reader.ts";
import { ballotNavigationFor } from "../ballot/navigation.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { readerRecordsWithOwnerChoices } from "../facts/owner-flags.ts";
import { factReader } from "../facts/db.ts";
import { ballotNavigationSourceCheckOverlay } from "./ballot-navigation-source-checks.ts";
import { readPublishedSourceChecks } from "./source-checks.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import type { RoutineDataStore } from "./store.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

export const CURATED_READER_CONTRACT_IDS = [
  "official-filings",
  "ballot-navigation",
  "stances",
  "campaign-sites",
  "member-offices",
  "venue-resolutions",
  "meeting-body-crosswalk",
] as const;
export type CuratedReaderContractId = (typeof CURATED_READER_CONTRACT_IDS)[number];

const BALLOT_NAVIGATION = requiredManualProductionContract("ballot-navigation");

export interface BallotNavigationProjectionRecord {
  readonly id: string;
  readonly kind: "POLLING_PLACE_LINK" | "REGISTRATION_LINK";
  readonly value: Readonly<Record<string, unknown>>;
}

export interface CampaignSiteProjectionRecord {
  readonly id: string;
  readonly officeholderId: string;
  readonly site: Readonly<Record<string, unknown>>;
}

const states = new Map<CuratedReaderContractId, CivicDataReadResult<CuratedReaderProjection>>();
const selectedStates = new WeakMap<object, Map<CuratedReaderContractId, CivicDataReadResult<CuratedReaderProjection>>>();
function readerStates() {
  const selection = currentReaderSelection();
  if (!selection) return states;
  let held = selectedStates.get(selection);
  if (!held) { held = new Map(); selectedStates.set(selection, held); }
  return held;
}


function initial(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  const contract = requiredManualProductionContract(id);
  return civicDataReadNotInitialized(
    contract.recordClass,
    contract.scope,
    `The ${id} canonical pointer has not been read for this process.`,
  );
}

function validate(id: CuratedReaderContractId, value: CuratedReaderProjection, version: string): void {
  if (value?.kind !== id || !Array.isArray(value.records) || value.records.length === 0) {
    throw new Error(`${id} projection ${version} has the wrong family or no records.`);
  }
  const keys = value.records.map((record) => record?.id);
  if (keys.some((key) => typeof key !== "string" || key.length === 0) || new Set(keys).size !== keys.length) {
    throw new Error(`${id} projection ${version} has an empty or duplicate record id.`);
  }
}

export async function readCuratedReaderProjection(
  id: CuratedReaderContractId,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  if (id === "member-offices") {
    const selected = selectedRegistryStates();
    if (selected.length !== 1) throw new Error("Member-office reads require one selected state.");
    return readMemberOfficeStateProjection(selected[0], options);
  }
  const contract = requiredManualProductionContract(id);
  let result = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope, options);
  if (result.kind === "PROMOTED") validate(id, result.value, result.metadata.versionId ?? "unknown");
  if (result.kind === "PROMOTED") result = { ...result,value:{...result.value,
    records:await readerRecordsWithOwnerChoices(factReader(),id,result.value.records)} };
  readerStates().set(id, result);
  return result;
}

/** Exact keyed office rows. A pre-partition national edition contributes only this state's members. */
export async function readMemberOfficeStateProjection(state: string, options: PromotedCivicDataReadOptions = {}, members: readonly string[] = []): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  const scope=memberOfficeStateScope(state), contract=requiredManualProductionContract("member-offices");
  const store=options.store as Partial<Pick<RoutineDataStore,"readMemberOfficeSlice">> | undefined;
  const query=store?.readMemberOfficeSlice ? null : readerQuery();
  let slice: MemberOfficeSlice | null;
  try {
    if(store?.readMemberOfficeSlice)slice=await store.readMemberOfficeSlice(state,members);
    else if(query)slice=await readMemberOfficeRows(async(text,params)=>(await query([{text,params:params??[]}]))[0]??[],state,members);
    else return civicDataReadNotInitialized(contract.recordClass,scope,"The member-office state reader has no database connection.");
  } catch(error) { return {kind:"STORE_UNREACHABLE",value:null,metadata:{recordClass:contract.recordClass,scope,sourceId:null,version:null,versionId:null,lastKnownGoodVersionId:null,sourceThrough:null,retrievedAt:null,promotedAt:null,stale:"UNKNOWN",staleAt:null},code:"STORE_READ_FAILED",detail:sanitizedErrorDiagnostic(error)}; }
  if(!slice)return {kind:"NOT_RECORDED",value:null,metadata:{recordClass:contract.recordClass,scope,sourceId:null,version:null,versionId:null,lastKnownGoodVersionId:null,sourceThrough:null,retrievedAt:null,promotedAt:null,stale:"UNKNOWN",staleAt:null},detail:`No held offices are recorded for ${state}.`};
  const payload={...slice.header,kind:"member-offices",records:slice.records} as unknown as CuratedReaderProjection;
  let result: CivicDataReadResult<CuratedReaderProjection>;
  if(slice.scope===scope && !members.length) {
    result=await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass,scope,{now:options.now,maxAgeMs:options.maxAgeMs,edge:{kind:"PROMOTED",
      projection:{key:`${contract.recordClass}:${scope}`,recordClass:contract.recordClass,scope,sourceId:slice.sourceId,versionId:slice.versionId,lastKnownGoodVersionId:slice.versionId,promotedAt:slice.promotedAt,payload,receipt:slice.receipt,...(slice.latestConfirmation?{latestConfirmation:slice.latestConfirmation}:{})},
      attested:{recordClass:contract.recordClass,scope,versionId:slice.versionId,payloadSha256:slice.normalization.normalizedHash!,retrievedAt:slice.retrievedAt,staleAtRetrieval:slice.staleAtRetrieval===true,version:slice.version,sourceThrough:slice.sourceThrough}}});
  } else {
    const retrievedAt=[slice.retrievedAt,...(slice.latestConfirmation?[slice.latestConfirmation.retrieval.retrievedAt]:[])].sort().at(-1)!;
    const staleAt=options.maxAgeMs===undefined?null:new Date(Date.parse(retrievedAt)+options.maxAgeMs).toISOString();
    result={kind:"BOOTSTRAP",value:payload,metadata:{recordClass:contract.recordClass,scope:slice.scope,sourceId:slice.sourceId,version:slice.version,versionId:slice.versionId,lastKnownGoodVersionId:slice.versionId,sourceThrough:slice.sourceThrough,retrievedAt,promotedAt:slice.promotedAt,stale:slice.staleAtRetrieval||staleAt && Date.parse(options.now??new Date().toISOString())>Date.parse(staleAt)?"STALE":"CURRENT",staleAt},detail:`Exact ${state} member offices selected from the prior GOOD edition; source reviews remain bound to their original version.`};
  }
  if(result.kind==="PROMOTED" || result.kind==="BOOTSTRAP")result={...result,value:{...result.value,records:await readerRecordsWithOwnerChoices(factReader(),"member-offices",result.value.records)}};
  if(!members.length)readerStates().set("member-offices",result);
  return result;
}

/** One state's navigation records, with Sean's choices applied. A request reads its state pointer; an injected store reads that pointer directly. */
export async function readBallotNavigationProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  const scope = ballotNavigationScope(state);
  const result = Object.keys(options).length
    ? await readPromotedCivicData<CuratedReaderProjection>(BALLOT_NAVIGATION.recordClass, scope, options)
    : (await readStateAuthorityProjection<CuratedReaderProjection>("ballot-navigation", state)).result;
  if (result.kind !== "PROMOTED") return result;
  // Validate the government's own version, which may become empty after an owner removal.
  ballotNavigationFor(state, result.value, result.metadata.versionId!, []);
  let value = result.value;
  const keys = [...new Set(value.records.flatMap(record => {
    const field = record.value as { sourceKey?: unknown } | undefined;
    return record.kind === "ELECTION_FIELD" && typeof field?.sourceKey === "string" ? [field.sourceKey] : [];
  }))];
  if (keys.length) try {
    const store = options.store as Partial<Pick<RoutineDataStore, "readSourceChecks">> | undefined;
    const query = !Object.keys(options).length ? readerQuery() : null;
    const checks = store?.readSourceChecks ? await store.readSourceChecks("CURATED_READER_RECORD", scope, keys)
      : query ? await readPublishedSourceChecks(async (text, params) => (await query([{ text, params }]))[0] ?? [], "CURATED_READER_RECORD", scope, keys) : [];
    value = ballotNavigationSourceCheckOverlay(value, checks);
  } catch (error) {
    console.error("BALLOT_NAVIGATION_SOURCE_CHECK_ERROR=" + JSON.stringify({ state, detail: sanitizedErrorDiagnostic(error) }));
  }
  return { ...result, value: { ...value, records: await readerRecordsWithOwnerChoices(factReader(), "ballot-navigation", value.records) } };
}

export async function refreshCuratedReaderProjection(
  id: CuratedReaderContractId,
  options: PromotedCivicDataReadOptions = {},
): Promise<string> {
  const result = await readCuratedReaderProjection(id, options);
  if (result.kind === "NOT_RECORDED") throw new Error(`The ${id} store answered without a canonical promoted projection.`);
  const version = promotedVersionOrThrow(result);
  if (version === null) throw new Error(`The ${id} canonical projection was not promoted.`);
  return version;
}

/** Primes from a validated edge serving copy, with no database read; its state is BOOTSTRAP. */
export function primeCuratedReaderProjection(
  id: CuratedReaderContractId,
  value: CuratedReaderProjection,
  versionId: string,
): void {
  validateOnce(id, value, versionId, () => validate(id, value, versionId));
  storeCuratedReaderProjection(id,value,versionId);
}

function storeCuratedReaderProjection(id:CuratedReaderContractId,value:CuratedReaderProjection,versionId:string):void {
  const contract = requiredManualProductionContract(id);
  readerStates().set(id, {
    kind: "BOOTSTRAP",
    value,
    metadata: {
      recordClass: contract.recordClass,
      scope: contract.scope,
      sourceId: contract.sourceId ?? null,
      version: null,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "CURRENT",
      staleAt: null,
    },
    detail: `Served from the ${id} edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
  });
}

/** Apply the owner's edge choices before the request primes its serving projection. */
export async function primeCuratedReaderProjectionWithOwnerChoices(id: CuratedReaderContractId,value:CuratedReaderProjection,versionId:string):Promise<void> {
  const records=await readerRecordsWithOwnerChoices(null,id,value.records);
  // Validate the government's original projection, which may become empty after an owner removal.
  validateOnce(id,value,versionId,()=>validate(id,value,versionId));
  storeCuratedReaderProjection(id,{...value,records},versionId);
}
export const readOfficialFilingsForReader = (): Promise<CivicDataReadResult<CuratedReaderProjection>> => {
  const contract = requiredManualProductionContract("official-filings");
  return readPromotedEdgeFirst(contract.recordClass, contract.scope,
    options => readCuratedReaderProjection("official-filings", options), "Official filing records");
};
/** The national navigation record, read only for states whose own record is not yet published. */
export const settleBallotNavigationRead = (): Promise<string> =>
  readPromotedEdgeFirst(BALLOT_NAVIGATION.recordClass, BALLOT_NAVIGATION.scope,
    options => refreshCuratedReaderProjection("ballot-navigation", options), "The ballot navigation links");
export const refreshCampaignSitesFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("campaign-sites", options);
export async function refreshMemberOfficesFromPromoted(options: PromotedCivicDataReadOptions = {}, places?: readonly string[]): Promise<string> {
  const progressStore=options.store as Partial<Pick<RoutineDataStore,"readMemberOfficeProgress">> | undefined;
  const selected=places ?? (selectedRegistryStates().length ? selectedRegistryStates() : progressStore?.readMemberOfficeProgress
    ? Object.keys((await progressStore.readMemberOfficeProgress()).rosterDigests) : []);
  if(!selected.length)throw new Error("Member-office reads require their states.");
  const reads=await Promise.all(selected.map(state=>readMemberOfficeStateProjection(state,options)));
  const held=reads.filter((read):read is Extract<typeof read,{kind:"PROMOTED"|"BOOTSTRAP"}>=>read.kind==="PROMOTED"||read.kind==="BOOTSTRAP");
  if(!held.length)throw new Error("No member-office state is published.");
  const version=held.map(read=>read.metadata.versionId).join("|");
  readerStates().set("member-offices",{kind:"BOOTSTRAP",value:{kind:"member-offices",records:held.flatMap(read=>read.value.records)},metadata:{...held[0].metadata,versionId:version},detail:"The selected states' exact keyed member offices."});
  return version;
}
export const refreshVenueResolutionsFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("venue-resolutions", options);

export function curatedReaderReadState(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  return readerStates().get(id) ?? initial(id);
}

/** Only after the canonical pointer was read. A BOOTSTRAP state is a validated edge copy of a promoted version and is served; the seed is test evidence, never a production fallback. */
export function currentCuratedReaderRecords<T>(
  id: CuratedReaderContractId,
  testSeed: readonly T[],
): readonly T[] {
  const state = readerStates().get(id) ?? initial(id);
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return state.value.records as readonly T[];
  if (mayUseTestFixture()) return testSeed;
  throw new Error(`${id} projection is ${state.kind}; initialize its canonical read before using the synchronous Reader projection.`);
}
