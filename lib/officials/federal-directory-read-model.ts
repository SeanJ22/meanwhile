import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { validateOnce } from "../civic-data/validated-once.ts";
import {
  FEDERAL_DIRECTORY_SCOPE,
  FEDERAL_DIRECTORY_SOURCE_ID,
  federalDirectoryProjectionIssues,
  type FederalDirectoryReadModel,
} from "./federal-directory-data-plane.ts";
import type { DirectoryFile } from "./directory.ts";
import type { OfficeholderSet } from "./types.ts";

let cache: FederalDirectoryReadModel | null = null;
let readState: CivicDataReadResult<FederalDirectoryReadModel> = civicDataReadNotInitialized(
  "FEDERAL_DIRECTORY",
  FEDERAL_DIRECTORY_SCOPE,
  "The federal directory canonical pointer has not been read for this process.",
);

function validate(value: FederalDirectoryReadModel, versionId: string): void {
  const issues = federalDirectoryProjectionIssues(value);
  if (issues.length) throw new Error(`Federal directory projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

export async function readFederalDirectoryProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalDirectoryReadModel>> {
  const result = await readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE, options);
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validate(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshFederalDirectoryFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const result = await readFederalDirectoryProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/** Prime the cache from a validated edge serving artifact, with no database read; validated once per edge object and version. */
export function primeFederalDirectoryFromValue(value: FederalDirectoryReadModel, versionId: string): void {
  validateOnce("federal-directory", value, versionId, () => validate(value, versionId));
  cache = value;
  readState = {
    kind: "BOOTSTRAP",
    value,
    metadata: {
      recordClass: "FEDERAL_DIRECTORY",
      scope: FEDERAL_DIRECTORY_SCOPE,
      sourceId: FEDERAL_DIRECTORY_SOURCE_ID,
      version: null,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "CURRENT",
      staleAt: null,
    },
    detail: `Served from the federal-directory edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
  };
}

export function federalDirectoryReadState(): CivicDataReadResult<FederalDirectoryReadModel> {
  return readState;
}

export function getFederalDirectoryReadModel(): FederalDirectoryReadModel {
  if (!cache) throw new Error(`Federal directory is ${readState.kind}; call readFederalDirectoryProjection before using the synchronous projection.`);
  return cache;
}

export function getFederalOfficeholderSet(): OfficeholderSet {
  return getFederalDirectoryReadModel().roster;
}

export function getFederalDirectoryFile(): DirectoryFile {
  return getFederalDirectoryReadModel().directory;
}
