import { AsyncLocalStorage } from "node:async_hooks";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { readStateAuthorityEntry, readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import {
  federalDirectoryProjectionIssues,
  federalDirectoryScope,
  type FederalDirectoryReadModel,
} from "./federal-directory-data-plane.ts";
import type { DirectoryFile } from "./directory.ts";
import { peopleSourceScope } from "./people-sources.ts";
import { federalDirectoryVersion } from "./people-version.ts";
import type { OfficeholderSet } from "./types.ts";

type Read = CivicDataReadResult<FederalDirectoryReadModel>;
type Context = { states: readonly string[]; read?: Read; pending?: Promise<Read> };
const requests = new WeakMap<object, Context>(), jobs = new AsyncLocalStorage<Context>();
const contextKey = () => currentReaderSelection() ?? currentReaderAuthorityEdge();
const current = () => { const key = contextKey(); return key ? requests.get(key) : jobs.getStore(); };

/** Compose a cached state answer with its already loaded, portrait-enriched directory. */
export function withFederalDirectoryProjection<T>(read: Read | undefined, states: readonly string[], compose: () => T): T {
  if(!read)return compose();
  const context: Context={states:[...new Set(states.map(requireRegistryState))].sort(),read};
  const key=contextKey();
  if(key)requests.set(key,context);
  return jobs.run(context,compose);
}

function validate(value: FederalDirectoryReadModel, versionId: string): void {
  const issues = federalDirectoryProjectionIssues(value);
  if (issues.length) throw new Error(`Federal directory projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Where a place's standing portrait work publishes the verified photos of its people, members of Congress included. */
export const placePortraitsScope = (state: string) => peopleSourceScope(`US-${requireRegistryState(state)}`, "people-portraits");

/** Each verified portrait is laid on its person; everything else about the directory is untouched. */
export function withFederalPortraits(roster: OfficeholderSet, portraits: OfficeholderSet): OfficeholderSet {
  const held = new Map(portraits.officeholders.filter(row => row.photo).map(row => [row.personId ?? row.id, row] as const));
  if (held.size === 0) return roster;
  return { ...roster, officeholders: roster.officeholders.map(row => {
    const portrait = held.get(row.personId ?? row.id);
    if (!portrait) return row;
    return { ...row, photo: portrait.photo, profileUrls: [...new Set([...(row.profileUrls ?? []), ...(portrait.profileUrls ?? [])])],
      fieldSources: { ...row.fieldSources, ...(portrait.fieldSources?.photo ? { photo: portrait.fieldSources.photo } : {}) } };
  }) };
}

/** One place's members of Congress as published, held to the directory's reader contract. */
export async function readStateFederalDirectory(state: string, options: PromotedCivicDataReadOptions = {}): Promise<Read> {
  const result = await readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", federalDirectoryScope(state), options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") validate(result.value, result.metadata.versionId ?? result.kind);
  return result;
}

async function readPlace(state: string, options: PromotedCivicDataReadOptions): Promise<Read> {
  type Portraits = { readonly roster: OfficeholderSet };
  const base = options.store ? await readStateFederalDirectory(state, options)
    : (await readStateAuthorityProjection<FederalDirectoryReadModel>("federal-directory", state)).result;
  if (base.kind !== "PROMOTED" && base.kind !== "BOOTSTRAP") return base;
  if (!options.store) validate(base.value, base.metadata.versionId ?? base.kind);
  // A portrait record that cannot be read leaves the place's directory as it was.
  const portraits = await (options.store ? readPromotedCivicData<Portraits>("STATE_LEGISLATOR", placePortraitsScope(state), options)
    : readStateAuthorityEntry<Portraits>("federal-directory", state, "STATE_LEGISLATOR", placePortraitsScope(state)).then(read => read.result)).catch(() => null);
  if (portraits === null || (portraits.kind !== "PROMOTED" && portraits.kind !== "BOOTSTRAP") || !portraits.value?.roster?.officeholders) return base;
  const roster = withFederalPortraits(base.value.roster, portraits.value.roster);
  if (roster === base.value.roster) return base;
  const value: FederalDirectoryReadModel = { ...base.value, roster };
  const versionId = federalDirectoryVersion(base.metadata.versionId ?? base.kind, portraits.metadata.versionId ?? portraits.kind);
  return { ...base, value, metadata: { ...base.metadata, versionId }, ...(base.kind === "PROMOTED" ? { projection: { ...base.projection, versionId, payload: value } } : {}) } as Read;
}

function combine(reads: readonly Read[], states: readonly string[]): Read {
  const served = reads.flatMap(read => read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? [read] : []);
  if (!served.length) return reads[0];
  if (states.length === 1) return served[0];
  const values = served.map(read => read.value), first = values[0];
  const value: FederalDirectoryReadModel = { ...first,
    vacancies: values.flatMap(row => row.vacancies ?? []),
    currentMembershipComplete: values.every(row => row.currentMembershipComplete === true),
    roster: { ...first.roster, officeholders: values.flatMap(row => row.roster.officeholders), divisions: values.flatMap(row => row.roster.divisions), unmatched: values.flatMap(row => row.roster.unmatched) },
    directory: { ...first.directory, counts: {}, committees: Object.assign({}, ...values.map(row => row.directory.committees)), byMember: Object.assign({}, ...values.map(row => row.directory.byMember)) } };
  return { kind: "BOOTSTRAP", value, metadata: { ...served[0].metadata, scope: states.map(federalDirectoryScope).join("|"),
    versionId: served.map(read => read.metadata.versionId).join("|"), lastKnownGoodVersionId: null },
    detail: `The named places' members of Congress.${served.length < reads.length ? " Some requested place records are unavailable." : ""}` };
}

/** The selection's divisions name their members, so records bound to those members are part of what the request may read. */
function selectMembers(read: Read): Read {
  const selection = currentReaderSelection();
  if (selection && (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP")) for (const division of read.value.roster.divisions) {
    if (selection.keys.has(division.ocdId)) selection.keys.add(division.officeholderId);
  }
  return read;
}

/** Read the named places canonically, or reuse their state answers supplied by the site. */
export async function readFederalDirectoryProjection(states: readonly string[], options: PromotedCivicDataReadOptions = {}, loadState?: (state: string) => Promise<Read>): Promise<Read> {
  const selected = [...new Set(states.map(requireRegistryState))].sort();
  if (!selected.length) throw new Error("FEDERAL_DIRECTORY_PLACES_NOT_SELECTED");
  const key = contextKey(), existing = current();
  const sameStates = existing && selected.join() === existing.states.join();
  if (!options.store && !options.bypassCache && sameStates && (existing.read || existing.pending)) return selectMembers(existing.read ?? await existing.pending!);
  const context: Context = sameStates ? existing : { states: selected };
  if (key) requests.set(key, context); else if (context !== existing) jobs.enterWith(context);
  context.pending = Promise.all(selected.map(state => loadState ? loadState(state) : readPlace(state, options))).then(reads => context.read = combine(reads, selected));
  return selectMembers(await context.pending);
}

export async function refreshFederalDirectoryFromPromoted(states: readonly string[], options: PromotedCivicDataReadOptions = {}, loadState?: Parameters<typeof readFederalDirectoryProjection>[2]): Promise<string | null> {
  const result = await readFederalDirectoryProjection(states, options, loadState);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.metadata.versionId;
}

export function federalDirectoryReadState(): Read {
  return current()?.read ?? civicDataReadNotInitialized("FEDERAL_DIRECTORY", "unselected places",
    "The named places' members of Congress have not been read in this context.");
}

export function getFederalDirectoryReadModel(): FederalDirectoryReadModel {
  const state = federalDirectoryReadState();
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return state.value;
  throw new Error(`The requested places' members of Congress are ${state.kind}.`);
}

export function getFederalOfficeholderSet(): OfficeholderSet {
  return getFederalDirectoryReadModel().roster;
}

export function getFederalDirectoryFile(): DirectoryFile {
  return getFederalDirectoryReadModel().directory;
}
