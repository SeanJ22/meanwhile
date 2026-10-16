import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { VOTING_SITES_CONTRACT } from "./voting-sites-data-plane.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

let cache: VotingSitesFile | null = null;
let readState: CivicDataReadResult<VotingSitesFile> = civicDataReadNotInitialized(
  VOTING_SITES_CONTRACT.recordClass,
  VOTING_SITES_CONTRACT.scope,
  "The voting-sites canonical pointer has not been read for this process.",
);

function validateVotingSites(value: VotingSitesFile, version: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.generatedAt) ||
    !Array.isArray(value.jurisdictions) ||
    value.jurisdictions.length === 0 ||
    value.jurisdictions.some((jurisdiction) =>
      !jurisdiction.ocdId ||
      !jurisdiction.sourceUrl ||
      !Array.isArray(jurisdiction.sites) ||
      (jurisdiction.sites.length === 0 && jurisdiction.refusal === null && !jurisdiction.publication && !jurisdiction.office && !jurisdiction.rules?.length && !jurisdiction.addressLookups?.length)
    )
  ) {
    throw new Error(`Voting-sites projection ${version} does not satisfy VotingSitesFile.`);
  }
}

export async function readVotingSitesProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<VotingSitesFile>> {
  const result = await readPromotedCivicData<VotingSitesFile>(
    VOTING_SITES_CONTRACT.recordClass,
    VOTING_SITES_CONTRACT.scope,
    options,
  );
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== VOTING_SITES_CONTRACT.sourceId) {
      throw new Error(
        `Voting-sites pointer names ${result.metadata.sourceId}, not ${VOTING_SITES_CONTRACT.sourceId}.`,
      );
    }
    validateVotingSites(result.value, result.metadata.versionId ?? "unknown");
    cache = result.value;
  } else {
    cache = null;
  }
  readState = result;
  return result;
}

export async function refreshVotingSitesFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readVotingSitesProjection(options));
}

export function votingSitesReadState(): CivicDataReadResult<VotingSitesFile> {
  return readState;
}

export function loadVotingSites(): VotingSitesFile {
  if (cache) return cache;
  throw new Error(
    `Voting-sites holding is ${readState.kind}; call refreshVotingSitesFromPromoted before reading the projection.`,
  );
}

export function resetVotingSitesCache(): void {
  cache = null;
  readState = civicDataReadNotInitialized(
    VOTING_SITES_CONTRACT.recordClass,
    VOTING_SITES_CONTRACT.scope,
    "The voting-sites canonical pointer has not been read for this process.",
  );
}
