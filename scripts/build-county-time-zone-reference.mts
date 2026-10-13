/** Rebuild the committed county clock reference from held NOAA source bytes and Census county identities. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseCsv } from "../lib/reference/csv.ts";

const sourcePath = "tests/fixtures/county-time-zones/nws-bp03mr20.csv";
const source = readFileSync(sourcePath, "utf8");
const zones: Readonly<Record<string, string>> = {
  E: "America/New_York", e: "America/New_York", C: "America/Chicago", M: "America/Denver", m: "America/Phoenix",
  P: "America/Los_Angeles", A: "America/Anchorage", H: "Pacific/Honolulu", h: "America/Adak",
  V: "America/Puerto_Rico", G: "Pacific/Guam", S: "Pacific/Pago_Pago",
};
const rows = new Map<string, { state: string; name: string; zones: Set<string> }>();
for (const row of parseCsv(source).slice(1)) {
  const [state, , , , , name, fips, codes] = row;
  if (["FM", "MH", "PW"].includes(state)) continue;
  const held = rows.get(fips) ?? { state, name, zones: new Set<string>() };
  for (const code of codes) {
    const zone = state === "AK" && code === "H" ? "America/Adak" : zones[code];
    if (!zone) throw new Error(`COUNTY_ZONE_UNKNOWN:${fips}:${code}`);
    held.zones.add(zone);
  }
  rows.set(fips, held);
}
// Census 2023 identities include new Alaska areas and Connecticut planning regions. Their clocks did not change.
const missingStateZone: Readonly<Record<string, string>> = { AK: "America/Anchorage", CT: "America/New_York", AS: "Pacific/Pago_Pago", HI: "Pacific/Honolulu" };
for (const file of readdirSync("data/derived/registration").filter(f => /^[a-z]{2}\.json$/.test(f))) {
  const ref = JSON.parse(readFileSync(`data/derived/registration/${file}`, "utf8"));
  for (const county of ref.divisions.filter((r: string[]) => r[1] === "county")) {
    const fips = county[2];
    const state = ref.state.toUpperCase();
    const held = rows.get(fips);
    if (held) { held.name = county[3]; held.state = state; }
    else {
      const zone = missingStateZone[state];
      if (!zone) throw new Error(`COUNTY_ZONE_MISSING:${fips}`);
      rows.set(fips, { state, name: county[3], zones: new Set([zone]) });
    }
  }
}
// Forecast zones can cross county borders: use county-boundary assignments, not a neighbouring forecast zone's clock.
const overrides: Readonly<Record<string, readonly string[]>> = {
  "12005": ["America/Chicago"], "16035": ["America/Los_Angeles"],
  "04001": ["America/Phoenix", "America/Denver"], "04005": ["America/Phoenix", "America/Denver"], "04017": ["America/Phoenix", "America/Denver"],
  "04007": ["America/Phoenix"], "04021": ["America/Phoenix"],
  // Local practices are printed by the governments themselves, even when NWS forecast clocks use the surrounding county.
  "01017": ["America/Chicago", "America/New_York"], "01081": ["America/Chicago", "America/New_York"], "01113": ["America/Chicago", "America/New_York"],
  "32007": ["America/Los_Angeles", "America/Denver"],
};
for (const [fips, values] of Object.entries(overrides)) rows.get(fips)!.zones = new Set(values);
// NOAA forecast code M is capitalized for some Arizona zones despite Arizona's statutory year-round standard time.
for (const [fips, row] of rows) if (row.state === "AZ" && !["04001", "04005", "04017"].includes(fips)) row.zones = new Set(["America/Phoenix"]);
const output = {
  formatVersion: 1,
  source: { url: "https://www.weather.gov/source/gis/Shapefiles/County/bp03mr20.dbx", mirror: "https://github.com/HealthRex/CDSS/blob/fbbac63d90866ec66cf0b6db6385eb93bbef851c/medinfo/geography/bp03mr20.csv", sha256: createHash("sha256").update(source).digest("hex"), heldPath: sourcePath },
  columns: ["countyFips", "stateCode", "countyName", "ianaTimeZones"],
  counties: [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([fips, r]) => [fips, r.state, r.name, [...r.zones].sort()]),
};
writeFileSync("data/reference/national_county_time_zones.json", `${JSON.stringify(output)}\n`);
console.log(`${rows.size} county FIPS identities with IANA clocks`);
