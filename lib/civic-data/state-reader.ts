import { stateBallotScope } from "./state-scopes.ts";
import { ballotNavigationScope } from "./ballot-navigation-scope.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge, refuseDatabaseInEdgeOnlyContext, reportReaderStateFailure } from "../registry/runtime-edge.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import { federalDirectoryScope } from "../officials/federal-directory-data-plane.ts";
import { peopleSourceScope } from "../officials/people-sources.ts";
import type { PromotedFamilyArtifactValue, StateAuthorityFamily } from "../meetings/edge-artifacts.ts";
import { civicDataReadNotInitialized, readPromotedCivicData, registerIntegrityCheckedEdgeEntries, type CivicDataReadResult, type PromotedEdgeEntry } from "./read-model.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import { readStateReaderEntry } from "./state-reader-store.ts";
import { readerCanonicalEntry } from "../reader/canonical-context.ts";
import type { RoutineRecordClass } from "./types.ts";

type StateRead<T> = { readonly result: CivicDataReadResult<T>; readonly source: "EDGE" | "DATABASE" };
type Query = Parameters<typeof readStateReaderEntry>[0];
type Held = { pending: Promise<StateRead<unknown>>; result?: StateRead<unknown> };
const requests = new WeakMap<object, Map<string, Held>>();
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

function stateKey(family: StateAuthorityFamily, state: string) {
  const { recordClass, scope } = stateAuthorityPointers(family, state)[0];
  return { scope, recordClass, key: `${recordClass}:${scope}` };
}

export function currentStateAuthorityProjection<T>(family: StateAuthorityFamily, state: string): StateRead<T> | null {
  const context = currentReaderSelection() ?? currentReaderAuthorityEdge();
  return context ? requests.get(context)?.get(stateKey(family, state).key)?.result as StateRead<T> ?? null : null;
}

export function readStateAuthorityProjection<T>(family: StateAuthorityFamily, state: string, query?: Query): Promise<StateRead<T>> {
  const { recordClass, scope } = stateKey(family, state);
  return readStateAuthorityEntry<T>(family, state, recordClass, scope, query);
}

/** One canonical state pointer, with optional request-injected values. */
export async function readStateAuthorityEntry<T>(family: StateAuthorityFamily, state: string, recordClass: RoutineRecordClass, scope: string, query?: Query): Promise<StateRead<T>> {
  const key = `${recordClass}:${scope}`, edge = currentReaderAuthorityEdge();
  const context = currentReaderSelection() ?? edge, held = context ? requests.get(context) ?? new Map<string, Held>() : new Map<string, Held>();
  if (context) requests.set(context, held);
  const prior = held.get(key);
  if (prior) return prior.pending as Promise<StateRead<T>>;
  const load = async (): Promise<StateRead<T>> => {
    const canonical = !query && !edge ? readerCanonicalEntry(recordClass, scope) : undefined;
    let entry: PromotedEdgeEntry | null = null;
    let artifact: PromotedFamilyArtifactValue | null = null;
    try {
      artifact = await edge?.stateAuthorities?.load(family, state) ?? null;
      if (artifact) entry = artifact.entries.find(row => row.kind === "PROMOTED" ? row.projection.key === key : row.recordClass === recordClass && row.scope === scope) ?? null;
    }
    catch (error) { reportReaderStateFailure(family, state, edge?.stateAuthorities?.key?.(family, state) ?? key, error); }
    if (entry) {
      try {
        const result = await readPromotedCivicData<T>(recordClass, scope, { edge: entry });
        const checkFederalAbsence = recordClass === "FEDERAL_DIRECTORY" && !edge?.edgeOnly && (query || process.env.DATABASE_URL);
        if (result.kind === "PROMOTED" || result.kind === "NOT_RECORDED" && !checkFederalAbsence) return { source: "EDGE", result };
        if (result.kind === "STORE_UNREACHABLE") throw new Error(result.detail);
      } catch (error) { reportReaderStateFailure(family, state, edge?.stateAuthorities?.key?.(family, state) ?? key, error); }
    }
    refuseDatabaseInEdgeOnlyContext(key);
    try {
      if (canonical) return { source: "DATABASE", result: await readPromotedCivicData<T>(recordClass, scope, { edge: await canonical }) };
      const batch = query ? null : readerQuery();
      if (!query && !batch) throw new Error("STATE_READER_DATABASE_UNAVAILABLE");
      entry = await readStateReaderEntry(query ?? (async (text, params) => (await batch!([{ text, params }]))[0]), recordClass, scope);
      registerIntegrityCheckedEdgeEntries([entry]);
      return { source: "DATABASE", result: await readPromotedCivicData<T>(recordClass, scope, { edge: entry }) };
    } catch (error) {
      reportReaderStateFailure(family, state, key, error, "DATABASE");
      const empty = civicDataReadNotInitialized(recordClass, scope, "The state's published records could not be read.");
      return { source: "DATABASE", result: { kind: "STORE_UNREACHABLE", value: null, metadata: empty.metadata,
        code: "STORE_READ_FAILED", detail: "The state's published records could not be read." } };
    }
  };
  const item: Held = { pending: Promise.resolve().then(load) };
  held.set(key, item);
  item.result = await item.pending;
  return item.result as StateRead<T>;
}
