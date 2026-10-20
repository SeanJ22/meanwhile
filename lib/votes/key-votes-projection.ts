import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  FEDERAL_KEY_VOTE_SCOPE,
  federalKeyVoteMemberScope,
  type FederalKeyVotePositions,
  type FederalKeyVotesSnapshot,
  type FederalKeyVotesReadModel,
} from "./data-plane.ts";
import { readPublishedArraySlice, type PublishedArraySlice } from "../civic-data/published-array-slice.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { KEY_VOTES_CRITERIA } from "./key-votes.ts";
import { federalKeyVoteSelectionV1Issue } from "./key-vote-selection-v1.ts";
import { currentPromotedEdge, readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

let cache: FederalKeyVotesReadModel | null = null;
let readState: CivicDataReadResult<FederalKeyVotesReadModel> = civicDataReadNotInitialized(
  "FEDERAL_KEY_VOTE",
  FEDERAL_KEY_VOTE_SCOPE,
  "The federal key-vote canonical pointer has not been read for this process.",
);

function refKey(entryId: string, chamber: "house" | "senate", ref: { congress: number; session: number; rollNumber: number }): string {
  return `${entryId}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
}

function validateProjection(value: FederalKeyVotesReadModel, versionId: string): void {
  if (
    value.formatVersion !== 1 ||
    value.selectionVersion !== "v1" ||
    value.snapshot?.formatVersion !== 1 ||
    value.positions?.formatVersion !== 1 ||
    value.snapshot.criteria !== KEY_VOTES_CRITERIA ||
    !Array.isArray(value.snapshot.entries) ||
    typeof value.positions.positions !== "object"
  ) {
    throw new Error(`Federal key-vote projection ${versionId} does not satisfy selection v1.`);
  }
  const selectionIssue = federalKeyVoteSelectionV1Issue(value.snapshot);
  if (selectionIssue) throw new Error(`Federal key-vote projection ${versionId}: ${selectionIssue}.`);
  const selected = new Set(value.snapshot.entries.flatMap((entry) => [
    ...entry.house.map((ref) => refKey(entry.id, "house", ref)),
    ...entry.senate.map((ref) => refKey(entry.id, "senate", ref)),
  ]));
  if ([...selected].some((key) => value.positions.positions[key] === undefined)) {
    throw new Error(`Federal key-vote projection ${versionId} is missing a selected roll position map.`);
  }
  if (Object.keys(value.positions.positions).some((key) => !selected.has(key))) {
    throw new Error(`Federal key-vote projection ${versionId} contains a position map outside selection v1.`);
  }
}

/** The new publication contains one member only; its shared question selection is carried with the exact positions. */
export async function readFederalKeyVoteMemberProjection(member: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<FederalKeyVotesReadModel>> {
  const result=await readPromotedCivicData<FederalKeyVotesReadModel>("FEDERAL_KEY_VOTE",federalKeyVoteMemberScope(member),options);
  if(result.kind==="PROMOTED"||result.kind==="BOOTSTRAP") {
    validateProjection(result.value,result.metadata.versionId??result.kind);
    if(result.value.officeholderId!==member || Object.values(result.value.positions.positions).some(positions=>Object.keys(positions).some(id=>id!==member)))
      throw new Error("FEDERAL_KEY_VOTE_MEMBER_PROJECTION_INVALID");
  }
  return result;
}

/** A legacy national pointer is sliced inside PostgreSQL: no other member's positions cross the connection. */
export async function readLegacyFederalKeyVoteMember(member: string, query?: ReadOnlyQuery): Promise<FederalKeyVotesReadModel|null> {
  const edge=currentPromotedEdge("FEDERAL_KEY_VOTE",FEDERAL_KEY_VOTE_SCOPE);
  if(edge) {
    const read=await readFederalKeyVotesProjection({edge:edge.value});
    if(read.kind!=="PROMOTED"&&read.kind!=="BOOTSTRAP") throw new Error(read.detail);
    return {...read.value,officeholderId:member,positions:{...read.value.positions,retiredMappings:undefined,
      positions:Object.fromEntries(Object.entries(read.value.positions.positions).map(([key,positions])=>[key,positions[member] ? {[member]:positions[member]} : {}]))}};
  }
  const base={recordClass:"FEDERAL_KEY_VOTE" as const,scope:FEDERAL_KEY_VOTE_SCOPE,statePath:[],statePattern:".*",query};
  const selected=await readPublishedArraySlice<FederalKeyVotesSnapshot>({...base,path:["snapshot"],objectRecord:true});
  const snapshot=selected?.records[0];
  if(!selected||!snapshot) return null;
  const selectionIssue=federalKeyVoteSelectionV1Issue(snapshot);
  if(selectionIssue) throw new Error(`FEDERAL_KEY_VOTE_LEGACY_SELECTION_INVALID:${selectionIssue}`);
  const timestamp=await readPublishedArraySlice<string>({...base,path:["positions","fetchedAt"],valueRecord:true});
  if(!timestamp || timestamp.input.versionId!==selected.input.versionId || !Number.isFinite(Date.parse(timestamp.records[0]??""))) throw new Error("FEDERAL_KEY_VOTE_LEGACY_TIMESTAMP_INVALID");
  const positions:FederalKeyVotePositions={formatVersion:1,fetchedAt:timestamp.records[0],positions:{}};
  for(const entry of snapshot.entries) for(const chamber of ["house","senate"] as const) for(const ref of entry[chamber]) {
    const key=refKey(entry.id,chamber,ref);
    const held=await readPublishedArraySlice<string>({...base,path:["positions","positions",key,member],valueRecord:true});
    if(held && held.input.versionId!==selected.input.versionId) throw new Error("FEDERAL_KEY_VOTE_LEGACY_POINTER_MOVED");
    const value=held?.records[0];
    if(value!==undefined&&!['YES','NO','ABSTAIN','PRESENT','NOT_VOTING','UNKNOWN'].includes(value)) throw new Error("FEDERAL_KEY_VOTE_LEGACY_POSITION_INVALID");
    positions.positions[key]=value ? {[member]:value as import("./types.ts").VotePosition} : {};
  }
  return {formatVersion:1,selectionVersion:"v1",officeholderId:member,snapshot,positions};
}

export async function readFederalKeyVotesProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalKeyVotesReadModel>> {
  const result = await readPromotedCivicData<FederalKeyVotesReadModel>("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE, options);
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateProjection(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

/** A bounded preload for the shared selection: positions remain on their member pointers or legacy SQL slices. */
export async function readFederalKeyVoteSelection(query?: ReadOnlyQuery): Promise<{value:FederalKeyVotesReadModel;versionId:string;publication:PublishedArraySlice<FederalKeyVotesSnapshot>}|null> {
  const selected=await readPublishedArraySlice<FederalKeyVotesSnapshot>({recordClass:"FEDERAL_KEY_VOTE",scope:FEDERAL_KEY_VOTE_SCOPE,
    path:["snapshot"],statePath:[],statePattern:".*",objectRecord:true,query});
  const snapshot=selected?.records[0];
  if(!selected||!snapshot) return null;
  const timestamp=await readPublishedArraySlice<string>({recordClass:"FEDERAL_KEY_VOTE",scope:FEDERAL_KEY_VOTE_SCOPE,
    path:["positions","fetchedAt"],statePath:[],statePattern:".*",valueRecord:true,query});
  if(!timestamp || timestamp.input.versionId!==selected.input.versionId || !Number.isFinite(Date.parse(timestamp.records[0]??""))) throw new Error("FEDERAL_KEY_VOTE_SELECTION_TIMESTAMP_INVALID");
  const positions:FederalKeyVotePositions={formatVersion:1,fetchedAt:timestamp.records[0],positions:Object.fromEntries(snapshot.entries.flatMap(entry=>[
    ...entry.house.map(ref=>[refKey(entry.id,"house",ref),{}]),...entry.senate.map(ref=>[refKey(entry.id,"senate",ref),{}]),
  ]))};
  const value:FederalKeyVotesReadModel={formatVersion:1,selectionVersion:"v1",snapshot,positions};
  validateProjection(value,selected.input.versionId);
  return {value,versionId:selected.input.versionId,publication:selected};
}

export async function refreshFederalKeyVotesFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  if(!options.store&&!options.edge) {
    const selected=await readFederalKeyVoteSelection();
    cache=selected?.value??null;
    if(!selected) throw new Error("Federal key-vote selection has no published pointer.");
    return selected.versionId;
  }
  const result = await readFederalKeyVotesProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/** The key-vote preload: the reader edge's proven copy, else the database. */
export const settleFederalKeyVotesRead = (): Promise<string | null> =>
  readPromotedEdgeFirst("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE, refreshFederalKeyVotesFromPromoted, "The federal key votes");

export function federalKeyVotesReadState(): CivicDataReadResult<FederalKeyVotesReadModel> {
  return readState;
}

export function getFederalKeyVotesReadModel(): FederalKeyVotesReadModel {
  if (!cache) throw new Error(`Federal key votes are ${readState.kind}; call readFederalKeyVotesProjection before using the synchronous projection.`);
  return cache;
}
