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

let cache: RegistryRuntimeReadModel | null = null;
let readState: CivicDataReadResult<RegistryRuntimeReadModel> = civicDataReadNotInitialized(
  "REGISTRY_RUNTIME_BINDING",
  REGISTRY_RUNTIME_SCOPE,
  "The Reader registry runtime pointer has not been read for this process.",
);

/*
 * A read validates structure; a promotion validates everything. A body on a Census placeholder
 * division is refused at promotion (`registryRuntimeProjectionIssues` via `registryRuntimeCandidate`)
 * but does not fail a read, so a counting defect never becomes a reader outage.
 */
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
  const result = await readRegistryRuntimeProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/**
 * Prime the registry-runtime cache from a validated edge serving artifact, with no database read: the
 * reader's normal path (request-scoped, see `lib/registry/runtime-edge.ts`). The database reader above
 * stays the authoritative path for the runner and workers. Validated once per edge object and version.
 */
export function primeRegistryRuntimeFromValue(value: RegistryRuntimeReadModel, versionId: string): void {
  validateOnce("registry-runtime", value, versionId, () => validate(value, versionId));
  cache = value;
  // BOOTSTRAP, not PROMOTED: the serving copy carries the validated value and its
  // version but not the promotion receipt. The version drives the registry
  // authority cache key.
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
  return readState;
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  if (!cache) throw new Error(`Registry runtime bindings are ${readState.kind}; call readRegistryRuntimeProjection before using the synchronous projection.`);
  return cache;
}

export function getRuntimeBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}
