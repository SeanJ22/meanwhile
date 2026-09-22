/**
 * Loading the lookup from the promoted production pointer, with the committed
 * AZ bootstrap as the non-prod fallback. Kept apart from the pure `lookup.ts`
 * so `createLookup` stays importable without any I/O.
 *
 * Deployed production reads the promoted pointer (`readPromotedOrBootstrap`);
 * a store failure fails closed to NOT_YET_PUBLISHED rather than an empty answer.
 * The bootstrap is non-prod only and never overrides a promoted pointer.
 */
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

/** Re-export so existing importers keep the scope constant from here. */
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

/**
 * The lookup Admin consumes. Reads the promoted pointer; in non-prod, falls
 * back to the AZ bootstrap; on a store failure or before first promotion,
 * returns a lookup that reports typed absence (never a false empty).
 */
/**
 * The raw promoted read result (for the typed reader-projection verifier and
 * any consumer that needs the version metadata rather than a lookup).
 */
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

export async function loadPublishedLookup(
  options: PromotedCivicDataReadOptions = {},
): Promise<CensusGeographyLookup> {
  const result = await readCensusGeographyProjection(options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    return createLookup(result.value, result.metadata.versionId ?? result.kind);
  }
  return notYetPublishedLookup(result.kind);
}

/**
 * Load the committed AZ bootstrap directly as a lookup — for local dev and
 * tests. Deployed code uses `loadPublishedLookup`.
 */
export function loadBootstrapLookup(): CensusGeographyLookup {
  return createLookup(readBootstrapDataset(), "bootstrap:census-geography:az");
}
