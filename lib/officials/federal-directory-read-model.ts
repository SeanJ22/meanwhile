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
import { peopleSourceScope } from "./people-sources.ts";
import { federalDirectoryVersion } from "./people-version.ts";
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

/** Where standing portrait work publishes the verified photos it finds for the federal directory. */
export const FEDERAL_PORTRAITS_SCOPE = peopleSourceScope("US", "people-portraits");

/** Each verified portrait is laid on its person; everything else about the directory is untouched. */
export function withFederalPortraits(roster: OfficeholderSet, portraits: OfficeholderSet): OfficeholderSet {
  const held = new Map(portraits.officeholders.filter(row => row.photo).map(row => [row.personId ?? row.id, row] as const));
  if (held.size === 0) return roster;
  return { ...roster, officeholders: roster.officeholders.map(row => {
    const portrait = held.get(row.personId ?? row.id);
    if (!portrait) return row;
    return { ...row, photo: portrait.photo, profileUrls: [...new Set([...(row.profileUrls ?? []), ...(portrait.profileUrls ?? [])])],
      fieldSources: { ...row.fieldSources, ...(portrait.fieldSources?.photo ? { photo: portrait.fieldSources.photo } : {}) } };
  }) };
}

async function readFederalDirectoryWithPortraits(options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<FederalDirectoryReadModel>> {
  const base = await readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE, options);
  if (base.kind !== "PROMOTED" && base.kind !== "BOOTSTRAP") return base;
  // A portrait scope that cannot be read leaves the directory as it was; portraits never make the directory unavailable.
  const portraits = await readPromotedCivicData<{ readonly roster: OfficeholderSet }>("FEDERAL_DIRECTORY", FEDERAL_PORTRAITS_SCOPE, options).catch(() => null);
  if (portraits === null || (portraits.kind !== "PROMOTED" && portraits.kind !== "BOOTSTRAP") || !portraits.value?.roster?.officeholders) return base;
  const roster = withFederalPortraits(base.value.roster, portraits.value.roster);
  if (roster === base.value.roster) return base;
  const value: FederalDirectoryReadModel = { ...base.value, roster };
  const versionId = federalDirectoryVersion(base.metadata.versionId ?? base.kind, portraits.metadata.versionId ?? portraits.kind);
  const metadata = { ...base.metadata, versionId };
  return base.kind === "PROMOTED" ? { ...base, value, metadata, projection: { ...base.projection, versionId, payload: value } } : { ...base, value, metadata };
}

export async function readFederalDirectoryProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalDirectoryReadModel>> {
  const result = await readFederalDirectoryWithPortraits(options);
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
