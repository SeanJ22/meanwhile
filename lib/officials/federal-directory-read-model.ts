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
