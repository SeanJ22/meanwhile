import { AsyncLocalStorage } from "node:async_hooks";

import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";

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
  readonly registrations?: RegistrationsEdge;
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
export function currentRegistrationsEdge(): RegistrationsEdge | null {
  return edgeStore.getStore()?.registrations ?? null;
}
