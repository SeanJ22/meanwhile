/** Preserve the ballot result display clock without sending the county reference to browsers. */
import { readFileSync, writeFileSync } from "node:fs";
import { COUNTY_TIME_ZONES, governmentTimeZone } from "../lib/time/county-time-zones.ts";

const zones: Record<string, string | null> = {};
for (const state of [...new Set([...COUNTY_TIME_ZONES.values()].map(row => row.stateCode))].sort()) {
  const tally = new Map<string, number>();
  for (const row of COUNTY_TIME_ZONES.values()) if (row.stateCode === state && row.timeZones.length === 1) {
    tally.set(row.timeZones[0], (tally.get(row.timeZones[0]) ?? 0) + 1);
  }
  // Stable sort retains the original first-county order when frequencies tie.
  zones[state] = governmentTimeZone(state) ?? [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const output = `${JSON.stringify(zones, null, 2)}\n`;
const destination = new URL("../data/reference/result_state_time_zones.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== output) throw new Error("Run scripts/build-result-state-time-zones.mts to refresh the result clocks.");
} else writeFileSync(destination, output);
