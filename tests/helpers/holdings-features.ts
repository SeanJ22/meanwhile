import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { geometryFiles } from "../../lib/holdings/discovery.ts";
import type { GeoFeature } from "../../lib/registry/resolve.ts";

const HOLDINGS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadFeatures(): Promise<GeoFeature[]> {
  const all: GeoFeature[] = [];
  for (const name of geometryFiles(HOLDINGS_ROOT)) {
    const parsed = JSON.parse(await readFile(join(HOLDINGS_ROOT, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}
