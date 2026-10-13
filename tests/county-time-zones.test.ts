import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { COUNTY_TIME_ZONES, countyTimeZones, governmentTimeZone } from "../lib/time/county-time-zones.ts";

test("national county reference covers every committed Census county equivalent and every registration target", () => {
  const states = new Set<string>();
  for (const file of readdirSync("data/derived/registration").filter(name => /^[a-z]{2}\.json$/.test(name))) {
    const reference = JSON.parse(readFileSync(`data/derived/registration/${file}`, "utf8"));
    states.add(reference.state.toUpperCase());
    for (const county of reference.divisions.filter((row: string[]) => row[1] === "county")) {
      const held = COUNTY_TIME_ZONES.get(county[2]);
      assert.ok(held, `${file}: ${county[2]} ${county[3]}`);
      assert.equal(held.stateCode, reference.state.toUpperCase());
      assert.ok(held.timeZones.length >= 1);
      for (const timeZone of held.timeZones) assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone }));
    }
  }
  assert.equal(states.size, 56);
  const reference = JSON.parse(readFileSync("data/reference/national_county_time_zones.json", "utf8"));
  assert.equal(reference.source.sha256, createHash("sha256").update(readFileSync(reference.source.heldPath)).digest("hex"));
});

test("all formerly omitted states resolve their own counties' wall clocks", () => {
  for (const [state, fips, zone] of [
    ["AL", "01073", "America/Chicago"], ["AK", "02020", "America/Anchorage"], ["FL", "12086", "America/New_York"],
    ["ID", "16001", "America/Denver"], ["IN", "18097", "America/New_York"], ["KS", "20091", "America/Chicago"],
    ["KY", "21111", "America/New_York"], ["MI", "26163", "America/New_York"], ["NE", "31055", "America/Chicago"],
    ["NV", "32031", "America/Los_Angeles"], ["ND", "38015", "America/Chicago"], ["OR", "41051", "America/Los_Angeles"],
    ["SD", "46099", "America/Chicago"], ["TN", "47037", "America/Chicago"], ["TX", "48453", "America/Chicago"],
  ]) assert.equal(governmentTimeZone(state!, fips), zone, `${state}:${fips}`);
});

test("split counties and border practices retain every clock and never choose a majority", () => {
  for (const [state, fips] of [["FL", "12045"], ["ID", "16049"], ["ND", "38025"], ["NE", "31031"], ["OR", "41045"], ["SD", "46117"], ["TX", "48109"], ["AK", "02016"], ["AZ", "04001"], ["NV", "32007"], ["AL", "01113"]]) {
    assert.ok(countyTimeZones(fips, state).length >= 2, `${state}:${fips}`);
    assert.equal(governmentTimeZone(state!, fips), null);
  }
  assert.deepEqual(countyTimeZones("48141", "TX"), ["America/Denver"], "El Paso keeps Mountain, while Travis keeps Central");
  assert.deepEqual(countyTimeZones("04013", "AZ"), ["America/Phoenix"], "capitalized forecast-zone code M never switches Phoenix into daylight time");
  assert.equal(governmentTimeZone("TX", "12086"), null, "a county in another state cannot supply the clock");
  assert.equal(governmentTimeZone("OH", "99999"), null, "an unknown county never silently falls back to the state");
});
