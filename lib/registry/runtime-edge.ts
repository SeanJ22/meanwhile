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

/**
 * Request-scoped "reader authority" edge bundle: the large families the coverage
 * graph needs — registry-runtime, the federal directory, and campaign-site URLs.
 *
 * The reader (a Netlify function) fetches the runner-published edge artifacts and
 * calls {@link enterReaderAuthorityEdge} at the top of the request.
 * `settleRegistryAuthorityReads` and `currentAuthorityKey` then prime the module
 * caches from these values INSTEAD of reading Neon — but only for the request
 * that set them. The standing runner and the workers never set them, so they
 * keep the authoritative `refresh*FromPromoted` database path unchanged. This is
 * why the edge path is request-scoped rather than a global override: the two
 * clocks stay separate.
 */
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
/** The promoted comment-access rules, a curated reader projection like campaign sites. */
export interface CommentAccessEdgeValue {
  readonly value: CuratedReaderProjection;
  readonly versionId: string;
}
/** Per-scope state-legislator read models, keyed by OfficialStateVoteScope. */
export interface StateLegislatorsEdgeValue {
  readonly value: Readonly<Record<string, OfficialStateLegislatorReadModel>>;
  readonly versionId: string;
}

/**
 * Each state's promoted registration on the edge. Not fetched with the bundle: a request loads only the
 * states its divisions name. `states` is complete (`ReaderManifest.registrations`): a state it lacks has
 * no promoted registration. `load` answers null when the artifact could not be fetched, and the caller
 * then reads that state from the database.
 */
export interface RegistrationsEdge {
  readonly states: ReadonlySet<string>;
  readonly load: (state: string) => Promise<{ readonly value: RegistrationReadModel; readonly versionId: string } | null>;
}

export interface ReaderAuthorityEdgeBundle {
  readonly censusDistricts?: { readonly value: CensusDistrictEdge; readonly versionId: string };
  readonly registryRuntime?: RegistryRuntimeEdgeValue;
  readonly federalDirectory?: FederalDirectoryEdgeValue;
  readonly campaignSites?: CampaignSitesEdgeValue;
  readonly stateLegislators?: StateLegislatorsEdgeValue;
  readonly meetingOutcomes?: MeetingOutcomesEdgeValue;
  readonly commentAccess?: CommentAccessEdgeValue;
  readonly registrations?: RegistrationsEdge;
  /**
   * The proven pointers the edge carries whole, keyed by pointer (`RECORD_CLASS:scope`). Each is read
   * through its own typed Reader (`readPromotedEdgeFirst`), so every validation applied to a database read
   * applies to this copy too.
   */
  readonly promoted?: ReadonlyMap<string, PromotedEdgeEntry>;
  /** The proven-pointer families whose artifact this bundle loaded (a trace reports where each source came from). */
  readonly promotedFamilies?: ReadonlySet<string>;
  /**
   * Set only by the keep-warm call: a read this bundle cannot serve fails
   * ({@link refuseDatabaseInEdgeOnlyContext}) instead of waking the database. Reader requests never set
   * it; their fallback to the database is the point.
   */
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

/**
 * Edge first, database second: serve the request's edge value if it entered one, else refuse in an
 * edge-only context, else read the authoritative database pointer. One `T` runs through the edge
 * accessor, the prime and the read, so a family cannot be primed with another family's value. `what`
 * names the family in the edge-only refusal. A prime may itself be a typed Reader, so it is awaited.
 */
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

/**
 * One pointer, edge first, through its own typed Reader. With the edge's copy of the pointer, `read` is
 * handed `{ edge }` and applies every validation and staleness bound it applies to a database read;
 * without one it reads the database, or refuses in an edge-only context.
 */
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

/**
 * Bind the bundle to the current request's async context. Uses `enterWith` so
 * callers do not have to wrap the whole handler body; each request handler runs
 * in its own async context, so this never leaks across concurrent requests.
 */
export function enterReaderAuthorityEdge(bundle: ReaderAuthorityEdgeBundle): void {
  edgeStore.enterWith(bundle);
}

/**
 * Run `read` inside the bundle's context, and only it (AsyncLocalStorage.run). React calls each async
 * server component from its own render loop, so a component's reads do not see the page's
 * `enterReaderAuthorityEdge`; the page hands the bundle down and each component reads here. A null bundle
 * runs `read` unchanged: the database path.
 */
export function withReaderAuthorityEdge<T>(bundle: ReaderAuthorityEdgeBundle | null, read: () => T): T {
  return bundle ? edgeStore.run(bundle, read) : read();
}

export function currentReaderAuthorityEdge(): ReaderAuthorityEdgeBundle | null {
  return edgeStore.getStore() ?? null;
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
