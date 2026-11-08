import { scopedValue } from "../scoped-value.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import { civicDataReadNotInitialized } from "../civic-data/read-result.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import { type FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import type { DirectoryFile } from "./directory.ts";
import type { OfficeholderSet } from "./types.ts";

export type FederalDirectoryRead = CivicDataReadResult<FederalDirectoryReadModel>;

export type FederalDirectoryContext = { bound?: true; states: readonly string[]; read?: FederalDirectoryRead; pending?: Promise<FederalDirectoryRead> };

const requests = new WeakMap<object, FederalDirectoryContext>(), jobs = scopedValue<FederalDirectoryContext>();

const contextKey = () => currentReaderSelection() ?? currentReaderAuthorityEdge();

export const currentFederalDirectoryContext = () => { const key = contextKey(); return key ? requests.get(key) : jobs.getStore(); };

/** A read in flight is remembered on the request, or on the running job when there is no request. */
export function enterFederalDirectoryContext(context: FederalDirectoryContext, existing: FederalDirectoryContext | undefined): void {
  const key = contextKey();
  if (key) requests.set(key, context); else if (context !== existing) jobs.enterWith(context);
}

/** Compose a cached state answer with its already loaded, portrait-enriched directory. */
export function withFederalDirectoryProjection<T>(read: FederalDirectoryRead | undefined, states: readonly string[], compose: () => T): T {
  if(!read)return compose();
  const context: FederalDirectoryContext={bound:true,states:[...new Set(states.map(requireRegistryState))].sort(),read};
  const key=contextKey();
  if(key)requests.set(key,context);
  return jobs.run(context,compose);
}

export function federalDirectoryReadState(): FederalDirectoryRead {
  return currentFederalDirectoryContext()?.read ?? civicDataReadNotInitialized("FEDERAL_DIRECTORY", "unselected places",
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
