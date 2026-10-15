import { AsyncLocalStorage } from "node:async_hooks";
import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { validateOnce } from "../civic-data/validated-once.ts";
import {
  REGISTRY_RUNTIME_SCOPE,
  REGISTRY_RUNTIME_SOURCE_ID,
  registryRuntimeProjectionIssues,
  type RegistryRuntimeCarton,
  type RegistryRuntimeReadModel,
} from "./runtime-data-plane.ts";
import { factReader } from "../facts/db.ts";
import { withFactRegistry } from "../facts/registry-overlay.ts";
import type { BodyRoster } from "./body-rosters.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE } from "./census-placeholders.ts";

export interface RegistryPlaceRead {
  readonly value: RegistryRuntimeReadModel;
  readonly versionId: string;
  readonly selectorKey: string;
}
const placeReads = new AsyncLocalStorage<RegistryPlaceRead | Error>();
export const enterRegistryPlaceRead = (read: RegistryPlaceRead | Error): void => placeReads.enterWith(read);
export const withRegistryPlaceRead = <T>(read: RegistryPlaceRead | Error, work: () => T): T => placeReads.run(read, work);
export function currentRegistryPlaceRead(): RegistryPlaceRead | null {
  const read = placeReads.getStore();
  if (read instanceof Error) throw read;
  return read ?? null;
}

let cache: RegistryRuntimeReadModel | null = null;
let readState: CivicDataReadResult<RegistryRuntimeReadModel> = civicDataReadNotInitialized(
  "REGISTRY_RUNTIME_BINDING",
  REGISTRY_RUNTIME_SCOPE,
  "The Reader registry runtime pointer has not been read for this process.",
);

function validate(value: RegistryRuntimeCarton, versionId: string): void {
  const issues = registryRuntimeProjectionIssues(value).filter((issue) => !issue.startsWith(`${CENSUS_PLACEHOLDER_BODY_ISSUE}:`));
  if (issues.length) throw new Error(`Registry runtime projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Store failures remain failures. Members and schedules come from live facts. */
export async function readRegistryRuntimeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const read = await readPromotedCivicData<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, options);
  const result = (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP"
    ? { ...read, value: await withFactRegistry(read.value, factReader()) } : read) as CivicDataReadResult<RegistryRuntimeReadModel>;
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validate(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshRegistryRuntimeFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const place = currentRegistryPlaceRead();
  if (place && Object.keys(options).length === 0) return place.versionId;
  const result = await readRegistryRuntimeProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

export function primeRegistryRuntimeFromValue(value: RegistryRuntimeReadModel, versionId: string): void {
  validateOnce("registry-runtime", value, versionId, () => validate(value, versionId));
  cache = value;
  readState = {
    kind: "BOOTSTRAP",
    value,
    metadata: {
      recordClass: "REGISTRY_RUNTIME_BINDING",
      scope: REGISTRY_RUNTIME_SCOPE,
      sourceId: REGISTRY_RUNTIME_SOURCE_ID,
      version: null,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "CURRENT",
      staleAt: null,
    },
    detail: `Served from the registry-runtime edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
  };
}

export function registryRuntimeReadState(): CivicDataReadResult<RegistryRuntimeReadModel> {
  const place = currentRegistryPlaceRead();
  if (place) return { kind: "BOOTSTRAP", value: place.value, metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: REGISTRY_RUNTIME_SCOPE, sourceId: REGISTRY_RUNTIME_SOURCE_ID,
    version: null, versionId: place.versionId, lastKnownGoodVersionId: place.versionId, sourceThrough: null,
    retrievedAt: null, promotedAt: null, stale: "CURRENT", staleAt: null }, detail: "Selected divisions from the accepted registry version." };
  return readState;
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  const place = currentRegistryPlaceRead();
  if (place) return place.value;
  if (!cache) throw new Error(`Registry runtime bindings are ${readState.kind}; call readRegistryRuntimeProjection before using the synchronous projection.`);
  return cache;
}

export function getRuntimeBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}
