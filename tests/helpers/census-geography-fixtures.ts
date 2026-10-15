import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CensusGeographyLookup } from "../../lib/census-geography/contract.ts";
import type { BuiltDataset } from "../../lib/census-geography/dataset.ts";
import { createLookup } from "../../lib/census-geography/lookup.ts";

export function loadBootstrapLookup(): CensusGeographyLookup {
  const dataset = JSON.parse(readFileSync(join(import.meta.dirname, "../../lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset;
  return createLookup(dataset, "bootstrap:census-geography:az");
}
