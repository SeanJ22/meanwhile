import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import type { CensusGeographyLookup } from "./contract.ts";
import type { BuiltDataset } from "./dataset.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import {
  CENSUS_GEO_RECORD_CLASS,
  CENSUS_GEO_SCOPE,
  CENSUS_GEO_SOURCE_ID,
} from "./publication.ts";

export { CENSUS_GEO_SCOPE } from "./publication.ts";

/**
 * ~A century, in ms. Reference geography has no freshness cadence, so a promoted
 * pointer never expires on a clock — but the value must stay within Date's valid
 * range (`Number.MAX_SAFE_INTEGER` overflows `new Date(...)` to a RangeError).
 */
const CENSUS_GEO_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function readBootstrapDataset(): BuiltDataset {
  return JSON.parse(readFileSync(join(import.meta.dirname, "bootstrap-az.json"), "utf8")) as BuiltDataset;
}

function bootstrapDataset(): CivicDataBootstrap<BuiltDataset> {
  return {
    value: readBootstrapDataset(),
    sourceId: CENSUS_GEO_SOURCE_ID,
    version: "bootstrap-az",
    versionId: "bootstrap:census-geography:az",
    sourceThrough: "2020",
    retrievedAt: null,
    stale: "UNKNOWN",
    detail: "Bundled Arizona census-geography bootstrap selected only because the canonical store answered with no promoted pointer.",
  };
}

export async function readCensusGeographyProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<BuiltDataset>> {
  const now = options.now ?? new Date().toISOString();
  return readPromotedOrBootstrap<BuiltDataset>({
    ...options,
    now,
    recordClass: CENSUS_GEO_RECORD_CLASS,
    scope: CENSUS_GEO_SCOPE,
    // Reference geography has no freshness cadence: a promoted pointer never
    // expires on a clock, so it is never withheld as "stale".
    maxAgeMs: options.maxAgeMs ?? CENSUS_GEO_MAX_AGE_MS,
    bootstrap: bootstrapDataset,
    allowUnconfiguredBootstrap: process.env.NODE_ENV !== "production",
  });
}

/**
 * Which data actually backs a lookup, made explicit so a consumer can never
 * mistake a non-production fixture for live coverage:
 *   - "published"   — the promoted production pointer (verified, live).
 *   - "bootstrap"   — the committed AZ bootstrap. NON-PRODUCTION ONLY; the
 *                     read-model's fixture gate (`allowUnconfiguredBootstrap`)
 *                     is off when NODE_ENV === "production", so deployed Admin
 *                     never sees this.
 *   - "unavailable" — no promoted pointer yet (or the store could not be
 *                     reached): the lookup reports NOT_YET_PUBLISHED. This is
 *                     what production returns before the first promotion.
 */
export type PublishedLookupSource = "published" | "bootstrap" | "unavailable";

export interface PublishedLookupState {
  readonly lookup: CensusGeographyLookup;
  readonly source: PublishedLookupSource;
  readonly versionId: string;
}

export async function loadPublishedLookupState(
  options: PromotedCivicDataReadOptions = {},
): Promise<PublishedLookupState> {
  const result = await readCensusGeographyProjection(options);
  if (result.kind === "PROMOTED") {
    const versionId = result.metadata.versionId ?? "PROMOTED";
    return { lookup: createLookup(result.value, versionId), source: "published", versionId };
  }
  if (result.kind === "BOOTSTRAP") {
    const versionId = result.metadata.versionId ?? "bootstrap:census-geography:az";
    return { lookup: createLookup(result.value, versionId), source: "bootstrap", versionId };
  }
  return { lookup: notYetPublishedLookup(result.kind), source: "unavailable", versionId: result.kind };
}

export async function loadPublishedLookup(
  options: PromotedCivicDataReadOptions = {},
): Promise<CensusGeographyLookup> {
  return (await loadPublishedLookupState(options)).lookup;
}

export function loadBootstrapLookup(): CensusGeographyLookup {
  return createLookup(readBootstrapDataset(), "bootstrap:census-geography:az");
}
