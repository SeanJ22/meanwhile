import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  civicDataReadNotInitialized,
  maySeedFixture,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { VOTING_SITES_CONTRACT } from "./voting-sites-data-plane.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

/**
 * Server-only Reader projection for voting sites.
 *
 * Production reads the canonical promoted pointer. The tracked JSON remains
 * available only as deterministic test evidence; it is never a runtime
 * fallback and a store failure can never select it.
 */

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
      (jurisdiction.sites.length === 0 && jurisdiction.refusal === null)
    )
  ) {
    throw new Error(`Voting-sites projection ${version} does not satisfy VotingSitesFile.`);
  }
}

function fixture(): VotingSitesFile {
  if (!mayUseTestFixture()) {
    throw new Error("The bundled voting-sites file is deterministic test evidence, not a production authority.");
  }
  const value = JSON.parse(
    readFileSync(join(process.cwd(), "data", "voting-sites.json"), "utf8"),
  ) as VotingSitesFile;
  validateVotingSites(value, "bundled test fixture");
  return value;
}

/** Read the canonical promoted voting-sites projection without a tracked fallback. */
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

/** Request preload. Store failures remain explicit and never open tracked JSON. */
export async function refreshVotingSitesFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readVotingSitesProjection(options));
}

export function votingSitesReadState(): CivicDataReadResult<VotingSitesFile> {
  return readState;
}

/** Synchronous projection accessor after the route has preloaded the pointer. */
export function loadVotingSites(): VotingSitesFile {
  if (cache) return cache;
  // Central policy permits NOT_RECORDED, STORE_NOT_CONFIGURED, or
  // READ_NOT_INITIALIZED here; a STORE_READ_FAILED result stays closed.
  if (maySeedFixture(readState)) {
    cache = fixture();
    return cache;
  }
  throw new Error(
    `Voting-sites holding is ${readState.kind}; call refreshVotingSitesFromPromoted before reading the projection.`,
  );
}

/** Test seam. Never called by a production render path. */
export function resetVotingSitesCache(): void {
  cache = null;
  readState = civicDataReadNotInitialized(
    VOTING_SITES_CONTRACT.recordClass,
    VOTING_SITES_CONTRACT.scope,
    "The voting-sites canonical pointer has not been read for this process.",
  );
}
