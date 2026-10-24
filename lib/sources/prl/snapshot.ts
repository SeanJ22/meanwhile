import {
  civicDataReadNotInitialized,
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
  type PrlCategoryKey,
  type PrlMemberProfile,
  type PrlSnapshot,
} from "./types.ts";

export interface PrlReaderProfile {
  subjectId: string;
  bioguideId: string;
  statementCount: number;
  /** PRL's published percentages, with unavailable measurements left null. The count is not an inferred denominator. */
  shares: Record<PrlCategoryKey, number | null>;
  measuredAt: string;
  readAt: string;
  /** When the source file was retrieved; the existing readAt field remains for older clients. */
  retrievedAt: string;
  /** Literal source labels in the held profile (currently only "all"), not an inferred channel inventory. */
  communicationSources: string[];
  /** Numeric share is PRL's published 0–100 mean, never count / statementCount. */
  categories: { id: PrlCategoryKey; share: number; sentence: string }[];
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
  const share = (key: PrlCategoryKey): number | null => {
    const value = profile.shares?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };
  const shares: PrlReaderProfile["shares"] = {
    policy: share("policy"),
    "attack-policy": share("attack-policy"),
    "attack-personal": share("attack-personal"),
    creditclaiming: share("creditclaiming"),
    bipartisanship: share("bipartisanship"),
  };
  const categories = PRL_CATEGORIES.flatMap((category) => {
    const value = shares[category.key];
    if (value === null) return [];
    const sentence = shareSentence(profile, category.key);
    return sentence ? [{ id: category.key, share: value, sentence }] : [];
  });
  return {
    subjectId: `congress:${profile.bioguideId}`,
    bioguideId: profile.bioguideId,
    statementCount: profile.statementCount,
    shares,
    measuredAt: profile.measuredAt,
    readAt: snapshot.fetchedAt,
    retrievedAt: snapshot.fetchedAt,
    communicationSources: Array.isArray(profile.sources)
      ? profile.sources.filter((source): source is string => typeof source === "string" && source.trim() !== "") : [],
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

function snapshot(): PrlSnapshot {
  if (cache) return cache;
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
