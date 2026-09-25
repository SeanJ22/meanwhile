import { AsyncLocalStorage } from "node:async_hooks";

import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";

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
/** The promoted recorded-outcome projection (C20: a cold Ask's slowest database read). */
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
 * Each state's promoted registration on the edge (2026-09-24). Not fetched with the bundle: a request loads only
 * the states its divisions name. `states` is complete (`ReaderManifest.registrations`): a state it lacks has no
 * promoted registration. `load` answers null when the artifact could not be fetched, and the caller then reads that
 * state from the database.
 */
export interface RegistrationsEdge {
  readonly states: ReadonlySet<string>;
  readonly load: (state: string) => Promise<{ readonly value: RegistrationReadModel; readonly versionId: string } | null>;
}

export interface ReaderAuthorityEdgeBundle {
  readonly registryRuntime?: RegistryRuntimeEdgeValue;
  readonly federalDirectory?: FederalDirectoryEdgeValue;
  readonly campaignSites?: CampaignSitesEdgeValue;
  readonly stateLegislators?: StateLegislatorsEdgeValue;
  readonly meetingOutcomes?: MeetingOutcomesEdgeValue;
  readonly commentAccess?: CommentAccessEdgeValue;
  readonly registrations?: RegistrationsEdge;
  /**
   * The keep-warm call's promise (C21, 2026-09-25): it loads what a reader
   * reads, and never the database. A read this bundle cannot serve then fails
   * ({@link refuseDatabaseInEdgeOnlyContext}) instead of falling through to
   * Neon, so a manifest missing a family costs the warm call that place, never
   * a database wake every five minutes on every instance. Reader requests never
   * set it: their fallback to the database is the point.
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
 * **EDGE FIRST, DATABASE SECOND: THE ONE IMPLEMENTATION.** (R24, RULING 103,
 * 2026-09-25.)
 *
 * The registry runtime, the federal directory, the campaign-site URLs, the
 * comment-access rules and the recorded outcomes each settled the same way in
 * five copies: serve the request's edge value if it entered one, else refuse in
 * an edge-only context, else read the authoritative database pointer. One `T`
 * runs through the edge accessor, the prime and the read, so a family cannot be
 * primed with another family's value; the prime stays each family's own typed
 * binding (its validator, its cache), which is why this takes it as an argument
 * rather than naming a cache by string.
 *
 * `what` names the family in the edge-only refusal.
 */
export async function settleEdgeFirst<T>(
  edge: () => EdgeServedValue<T> | null,
  prime: (value: NoInfer<T>, versionId: string) => void,
  refresh: () => Promise<unknown>,
  what: string,
): Promise<void> {
  const served = edge();
  if (served) {
    prime(served.value, served.versionId);
    return;
  }
  refuseDatabaseInEdgeOnlyContext(what);
  await refresh();
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
