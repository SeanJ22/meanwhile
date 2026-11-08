import { stateBallotScope } from "./state-scopes.ts";
import { ballotNavigationScope } from "./ballot-navigation-scope.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import { federalDirectoryScope } from "../officials/federal-directory-scope.ts";
import { peopleSourceScope } from "../officials/people-sources.ts";
import type { StateAuthorityFamily } from "../meetings/edge-artifacts.ts";
import { type CivicDataReadResult } from "./read-model.ts";
import type { RoutineRecordClass } from "./types.ts";

export type StateRead<T> = { readonly result: CivicDataReadResult<T>; readonly source: "EDGE" | "DATABASE" };

export type Held = { pending: Promise<StateRead<unknown>>; result?: StateRead<unknown> };

export const stateReadsByRequest = new WeakMap<object, Map<string, Held>>();

const classes: Record<StateAuthorityFamily, RoutineRecordClass> = {
  "registry-runtime": "REGISTRY_RUNTIME_BINDING", "federal-directory": "FEDERAL_DIRECTORY", "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE",
  "candidate-publications": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD",
  "ballot-navigation": "CURATED_READER_RECORD",
};

/** Canonical pointers belonging to one state family. */
export function stateAuthorityPointers(family: StateAuthorityFamily, state: string): readonly { readonly recordClass: RoutineRecordClass; readonly scope: string }[] {
  if (family === "registry-runtime") return [{ recordClass: classes[family], scope: stateRegistryRuntimeScope(state) }];
  if (family === "federal-directory") return [{ recordClass: classes[family], scope: federalDirectoryScope(state) },
    { recordClass: "STATE_LEGISLATOR", scope: peopleSourceScope(`US-${state}`, "people-portraits") }];
  if (family === "ballot-navigation") return [{ recordClass: classes[family], scope: ballotNavigationScope(state) }];
  return [{ recordClass: classes[family], scope: stateBallotScope(family === "candidate-publications" ? "candidate-corpus" : family, state) }];
}

export function stateKey(family: StateAuthorityFamily, state: string) {
  const { recordClass, scope } = stateAuthorityPointers(family, state)[0];
  return { scope, recordClass, key: `${recordClass}:${scope}` };
}

export function currentStateAuthorityProjection<T>(family: StateAuthorityFamily, state: string): StateRead<T> | null {
  const context = currentReaderSelection() ?? currentReaderAuthorityEdge();
  return context ? stateReadsByRequest.get(context)?.get(stateKey(family, state).key)?.result as StateRead<T> ?? null : null;
}

/** A cached state answer carries its already read canonical sources into composition. */
export function primeStateAuthorityProjection<T>(family: StateAuthorityFamily, state: string, result: CivicDataReadResult<T>): void {
  const context = currentReaderSelection() ?? currentReaderAuthorityEdge();
  if (!context) return;
  const held = stateReadsByRequest.get(context) ?? new Map<string, Held>();
  const read: StateRead<T> = { source: "DATABASE", result };
  held.set(stateKey(family, state).key, { result: read, pending: Promise.resolve(read) });
  stateReadsByRequest.set(context, held);
}
