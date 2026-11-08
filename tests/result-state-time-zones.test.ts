import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import projected from "../data/reference/result_state_time_zones.json" with { type: "json" };
import { COUNTY_TIME_ZONES, governmentTimeZone } from "../lib/time/county-time-zones.ts";
import { resultStateTimeZone } from "../lib/time/result-state-time-zones.ts";
import { shortDate } from "../lib/ballot/results.ts";

/** The previous result-card algorithm, retained here only as the equivalence oracle. */
function countyBasedResultClock(state: string): string | null {
  const tally = new Map<string, number>();
  for (const row of COUNTY_TIME_ZONES.values()) if (row.stateCode === state && row.timeZones.length === 1)
    tally.set(row.timeZones[0], (tally.get(row.timeZones[0]) ?? 0) + 1);
  return governmentTimeZone(state) ?? [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

test("the compact result clocks exactly match every state and territory in the county reference", () => {
  const states = [...new Set([...COUNTY_TIME_ZONES.values()].map(row => row.stateCode))].sort();
  assert.equal(states.length, 56);
  assert.deepEqual(Object.keys(projected).sort(), states);
  for (const state of states) {
    assert.equal(resultStateTimeZone(state), countyBasedResultClock(state), state);
    assert.equal(resultStateTimeZone(state.toLowerCase()), countyBasedResultClock(state), `${state} lowercase`);
  }
  for (const state of ["", "ZZ", "US", "unknown", "constructor"]) assert.equal(resultStateTimeZone(state), null, state);
  execFileSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../scripts/build-result-state-time-zones.mts", import.meta.url)), "--check"]);
});

test("Florida calls keep their existing local date while source date-only values keep their written date", () => {
  const zone = resultStateTimeZone("FL");
  assert.equal(zone, "America/New_York");
  assert.equal(shortDate("2026-11-04T01:00:00Z", { zone }), "Nov 3");
  assert.equal(shortDate("2026-11-04T01:00:00Z", { zone, withYear: true }), "Nov 3, 2026");
  assert.equal(shortDate("2026-11-04", { zone }), "Nov 4");
});

test("the browser's result-card graph contains the compact projection and no county table or scanner", async () => {
  const result = await build({ entryPoints: ["components/ballot/contest-result.tsx"], bundle: true, write: false, metafile: true,
    platform: "browser", format: "esm", target: "es2022", external: ["react", "react/*"], logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.includes("data/reference/result_state_time_zones.json"));
  assert.ok(!inputs.includes("data/reference/national_county_time_zones.json"));
  assert.ok(!inputs.includes("lib/time/county-time-zones.ts"));
});
