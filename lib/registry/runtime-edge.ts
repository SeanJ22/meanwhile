import { AsyncLocalStorage } from "node:async_hooks";

import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { PromotedCivicDataReadOptions, PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import type { CensusDistrictEdge } from "../census-geography/district-edge.ts";
import { withReaderSelection, type ReaderSelection } from "../db/reader-route.ts";


export interface RegistryRuntimeEdgeValue {
  readonly value: RegistryRuntimeReadModel;
  readonly versionId: string;
}
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

export interface ReaderAuthorityEdgeBundle {
  readonly meetingPlaces?: ReadonlyMap<string, readonly string[]>;
  readonly selection?: ReaderSelection;
  readonly loadPromoted?: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedEdgeEntry | null>;
  readonly censusDistricts?: { readonly value: CensusDistrictEdge; readonly versionId: string };
  readonly registryRuntime?: RegistryRuntimeEdgeValue;
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
  const entry = edgeStore.getStore()?.promoted?.get(`${recordClass}:${scope}`);
  if (!entry) return null;
  return { value: entry, versionId: entry.kind === "PROMOTED" ? entry.projection.versionId : "NOT_RECORDED" };
}


export async function readPromotedEdgeFirst<R>(
  recordClass: RoutineRecordClass,
  scope: string,
  read: (options: PromotedCivicDataReadOptions) => Promise<R>,
  what: string,
): Promise<R> {
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


export function enterReaderAuthorityEdge(bundle: ReaderAuthorityEdgeBundle): void {
  edgeStore.enterWith(bundle);
}


export function withReaderAuthorityEdge<T>(bundle: ReaderAuthorityEdgeBundle | null, read: () => T): T {
  return bundle ? edgeStore.run(bundle, () => bundle.selection ? withReaderSelection(bundle.selection, read) : read()) : read();
}

export function currentReaderAuthorityEdge(): ReaderAuthorityEdgeBundle | null {
  return edgeStore.getStore() ?? null;
}

export async function loadCurrentPromotedEdge(recordClass: RoutineRecordClass, scope: string): Promise<PromotedEdgeEntry | null> {
  return await edgeStore.getStore()?.loadPromoted?.(recordClass, scope) ?? null;
}

export function currentRegistryRuntimeEdge(): RegistryRuntimeEdgeValue | null {
  return edgeStore.getStore()?.registryRuntime ?? null;
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
