import { STATE_BALLOT_FAMILIES, stateFromBallotScope } from "../civic-data/state-scopes.ts";
import { stateFromRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { StateAuthorityFamily, PromotedFamilyArtifactValue } from "../meetings/edge-artifacts.ts";
import { AsyncLocalStorage } from "node:async_hooks";

import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { PromotedCivicDataReadOptions, PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import type { CensusDistrictEdge } from "../census-geography/district-edge.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { currentReaderSelection, withReaderSelection, type ReaderSelection } from "../db/reader-route.ts";


export interface FederalDirectoryEdgeValue {
  readonly value: FederalDirectoryReadModel;
  readonly versionId: string;
}
export interface CampaignSitesEdgeValue {
  readonly value: CuratedReaderProjection;
  readonly versionId: string;
}
/** The promoted recorded-outcome projection. */
export interface MeetingOutcomesEdgeValue {
  readonly value: OutcomeSnapshot;
  readonly versionId: string;
}
/** The comment rules composed from facts. */
export interface CommentAccessEdgeValue {
  readonly value: import("./comment-access.ts").CommentAccessProjection;
  readonly versionId: string;
}
/** A request loads only the jurisdictions it serves. Missing bytes fall back to the typed reader. */
export interface StateLegislatorsEdgeValue {
  readonly jurisdictions: ReadonlySet<string>;
  readonly load: (jurisdiction: string) => Promise<EdgeServedValue<OfficialStateLegislatorReadModel> | null>;
}

export interface RegistrationsEdge {
  readonly states: ReadonlySet<string>;
  readonly load: (state: string) => Promise<{ readonly value: RegistrationReadModel; readonly versionId: string } | null>;
}

interface StateAuthoritiesEdge {
  readonly key?: (family: StateAuthorityFamily, state: string) => string | null;
  readonly states: Readonly<Partial<Record<StateAuthorityFamily, ReadonlySet<string>>>>;
  readonly load: (family: StateAuthorityFamily, state: string) => Promise<PromotedFamilyArtifactValue | null>;
}

export interface ReaderAuthorityEdgeBundle {
  readonly meetingPlaces?: ReadonlyMap<string, readonly string[]>;
  readonly selection?: ReaderSelection;
  readonly loadPromoted?: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedEdgeEntry | null>;
  readonly stateAuthorities?: StateAuthoritiesEdge;
  readonly stateRegistryFacts?: { readonly key?: (state: string) => string | null; readonly load: (state: string) => Promise<{ readonly bodies: readonly BodyFacts[]; readonly versionId: string | null } | null> };
  readonly censusDistricts?: { readonly value: CensusDistrictEdge; readonly versionId: string };
  readonly federalDirectory?: FederalDirectoryEdgeValue;
  readonly campaignSites?: CampaignSitesEdgeValue;
  readonly stateLegislators?: StateLegislatorsEdgeValue;
  readonly meetingOutcomes?: MeetingOutcomesEdgeValue;
  readonly commentAccess?: CommentAccessEdgeValue;
  readonly registrations?: RegistrationsEdge;

  readonly promoted?: ReadonlyMap<string, PromotedEdgeEntry>;
  /** The proven-pointer families whose artifact this bundle loaded (a trace reports where each source came from). */
  readonly promotedFamilies?: ReadonlySet<string>;

  readonly edgeOnly?: true;
}

/** A read an edge-only context could not serve from the edge; it was refused rather than sent to the database. */
export class ReaderEdgeOnlyRefusal extends Error {
  constructor(what: string) {
    super(`${what} is not on the reader edge, and this context never reads the database`);
    this.name = "ReaderEdgeOnlyRefusal";
  }
}

/** Called immediately before a database fallback: throws in an edge-only context, otherwise does nothing. */
export function refuseDatabaseInEdgeOnlyContext(what: string): void {
  if (edgeStore.getStore()?.edgeOnly) throw new ReaderEdgeOnlyRefusal(what);
}

/** One family's value as the edge serves it: the immutable value and the promoted version it copies. */
export interface EdgeServedValue<T> {
  readonly value: T;
  readonly versionId: string;
}

export async function settleEdgeFirst<T>(
  edge: () => EdgeServedValue<T> | null,
  prime: (value: NoInfer<T>, versionId: string) => void | Promise<unknown>,
  refresh: () => Promise<unknown>,
  what: string,
): Promise<void> {
  const served = edge();
  if (served) {
    await prime(served.value, served.versionId);
    return;
  }
  refuseDatabaseInEdgeOnlyContext(what);
  await refresh();
}

/** The edge's copy of one pointer for this request, or null when it carries none. */
export function currentPromotedEdge(recordClass: RoutineRecordClass, scope: string): EdgeServedValue<PromotedEdgeEntry> | null {
  const bundle = edgeStore.getStore();
  const entry = bundle?.promoted?.get(`${recordClass}:${scope}`) ?? (bundle ? loadedStateEntries.get(bundle)?.get(`${recordClass}:${scope}`) : null);
  if (!entry) return null;
  return { value: entry, versionId: entry.kind === "PROMOTED" ? entry.projection.versionId : "NOT_RECORDED" };
}

const loadedStateEntries = new WeakMap<ReaderAuthorityEdgeBundle, Map<string, PromotedEdgeEntry>>();

export async function ensurePromotedEdge(recordClass: RoutineRecordClass, scope: string): Promise<EdgeServedValue<PromotedEdgeEntry> | null> {
  const current = currentPromotedEdge(recordClass, scope);
  if (current) return current;
  const bundle = edgeStore.getStore(), stateEdge = bundle?.stateAuthorities;
  if (!bundle) return null;
  if (!stateEdge) return loadCurrentPromotedEdge(recordClass, scope).then(value => value ? { value, versionId: value.kind === "PROMOTED" ? value.projection.versionId : "NOT_RECORDED" } : null);
  const registryState = recordClass === "REGISTRY_RUNTIME_BINDING" ? stateFromRegistryRuntimeScope(scope) : null;
  if (registryState) {
    let entries = loadedStateEntries.get(bundle);
    if (!entries) { entries = new Map(); loadedStateEntries.set(bundle, entries); }
    const loaded = await stateEdge.load("registry-runtime", registryState).catch(error => {
      reportReaderStateFailure("registry-runtime", registryState, stateEdge.key?.("registry-runtime", registryState) ?? null, error); return null;
    });
    for (const entry of loaded?.entries ?? []) entries.set(entry.kind === "PROMOTED" ? entry.projection.key : `${entry.recordClass}:${entry.scope}`, entry);
    return currentPromotedEdge(recordClass, scope);
  }
  for (const scopedFamily of STATE_BALLOT_FAMILIES) {
    const state = stateFromBallotScope(scope, scopedFamily);
    const family: StateAuthorityFamily = scopedFamily === "candidate-corpus" ? "candidate-publications" : scopedFamily;
    if (!state || !stateEdge.states[family]) continue;
    if (!stateEdge.states[family]!.has(state)) return null;
    let entries = loadedStateEntries.get(bundle);
    if (!entries) { entries = new Map(); loadedStateEntries.set(bundle, entries); }
    const loaded = await stateEdge.load(family, state).catch(error => {
      reportReaderStateFailure(family, state, stateEdge.key?.(family, state) ?? null, error); return null;
    });
    for (const entry of loaded?.entries ?? []) entries.set(entry.kind === "PROMOTED" ? entry.projection.key : `${entry.recordClass}:${entry.scope}`, entry);
    return currentPromotedEdge(recordClass, scope);
  }
  const value = await loadCurrentPromotedEdge(recordClass, scope);
  return value ? { value, versionId: value.kind === "PROMOTED" ? value.projection.versionId : "NOT_RECORDED" } : null;
}

export async function readPromotedEdgeFirst<R>(
  recordClass: RoutineRecordClass,
  scope: string,
  read: (options: PromotedCivicDataReadOptions) => Promise<R>,
  what: string,
): Promise<R> {
  await ensurePromotedEdge(recordClass, scope);
  let result: { readonly value: R } | null = null;
  await settleEdgeFirst(
    () => currentPromotedEdge(recordClass, scope),
    async (edge) => { result = { value: await read({ edge }) }; },
    async () => { result = { value: await read({}) }; },
    what,
  );
  return (result as { readonly value: R } | null)!.value;
}

const edgeStore = new AsyncLocalStorage<ReaderAuthorityEdgeBundle>();
const stateReadFailures = new WeakMap<object, Set<string>>();

export function reportReaderStateFailure(family: string, state: string | null, key: string | null, error: unknown,
  phase: "ARTIFACT" | "DATABASE" = "ARTIFACT"): void {
  const diagnostic = sanitizedErrorDiagnostic(error), context = currentReaderSelection() ?? currentReaderAuthorityEdge();
  if (context) {
    const failures = stateReadFailures.get(context) ?? new Set<string>(), id = `${phase}:${family}:${state}:${key}:${diagnostic}`;
    if (failures.has(id)) return;
    failures.add(id); stateReadFailures.set(context, failures);
  }
  console.warn(`READER_STATE_${phase}_MISS`, { family, state, key, error: diagnostic });
}


export function enterReaderAuthorityEdge(bundle: ReaderAuthorityEdgeBundle): void {
  edgeStore.enterWith(bundle);
}

export function withReaderAuthorityEdge<T>(bundle: ReaderAuthorityEdgeBundle | null, read: () => T): T {
  return bundle ? edgeStore.run(bundle, () => bundle.selection ? withReaderSelection(bundle.selection, read) : read()) : read();
}

export function currentReaderAuthorityEdge(): ReaderAuthorityEdgeBundle | null {
  return edgeStore.getStore() ?? null;
}

async function loadCurrentPromotedEdge(recordClass: RoutineRecordClass, scope: string): Promise<PromotedEdgeEntry | null> {
  return await edgeStore.getStore()?.loadPromoted?.(recordClass, scope) ?? null;
}

export function currentFederalDirectoryEdge(): FederalDirectoryEdgeValue | null {
  return edgeStore.getStore()?.federalDirectory ?? null;
}
export function currentCampaignSitesEdge(): CampaignSitesEdgeValue | null {
  return edgeStore.getStore()?.campaignSites ?? null;
}
export function currentStateLegislatorsEdge(): StateLegislatorsEdgeValue | null {
  return edgeStore.getStore()?.stateLegislators ?? null;
}
export function currentMeetingOutcomesEdge(): MeetingOutcomesEdgeValue | null {
  return edgeStore.getStore()?.meetingOutcomes ?? null;
}
export function currentCommentAccessEdge(): CommentAccessEdgeValue | null {
  return edgeStore.getStore()?.commentAccess ?? null;
}
export function currentRegistrationsEdge(): RegistrationsEdge | null {
  return edgeStore.getStore()?.registrations ?? null;
}
