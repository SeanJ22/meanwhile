import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCongressDirectory } from "../../lib/officials/congress-normalize.ts";
import type { DistrictHit } from "../../lib/map/districts.ts";
import type { DistrictType } from "../../lib/state/types.ts";
import type { Tier } from "../../lib/ocd/tiers.ts";
import { FIPS_TO_STATE } from "../../lib/ocd/fips.ts";

const root = join(import.meta.dirname, "../fixtures/map-representation");

/** Six current members, parsed by the production normalizer from the saved publisher fields. */
export function recordedSpotFederalDirectory() {
  const sample = JSON.parse(readFileSync(join(root, "federal-members.json"), "utf8"));
  return normalizeCongressDirectory({ "legislators-current": sample.members }, sample.sourceSha, sample.retrievedAt);
}

/** Map-click hits derived from the saved Census point-identification responses. */
export function recordedPointHits(name: "houston" | "des-moines"): DistrictHit[] {
  const sample = JSON.parse(readFileSync(join(root, `${name}-point.json`), "utf8"));
  const types: Record<string, { segment: string; type: DistrictType; tier: Tier; typeLabel: string }> = {
    "119th Congressional Districts": { segment: "cd", type: "congressional", tier: "national", typeLabel: "Congressional" },
    "2024 State Legislative Districts - Upper": { segment: "sldu", type: "state-senate", tier: "state", typeLabel: "State Senate" },
    "2024 State Legislative Districts - Lower": { segment: "sldl", type: "state-house", tier: "state", typeLabel: "State House" },
    Counties: { segment: "county", type: "county", tier: "local", typeLabel: "County" },
    "Incorporated Places": { segment: "place", type: "municipal", tier: "local", typeLabel: "Municipal" },
  };
  return sample.samples.flatMap((source: { response: { results: { layerName: string; attributes: Record<string, string> }[] } }) =>
    source.response.results.map(row => {
      const type = types[row.layerName];
      const state = FIPS_TO_STATE[row.attributes.STATE].postal;
      const segment = row.attributes.BASENAME.toLowerCase().replaceAll(" ", "_");
      return { ...type, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/${type.segment}:${segment}`,
        state, label: type.segment === "cd" ? `${state}-${segment}` : row.attributes.NAME };
    }));
}
