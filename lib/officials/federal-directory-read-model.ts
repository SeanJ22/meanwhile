import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
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

function instant(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

function validate(value: FederalDirectoryReadModel, versionId: string): void {
  const issues = federalDirectoryProjectionIssues(value);
  if (issues.length) throw new Error(`Federal directory projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Exact frozen-Git payload and provenance for one explicit durable first-seed import. */
export function federalDirectoryFirstSeed(): CivicDataBootstrap<FederalDirectoryReadModel> {
  const roster = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "officeholders-us.json"), "utf8")) as OfficeholderSet;
  const directory = JSON.parse(readFileSync(join(process.cwd(), "data", "congress-legislators", "directory.json"), "utf8")) as DirectoryFile;
  const value: FederalDirectoryReadModel = { formatVersion: 1, sourceSha: directory.source.sha, roster, directory };
  validate(value, "bundled first seed");
  const retrievedAt = instant(directory.source.collectedAt);
  return {
    value,
    sourceId: FEDERAL_DIRECTORY_SOURCE_ID,
    version: directory.source.sha,
    versionId: `bootstrap:FEDERAL_DIRECTORY:${directory.source.sha}`,
    sourceThrough: retrievedAt,
    retrievedAt,
    detail: "The canonical federal directory store answered with no pointer; serving the bundled first-seed projection explicitly.",
  };
}

/** A configured store error is returned and never opens tracked roster/directory files. */
export async function readFederalDirectoryProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalDirectoryReadModel>> {
  const result = await readPromotedOrBootstrap({
    ...options,
    recordClass: "FEDERAL_DIRECTORY",
    scope: FEDERAL_DIRECTORY_SCOPE,
    bootstrap: federalDirectoryFirstSeed,
    allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
  });
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

/**
 * Prime the federal-directory cache from a validated EDGE serving artifact, no
 * database read — the reader's normal path (request-scoped, see
 * `lib/registry/runtime-edge.ts`). Does NOT alter `refreshFederalDirectoryFromPromoted`,
 * which the runner and workers still use for the authoritative path. BOOTSTRAP
 * kind: the serving copy carries the validated value and its version, not the
 * promotion receipt (no fabricated receipt).
 */
export function primeFederalDirectoryFromValue(value: FederalDirectoryReadModel, versionId: string): void {
  validate(value, versionId);
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
