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
} from "../../civic-data/read-model.ts";
import { PRL_CONTRACT } from "./data-plane.ts";
import { shareSentence } from "./index.ts";
import {
  PRL_CATEGORIES,
  PRL_RHETORIC_ATTRIBUTION,
  type PrlMemberProfile,
  type PrlSnapshot,
} from "./types.ts";

export interface PrlReaderProfile {
  subjectId: string;
  bioguideId: string;
  statementCount: number;
  measuredAt: string;
  readAt: string;
  categories: { id: string; sentence: string }[];
  attribution: typeof PRL_RHETORIC_ATTRIBUTION;
  sourceUrl: string;
}

/** Explicit allowlist: no raw source object, ranks, or ideology can reach a reader. */
export function projectPrlProfile(
  profile: PrlMemberProfile,
  snapshot: Pick<PrlSnapshot, "fetchedAt" | "sourceUrl" | "attribution">,
): PrlReaderProfile | null {
  if (!/^[A-Z]\d{6}$/.test(profile.bioguideId) || !Number.isInteger(profile.statementCount) || profile.statementCount <= 0) return null;
  if (snapshot.attribution.citation !== PRL_RHETORIC_ATTRIBUTION.citation || !snapshot.sourceUrl || !snapshot.fetchedAt) return null;
  const categories = PRL_CATEGORIES.flatMap((category) => {
    const value = profile.shares[category.key];
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) return [];
    const sentence = shareSentence(profile, category.key);
    return sentence ? [{ id: category.key, sentence }] : [];
  });
  return {
    subjectId: `congress:${profile.bioguideId}`,
    bioguideId: profile.bioguideId,
    statementCount: profile.statementCount,
    measuredAt: profile.measuredAt,
    readAt: snapshot.fetchedAt,
    categories,
    attribution: PRL_RHETORIC_ATTRIBUTION,
    sourceUrl: snapshot.sourceUrl,
  };
}

let cache: PrlSnapshot | null = null;
let readState: CivicDataReadResult<PrlSnapshot> = civicDataReadNotInitialized(
  PRL_CONTRACT.recordClass,
  PRL_CONTRACT.scope,
  "The PRL canonical pointer has not been read for this process.",
);

function validatePrlSnapshot(value: PrlSnapshot, version: string): void {
  if (
    value.formatVersion !== 1 ||
    !Array.isArray(value.profiles) ||
    !Array.isArray(value.rosterMisses) ||
    value.attribution?.citation !== PRL_RHETORIC_ATTRIBUTION.citation ||
    value.sourceUrl !== "https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip"
  ) {
    throw new Error(`PRL projection ${version} does not satisfy the attributed PrlSnapshot contract.`);
  }
}

function fixture(): PrlSnapshot {
  if (!mayUseTestFixture()) {
    throw new Error("The bundled PRL file is deterministic test evidence, not a production authority.");
  }
  const value = JSON.parse(
    readFileSync(join(process.cwd(), "data", "prl", "prl-profiles.json"), "utf8"),
  ) as PrlSnapshot;
  validatePrlSnapshot(value, "bundled test fixture");
  return value;
}

/** Read only the canonical promoted PRL pointer. Store failures fail closed. */
export async function readPrlProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<PrlSnapshot>> {
  const result = await readPromotedCivicData<PrlSnapshot>(
    PRL_CONTRACT.recordClass,
    PRL_CONTRACT.scope,
    options,
  );
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== PRL_CONTRACT.sourceId) {
      throw new Error(`PRL pointer names ${result.metadata.sourceId}, not ${PRL_CONTRACT.sourceId}.`);
    }
    validatePrlSnapshot(result.value, result.metadata.versionId ?? "unknown");
    cache = result.value;
  } else {
    cache = null;
  }
  readState = result;
  return result;
}

export async function refreshPrlFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readPrlProjection(options));
}

export function prlReadState(): CivicDataReadResult<PrlSnapshot> {
  return readState;
}

function snapshot(): PrlSnapshot {
  if (cache) return cache;
  // Central policy permits NOT_RECORDED, STORE_NOT_CONFIGURED, or
  // READ_NOT_INITIALIZED here; a STORE_READ_FAILED result stays closed.
  if (maySeedFixture(readState)) {
    cache = fixture();
    return cache;
  }
  throw new Error(
    `PRL holding is ${readState.kind}; call refreshPrlFromPromoted before reading the projection.`,
  );
}

export function prlProfileForSubject(subjectId: string): PrlReaderProfile | null {
  const bioguide = /^congress:([A-Z]\d{6})$/.exec(subjectId)?.[1];
  if (!bioguide) return null;
  const held = snapshot();
  const matches = held.profiles.filter((profile) => profile.bioguideId === bioguide);
  if (matches.length > 1) throw new Error(`Ambiguous normalized PRL identity ${bioguide}`);
  return matches[0] ? projectPrlProfile(matches[0], held) : null;
}

/** Test seam. Never called by a production render path. */
export function resetPrlCache(): void {
  cache = null;
  readState = civicDataReadNotInitialized(
    PRL_CONTRACT.recordClass,
    PRL_CONTRACT.scope,
    "The PRL canonical pointer has not been read for this process.",
  );
}
