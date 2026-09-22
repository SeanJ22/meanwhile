/**
 * Loading the lookup from a real dataset. Kept apart from the pure `lookup.ts`
 * so `createLookup` stays importable without any I/O.
 *
 * Today this loads the committed AZ bootstrap (local dev, tests, and non-prod
 * before production promotion). When the manual civic-data contract is
 * promoted, the production read path reads the promoted pointer instead; that
 * wiring lands with the promote command and swaps the source here without
 * changing the Admin-facing contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CensusGeographyLookup } from "./contract.ts";
import type { BuiltDataset } from "./dataset.ts";
import { createLookup } from "./lookup.ts";

/** The version key for the census-geography scope in the civic-data plane. */
export const CENSUS_GEO_SCOPE = "US:zcta-geography-overlaps" as const;

/**
 * Load the committed AZ bootstrap as a lookup. Used for local dev, tests, and
 * non-prod. Deployed production reads the promoted pointer (added with the
 * promote command); this bootstrap never overrides a promoted pointer.
 */
export function loadBootstrapLookup(): CensusGeographyLookup {
  const path = join(import.meta.dirname, "bootstrap-az.json");
  const dataset = JSON.parse(readFileSync(path, "utf8")) as BuiltDataset;
  return createLookup(dataset, "bootstrap:az");
}
