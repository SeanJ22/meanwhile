import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { attachOfficialRosterDivisions } from "../lib/officials/roster-divisions.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseLegislatureRoster } from "../lib/sources/official-rosters/legislature.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";
import type { RegistryDivisionLite } from "../lib/sources/plural/index.ts";

const sourceFolder = new URL("./fixtures/official-rosters/states/", import.meta.url);
type SourceFixture = { id: string; url: string; fixture: string; retrievedAt: string };
const sources = ["manifest-researched-states.json", "research-recovered.json"].flatMap(name =>
  JSON.parse(readFileSync(new URL(name, sourceFolder), "utf8")) as SourceFixture[]);
function source(id: string) {
  const row = sources.find(row => row.id === id)!;
  return { ...row, body: gunzipSync(readFileSync(new URL(row.fixture, sourceFolder))).toString("utf8") };
}
function official(state: string, ids: string[]) {
  const documents = ids.map(source);
  return parseLegislatureRoster(officialLegislatureTarget(state)!, documents, documents[0]!.retrievedAt);
}
function censusDivisions(): RegistryDivisionLite[] {
  return (["lower", "upper"] as const).flatMap(chamber => {
    const data = JSON.parse(readFileSync(new URL(`./fixtures/or-01/census-ma-vt-${chamber}.json`, import.meta.url), "utf8")) as {
      features: { attributes: Record<string, string> }[];
    };
    const kind = chamber === "lower" ? "sldl" : "sldu";
    return data.features.map(({ attributes }) => ({
      ocdId: `ocd-division/country:us/state:${FIPS_TO_STATE[attributes.STATE!]!.postal.toLowerCase()}/${kind}:${attributes[kind.toUpperCase()]!.toLowerCase()}`,
      label: attributes.NAME!, divisionType: kind,
    }));
  });
}

test("the actual Massachusetts roster's named seats and vacancies attach to exact Census districts", () => {
  const before = official("MA", ["ma-both", "ma-senate"]);
  assert.equal(before.currentMembershipComplete, true, "geography does not change source enumeration");
  assert.ok(before.unmatched.length > 0);
  const after = attachOfficialRosterDivisions(before, "MA", censusDivisions());
  assert.equal(after.officeholders.length, before.officeholders.length);
  assert.equal(after.vacancies?.length, before.vacancies?.length);
  assert.equal(after.currentMembershipComplete, true);
  assert.equal(after.unmatched.length, 0);
  assert.ok(after.officeholders.every(holder => holder.memberships?.every(membership => membership.divisionId?.startsWith("ocd-division/country:us/state:ma/"))));
  assert.ok(after.vacancies?.every(vacancy => vacancy.divisionId.startsWith("ocd-division/country:us/state:ma/")));
  const norfolk = after.officeholders.find(holder => holder.chamber === "lower" && holder.memberships?.[0]?.district === "13th Norfolk")!;
  assert.equal(norfolk.memberships?.[0]?.divisionId, "ocd-division/country:us/state:ma/sldl:108");
  const middlesex = after.officeholders.find(holder => holder.chamber === "upper" && holder.memberships?.[0]?.district === "Third Middlesex")!;
  assert.equal(middlesex.memberships?.[0]?.divisionId, "ocd-division/country:us/state:ma/sldu:d15");
});

test("the actual Vermont source binds all current members through the Census's named and lettered native districts", () => {
  const before = official("VT", ["vt-roster-json"]);
  assert.equal(before.currentMembershipComplete, true);
  const after = attachOfficialRosterDivisions(before, "VT", censusDivisions());
  assert.equal(after.officeholders.length, 180);
  assert.equal(after.unmatched.length, 0);
  assert.ok(after.officeholders.every(holder => holder.memberships?.every(membership => membership.divisionId?.startsWith("ocd-division/country:us/state:vt/"))));
  const franklin = after.officeholders.find(holder => holder.chamber === "lower" && holder.memberships?.[0]?.district === "Franklin-3")!;
  assert.equal(franklin.memberships?.[0]?.divisionId, "ocd-division/country:us/state:vt/sldl:f-3");
});

test("a state's named seats cannot join another state's Census divisions", () => {
  const before = official("MA", ["ma-both", "ma-senate"]);
  const otherState = censusDivisions().filter(division => division.ocdId.includes("/state:vt/"));
  const after = attachOfficialRosterDivisions(before, "MA", otherState);
  assert.equal(after.unmatched.length, before.unmatched.length);
  assert.equal(after.divisions.length, 0);
  assert.ok(after.vacancies?.every(vacancy => vacancy.divisionId === ""));
});
